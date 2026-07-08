# Boleta electrónica SII (SimpleFactura) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir la boleta electrónica (DTE 39) ante el SII vía SimpleFactura al cobrar, obtener folio y timbre, imprimirlos en la boleta térmica, y permitir reintento/reimpresión — todo contra la cuenta demo (certificación) sin emitir documentos reales.

**Architecture:** Una Edge Function `emitir-boleta` (server-side, con las credenciales como secrets) obtiene el token JWT de SimpleFactura, arma el DTE 39 desde la venta, emite en `/invoiceV2/Casa_Matriz`, obtiene el timbre PNG en `/dte/timbre`, y persiste folio+timbre en `sale`. El cobro no se bloquea: si la emisión falla, la venta queda pendiente y se reintenta. La boleta térmica (Rust/ESC/POS) imprime el folio SII y el timbre PNG como raster.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Postgres, Rust (crate `image` para el PNG), React + Vite + TS.

## Global Constraints

- Prosa español; código inglés. pnpm. Tests `pnpm test`. Build `pnpm build`.
- Commits: `Cromilakis <ipcromilakis@gmail.com>`; sin co-author ni atribución.
- **La app usa el Supabase REMOTO** (`immuembrvocwbdpprypk`); migraciones con `supabase db push`, funciones con `supabase functions deploy`, secrets con `supabase secrets set`.
- **Solo ambiente demo/certificación** en este plan (no producción). Credenciales demo (públicas): `demo@chilesystems.com` / `Rv8Il4eV`. URL base `https://api.simplefactura.cl`. `ambiente = 0` (certificación).
- API SimpleFactura: auth Bearer JWT de `POST /token`; emisión `POST /invoiceV2/Casa_Matriz` (DTE 39, folio en `data.folio`); timbre `POST /dte/timbre` (`data` = PNG base64). Rate limit 2 req/s, 100 req/min.
- El **número de boleta impreso = folio SII** (`dte_folio`), nunca el `sale.folio` interno.
- Cobrar nunca se bloquea por la emisión; idempotencia: no emitir dos veces la misma venta.

---

### Task 1: Migración — columnas DTE en `sale`

**Files:** Create `supabase/migrations/20260708150000_sale_dte.sql`

**Interfaces:** Produce en `public.sale`: `dte_status text default 'pendiente'`, `dte_folio int`, `dte_timbre text`, `dte_track_id text`, `emitted_at timestamptz`.

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- Migración: estado de emisión de boleta electrónica (DTE 39) por venta
-- Contrato: docs/superpowers/specs/2026-07-08-boleta-electronica-sii-simplefactura-design.md
-- Las escribe la Edge Function emitir-boleta (service role); el cliente solo lee.
-- ============================================================================
alter table public.sale add column dte_status text not null default 'pendiente'
  check (dte_status in ('pendiente','emitida','rechazada','error'));
alter table public.sale add column dte_folio int;
alter table public.sale add column dte_timbre text;        -- PNG del timbre en base64
alter table public.sale add column dte_track_id text;
alter table public.sale add column emitted_at timestamptz;
```

- [ ] **Step 2: Aplicar local y remoto**

Run: `npx supabase migration up --local`
Run: `echo "y" | npx supabase db push` → verificar con `npx supabase migration list --linked` que `remote` quede con `20260708150000`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260708150000_sale_dte.sql
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(sii): columnas de estado DTE en sale (folio, timbre, status)"
```

---

### Task 2: Edge Function `emitir-boleta`

**Files:**
- Create `supabase/functions/emitir-boleta/index.ts`
- Create `supabase/functions/emitir-boleta/.env.example`

**Interfaces:**
- Consume: secrets `SIMPLEFACTURA_URL`, `SIMPLEFACTURA_EMAIL`, `SIMPLEFACTURA_PASSWORD`, `SIMPLEFACTURA_AMBIENTE`, `SIMPLEFACTURA_RUT_EMISOR` y datos emisor demo; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produce: endpoint POST `{ sale_id }` → `{ status: 'emitida', folio, timbre_png }` o `{ status: 'error'|'rechazada', message }`.

- [ ] **Step 1: Implementar `index.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
// Emisor: en demo se usa un RUT autorizado por la cuenta demo (no el del negocio real).
const EMISOR = {
  RUTEmisor: Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "76269769-6",
  RznSocEmisor: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmisor: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  DirOrigen: Deno.env.get("SIMPLEFACTURA_DIR") ?? "Calle 7 numero 3",
  CmnaOrigen: Deno.env.get("SIMPLEFACTURA_CMNA") ?? "Santiago",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sfToken(): Promise<string> {
  const r = await fetch(`${SF_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t.replace(/^"|"$/g, ""); // el token puede venir como string JSON
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sale_id } = await req.json();
    if (!sale_id) return json({ status: "error", message: "sale_id requerido" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Venta + líneas
    const { data: sale, error: e1 } = await admin
      .from("sale")
      .select("id,folio,neto,iva,total,dte_status,dte_folio,dte_timbre,sale_line(name_snapshot,price_snapshot,qty,discount_amount)")
      .eq("id", sale_id).single();
    if (e1 || !sale) return json({ status: "error", message: "venta no encontrada" }, 404);

    // Idempotencia: ya emitida → devolver lo persistido
    if (sale.dte_status === "emitida" && sale.dte_folio) {
      return json({ status: "emitida", folio: sale.dte_folio, timbre_png: sale.dte_timbre });
    }

    const token = await sfToken();
    const lines = (sale as any).sale_line ?? [];
    const detalle = lines.map((l: any, i: number) => {
      const monto = l.price_snapshot * l.qty - (l.discount_amount ?? 0);
      return {
        NroLinDet: String(i + 1),
        NmbItem: l.name_snapshot,
        QtyItem: String(l.qty),
        UnmdItem: "un",
        PrcItem: String(l.price_snapshot),
        MontoItem: String(monto),
      };
    });
    const body = {
      Documento: {
        Encabezado: {
          IdDoc: { TipoDTE: 39, FchEmis: isoDate(new Date()), IndServicioBoleta: 3 },
          Emisor: EMISOR,
          Totales: { MntNeto: String(sale.neto), IVA: String(sale.iva), MntTotal: String(sale.total) },
        },
        Detalle: detalle,
      },
    };

    const emit = await fetch(`${SF_URL}/invoiceV2/Casa_Matriz`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const emitText = await emit.text();
    if (!emit.ok) {
      await admin.from("sale").update({ dte_status: "error" }).eq("id", sale_id);
      return json({ status: "error", message: `emision ${emit.status}: ${emitText}` }, 502);
    }
    const emitJson = JSON.parse(emitText);
    const folio = emitJson?.data?.folio;
    if (!folio) {
      await admin.from("sale").update({ dte_status: "rechazada" }).eq("id", sale_id);
      return json({ status: "rechazada", message: emitJson?.message ?? "sin folio" }, 200);
    }

    // Timbre (PNG base64)
    let timbre_png: string | null = null;
    try {
      const tr = await fetch(`${SF_URL}/dte/timbre`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          credenciales: { rutEmisor: EMISOR.RUTEmisor },
          dteReferenciadoExterno: { folio, codigoTipoDte: 39, ambiente: SF_AMBIENTE },
        }),
      });
      if (tr.ok) timbre_png = (JSON.parse(await tr.text()))?.data ?? null;
    } catch (_) { /* el timbre puede reintentarse luego; la boleta ya tiene folio */ }

    await admin.from("sale").update({
      dte_status: "emitida", dte_folio: folio, dte_timbre: timbre_png, emitted_at: new Date().toISOString(),
    }).eq("id", sale_id);

    return json({ status: "emitida", folio, timbre_png });
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});
```

`.env.example`:
```
SIMPLEFACTURA_URL=https://api.simplefactura.cl
SIMPLEFACTURA_EMAIL=demo@chilesystems.com
SIMPLEFACTURA_PASSWORD=Rv8Il4eV
SIMPLEFACTURA_AMBIENTE=0
SIMPLEFACTURA_RUT_EMISOR=76269769-6
```

- [ ] **Step 2: Configurar secrets y desplegar al remoto**

Run:
```bash
npx supabase secrets set SIMPLEFACTURA_URL=https://api.simplefactura.cl SIMPLEFACTURA_EMAIL=demo@chilesystems.com SIMPLEFACTURA_PASSWORD=Rv8Il4eV SIMPLEFACTURA_AMBIENTE=0 SIMPLEFACTURA_RUT_EMISOR=76269769-6
npx supabase functions deploy emitir-boleta
```
Expected: la función queda desplegada; los secrets aplicados.

- [ ] **Step 3: Probar la función con una venta real de la DB (curl)**

Con el `sale_id` de una venta existente y el anon/JWT, invocar la función y verificar respuesta `{ status: "emitida", folio, timbre_png }`. (El detalle del curl se ajusta con la URL del proyecto; alternativamente probar desde la app en Task 4.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/emitir-boleta/
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(sii): Edge Function emitir-boleta (DTE 39 via SimpleFactura, ambiente demo)"
```

---

### Task 3: Cliente de emisión + timbre en la boleta (Rust)

**Files:**
- Create `src/data/sii.ts`
- Modify `src-tauri/Cargo.toml` (crate `image`)
- Modify `src-tauri/src/escpos.rs` (timbre real + folio SII + reimpresión)

**Interfaces:**
- Produce `emitirBoleta(saleId: string): Promise<{ status: string; folio?: number; timbre_png?: string | null; message?: string }>`.
- `ReceiptPayload` (Rust) gana `dte_folio: Option<u32>`, `timbre_png: Option<String>`, `reimpresion: bool` (con `#[serde(default)]`).

- [ ] **Step 1: `src/data/sii.ts`**

```ts
import { supabase } from "@/lib/supabase";

export interface EmitirResult { status: "emitida" | "rechazada" | "error"; folio?: number; timbre_png?: string | null; message?: string; }

export async function emitirBoleta(saleId: string): Promise<EmitirResult> {
  const { data, error } = await supabase.functions.invoke("emitir-boleta", { body: { sale_id: saleId } });
  if (error) return { status: "error", message: error.message };
  return data as EmitirResult;
}
```

- [ ] **Step 2: crate `image` en `Cargo.toml`**

En `[dependencies]` de `src-tauri/Cargo.toml` añadir:
```toml
image = { version = "0.25", default-features = false, features = ["png"] }
base64 = "0.22"
```

- [ ] **Step 3: Timbre real en `escpos.rs`**

- En `struct ReceiptPayload` añadir (con `#[serde(default)]` para no romper otros payloads):
```rust
    pub total: i64,
    pub descuento: i64,
    #[serde(default)] pub dte_folio: Option<u32>,
    #[serde(default)] pub timbre_png: Option<String>,
    #[serde(default)] pub reimpresion: bool,
    pub metodo: String,
    pub open_drawer: bool,
```
- Función para imprimir un PNG base64 como raster ESC/POS (junto a `timbre_dummy`):
```rust
fn timbre_png(buf: &mut Vec<u8>, b64: &str) -> bool {
    use base64::Engine;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(b64.trim()) { Ok(b) => b, Err(_) => return false };
    let img = match image::load_from_memory(&bytes) { Ok(i) => i.to_luma8(), Err(_) => return false };
    let (w, h) = img.dimensions();
    let bpr = ((w + 7) / 8) as usize;
    let mut bits = vec![0u8; bpr * h as usize];
    for y in 0..h { for x in 0..w {
        if img.get_pixel(x, y).0[0] < 128 { bits[y as usize * bpr + (x / 8) as usize] |= 0x80 >> (x % 8); }
    } }
    // GS v 0 (raster). Alto puede superar 255 → emitir por bandas de <=255 filas.
    let mut y0 = 0u32;
    while y0 < h {
        let band = (h - y0).min(255);
        buf.extend_from_slice(&[0x1D, 0x76, 0x30, 0x00]);
        buf.push((bpr & 0xFF) as u8); buf.push((bpr >> 8) as u8);
        buf.push((band & 0xFF) as u8); buf.push((band >> 8) as u8);
        let start = y0 as usize * bpr; let end = start + band as usize * bpr;
        buf.extend_from_slice(&bits[start..end]);
        y0 += band;
    }
    nl(buf);
    true
}
```
- En `build`, el recuadro de folio usa el **folio SII** cuando existe:
```rust
    // recuadro de folio (número SII si está emitida)
    let folio_txt = match p.dte_folio { Some(f) => format!("No {}", f), None => "PENDIENTE DE EMISION".to_string() };
    box_ascii(&mut b, &[ &format!("R.U.T.: {}", p.negocio.rut), "BOLETA ELECTRONICA", &folio_txt ], 32);
    nl(&mut b);
    if p.reimpresion { line_center(&mut b, "** REIMPRESION **"); nl(&mut b); }
```
- Reemplazar el bloque del timbre dummy por el timbre real / leyenda pendiente:
```rust
    nl(&mut b);
    rule(&mut b, b'-');
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    match &p.timbre_png {
        Some(png) if timbre_png(&mut b, png) => {
            push_text(&mut b, "Timbre Electronico SII"); nl(&mut b);
            push_text(&mut b, "Res. 80 de 2014 - www.sii.cl"); nl(&mut b);
        }
        _ => { push_text(&mut b, "BOLETA PENDIENTE DE EMISION"); nl(&mut b); }
    }
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
```
(Quitar la llamada a `timbre_dummy`; puede dejarse la función sin usar o eliminarse.)
- Actualizar el `sample()` del módulo de tests para incluir `dte_folio: None, timbre_png: None, reimpresion: false`.

- [ ] **Step 4: Compilar y test Rust**

Run: `cd src-tauri && cargo test escpos`
Expected: compila (con `image`/`base64`) y los tests pasan.

- [ ] **Step 5: Commit**

```bash
git add src/data/sii.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/escpos.rs
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(sii): cliente emitirBoleta y timbre real (PNG raster) + folio SII en la boleta"
```

---

### Task 4: Flujo de cobro con emisión y reimpresión (VentaScreen)

**Files:** Modify `src/modules/venta/VentaScreen.tsx`

**Interfaces:** Consume `emitirBoleta` (Task 3), `printReceipt`.

- [ ] **Step 1: Emitir tras cobrar e imprimir con timbre**

En `handleConfirmPay`, después de `cobrarVenta` y de limpiar el carrito, antes de imprimir, obtener la emisión y construir el payload con folio+timbre:

```tsx
      // Emitir la boleta electrónica (best-effort; no bloquea la venta ya cobrada).
      let dteFolio: number | undefined;
      let timbrePng: string | null | undefined;
      try {
        const em = await emitirBoleta(sale.id);
        if (em.status === "emitida") { dteFolio = em.folio; timbrePng = em.timbre_png ?? null; }
        else toast.warning(`Venta cobrada. Boleta pendiente de emisión (${em.message ?? em.status}).`);
      } catch {
        toast.warning("Venta cobrada. Boleta pendiente de emisión (sin conexión con el SII).");
      }
```
Y en el objeto `payload` agregar: `dte_folio: dteFolio, timbre_png: timbrePng ?? null, reimpresion: false`.

(Importar `emitirBoleta` de `@/data/sii`. `sale.id` viene de `cobrarVenta`; ya está disponible.)

- [ ] **Step 2: Verificar tipos y build**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 3: Verificación manual (contra demo)**

`pnpm tauri dev`. Cobrar una venta:
- Con conexión: la boleta imprime **folio SII** real y el **timbre** (PNG). En Supabase, la venta queda `dte_status='emitida'` con `dte_folio`/`dte_timbre`.
- Simulando falla (sin red): la venta se cobra igual, imprime "BOLETA PENDIENTE DE EMISION", `dte_status` queda `pendiente/error`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(venta): emitir boleta electronica al cobrar e imprimir folio+timbre reales"
```

---

### Task 5: Reintento y reimpresión de boletas del día

**Files:**
- Modify `src/data/sales.ts` (hook de ventas del día con estado DTE)
- Modify `src/modules/venta/VentaScreen.tsx` (panel "Boletas del día" con reintentar/reimprimir)

**Interfaces:** Consume `emitirBoleta`; reusa `printReceipt` y el negocio para reimprimir.

- [ ] **Step 1: Hook `useSalesTodayDte`**

En `src/data/sales.ts` añadir un hook que liste las ventas de hoy de la sucursal con su estado DTE y líneas (para reimprimir):

```ts
export interface SaleDteRow {
  id: string; folio: number; total: number; sold_at: string; method: string;
  dte_status: string; dte_folio: number | null; dte_timbre: string | null;
  lines: { name_snapshot: string; price_snapshot: number; qty: number; discount_amount: number }[];
}

export function useSalesTodayDte(branchId: string | undefined) {
  return useQuery({
    queryKey: ["sales-today-dte", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<SaleDteRow[]> => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("sale")
        .select("id,folio,total,sold_at,method,dte_status,dte_folio,dte_timbre,sale_line(name_snapshot,price_snapshot,qty,discount_amount)")
        .eq("branch_id", branchId!).gte("sold_at", start.toISOString())
        .order("sold_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        id: s.id, folio: s.folio, total: s.total, sold_at: s.sold_at, method: s.method,
        dte_status: s.dte_status, dte_folio: s.dte_folio, dte_timbre: s.dte_timbre,
        lines: s.sale_line ?? [],
      }));
    },
  });
}
```

- [ ] **Step 2: Panel "Boletas del día" en VentaScreen**

Añadir un botón en la barra ("Boletas del día") que abre un modal con la lista (`useSalesTodayDte`): cada fila muestra fecha/hora, total, y el estado (`emitida` con folio SII / `pendiente` / `error` / `rechazada`), con acciones:
- **Reintentar** (si no está `emitida`): llama `emitirBoleta(sale.id)`; al emitir, invalida `["sales-today-dte"]` y ofrece imprimir.
- **Reimprimir** (si `emitida`): arma el `payload` con `dte_folio`, `timbre_png = dte_timbre`, `reimpresion: true`, y llama `printReceipt` (usa `businessToNegocio` + `getPrinterName`, igual que el cobro).

Reusar el patrón del modal de "Guardadas". El armado del payload de reimpresión reutiliza los datos persistidos (folio + timbre), sin volver a llamar al SII.

- [ ] **Step 3: Verificar tipos y build**

Run: `pnpm build && pnpm test`
Expected: sin errores; tests verdes.

- [ ] **Step 4: Verificación manual**

`pnpm tauri dev`. En "Boletas del día": una boleta `emitida` se **reimprime** con su folio+timbre y leyenda "REIMPRESION"; una `pendiente/error` se **reintenta** y pasa a `emitida`.

- [ ] **Step 5: Commit**

```bash
git add src/data/sales.ts src/modules/venta/VentaScreen.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(sii): panel boletas del dia con reintento y reimpresion (folio+timbre persistidos)"
```

---

## Self-review (cobertura del spec)

- Edge Function server-side con secrets → Task 2. Migración columnas DTE → Task 1.
- Folio SII como número de boleta + timbre PNG raster + reimpresión → Task 3.
- Cobro no bloqueante (emitir best-effort; pendiente si falla) → Task 4.
- Persistencia del timbre y reimpresión sin re-llamar al SII; reintento de pendientes → Task 5.
- Ambiente demo/certificación (cero emisión real) → secrets demo en Task 2.
- Idempotencia (no doble emisión) → chequeo `dte_status='emitida'` en la Edge Function (Task 2).

### Riesgos a validar al probar (documentados, no placeholders)
- El **RUT emisor** en demo debe ser uno autorizado por la cuenta demo (por eso es configurable vía secret `SIMPLEFACTURA_RUT_EMISOR`); si la demo exige otro emisor/datos, se ajusta el secret.
- El formato exacto del **token** en la respuesta de `/token` (string plano vs. objeto) — el código tolera comillas; si viene como objeto `{ token }`, ajustar `sfToken`.
- Umbral/*nitidez* del **timbre PNG** en 80mm: si sale muy grande/chico, ajustar escala antes de rasterizar.
