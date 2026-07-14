# Módulo de Notas de Crédito Electrónicas (DTE 61) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la nota de crédito de un modal en Ventas a un módulo propio que emite el DTE 61 al SII (anula/devuelve una boleta buscada por folio), imprime comprobante con timbre y lista las NC emitidas.

**Architecture:** Mismo patrón que boletas: una RPC registra la NC local y repone stock, una Edge Function service-role emite el DTE 61 a SimpleFactura y persiste folio/timbre, el frontend orquesta y luego imprime. UI en módulo propio (`src/modules/notas-credito/`) con dos pantallas (listado + nueva NC de pantalla completa), acceso admin/kromi.

**Tech Stack:** React + Vite + TypeScript, TanStack Query, Supabase (Postgres + Edge Functions Deno), Tauri (Rust, ESC/POS), SimpleFactura API.

## Global Constraints

- DTE de nota de crédito: `TipoDTE = 61`. Endpoint `POST /invoiceCreditDebitNotesV2/{sucursal}/{cod_ref}` (motivo = cod_ref).
- `cod_ref`: `1` = anula boleta completa; `3` = devolución parcial (corrige montos).
- Referencia obligatoria a la boleta: `TpoDocRef=39`, `FolioRef = sale.dte_folio` (folio SII, NO el interno), `FchRef =` fecha de la boleta, `CodRef`, `RazonRef =` motivo.
- El emisor del 61 lleva **Acteco** (a diferencia de la boleta). Receptor consumidor final `66666666-6`.
- Montos del DTE en **netos** (la boleta viene con IVA incluido); línea-resumen por el neto total.
- El timbre se pide en **producción**: `ambiente = 1` en `/dte/timbre`.
- Acceso al módulo: `RequireRole allow=["admin","kromi"]`.
- Commits firmados como `Cromilakis <ipcromilakis@gmail.com>`, sin coautoría ni atribución a Claude.
- Precondición de negocio: solo se puede hacer NC de una boleta con `dte_status='emitida'` (tiene `dte_folio`).

---

## File Structure

**Crear:**
- `supabase/migrations/20260714090000_credit_note_dte.sql` — columnas DTE + `cod_ref` en `credit_note`; redefine la RPC.
- `supabase/functions/emitir-nota-credito/index.ts` — Edge Function DTE 61.
- `supabase/functions/emitir-nota-credito/.env.example` — vars de entorno.
- `src/modules/notas-credito/NotasCreditoScreen.tsx` — listado.
- `src/modules/notas-credito/NuevaNotaCredito.tsx` — pantalla nueva NC (reutiliza lógica del diálogo).

**Modificar:**
- `src/data/sii.ts` — `emitirNotaCreditoDte(ncId)`.
- `src/data/sales.ts` — `useCreditNotes(branchId)`, `CreditNoteRow`; `emitirNotaCredito` gana `p_cod_ref`.
- `src/App.tsx` — rutas `notas-credito` y `notas-credito/nueva` bajo `RequireRole`.
- `src/session/nav.ts` — item admin "Notas de crédito".
- `src/shell/AppLayout.tsx` — icono en `NAV_ICON`.
- `src/modules/venta/VentaScreen.tsx` — quitar botón + `<CreditNoteDialog>`.
- `src/lib/print.ts` — `CreditNotePayload` TS gana `dte_folio` + `timbre_png`.
- `src-tauri/src/escpos.rs` — `CreditNotePayload` struct + `build_credit_note` renderizan timbre.
- `supabase/tests/schema_test.sql`, `supabase/tests/rpc_test.sql` — aserciones.

**Eliminar:**
- `src/modules/venta/CreditNoteDialog.tsx` — su lógica se traslada a `NuevaNotaCredito.tsx`.

---

## Task 1: Migración — columnas DTE + `cod_ref` en `credit_note`

**Files:**
- Create: `supabase/migrations/20260714090000_credit_note_dte.sql`
- Test: `supabase/tests/schema_test.sql`

**Interfaces:**
- Produces: tabla `credit_note` con columnas `dte_status`, `dte_folio`, `dte_timbre`, `dte_track_id`, `emitted_at`, `cod_ref`.

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/20260714090000_credit_note_dte.sql
-- Estado de emisión del DTE 61 por nota de crédito + cod_ref de la referencia.
-- Las escribe la Edge Function emitir-nota-credito (service role); el cliente solo lee.
alter table public.credit_note add column dte_status text not null default 'pendiente'
  check (dte_status in ('pendiente','emitida','rechazada','error'));
alter table public.credit_note add column dte_folio int;
alter table public.credit_note add column dte_timbre text;      -- PNG del timbre en base64
alter table public.credit_note add column dte_track_id text;
alter table public.credit_note add column emitted_at timestamptz;
alter table public.credit_note add column cod_ref smallint;     -- 1 = anula, 3 = devolución parcial
```

- [ ] **Step 2: Agregar aserciones al test de esquema**

En `supabase/tests/schema_test.sql`, añadir (siguiendo el estilo existente de comprobación de columnas):

```sql
-- credit_note gana columnas DTE
select has_column('public', 'credit_note', 'dte_status', 'credit_note.dte_status existe');
select has_column('public', 'credit_note', 'dte_folio',  'credit_note.dte_folio existe');
select has_column('public', 'credit_note', 'dte_timbre', 'credit_note.dte_timbre existe');
select has_column('public', 'credit_note', 'cod_ref',    'credit_note.cod_ref existe');
```

(Si `schema_test.sql` no usa pgTAP `has_column`, replicar el patrón de aserción que ya use el archivo — revisar sus primeras líneas.)

- [ ] **Step 3: Resetear la base y correr tests de esquema**

Run: `pnpm db:reset && pnpm test:db`
Expected: PASS, incluyendo las nuevas aserciones de `credit_note`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714090000_credit_note_dte.sql supabase/tests/schema_test.sql
git commit -m "feat(nc): columnas DTE y cod_ref en credit_note"
```

---

## Task 2: RPC `emitir_nota_credito` — `p_cod_ref` + precio de la boleta

**Files:**
- Modify: `supabase/migrations/20260714090000_credit_note_dte.sql` (append; la RPC se redefine en la misma migración del feature)
- Test: `supabase/tests/rpc_test.sql`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `emitir_nota_credito(p_branch uuid, p_session uuid, p_sale uuid, p_method sale_method, p_reason text, p_lines jsonb, p_cod_ref smallint)` → `credit_note`. Para NC por boleta usa `sale_line.price_snapshot`; guarda `cod_ref`.

- [ ] **Step 1: Añadir a la migración el DROP + CREATE de la RPC**

Cambiar la firma requiere recrearla. Append a `20260714090000_credit_note_dte.sql`:

```sql
-- Redefinir emitir_nota_credito: nuevo parámetro p_cod_ref + precio desde la boleta.
drop function if exists public.emitir_nota_credito(uuid, uuid, uuid, public.sale_method, text, jsonb);

create or replace function public.emitir_nota_credito(
  p_branch  uuid,
  p_session uuid,
  p_sale    uuid,
  p_method  public.sale_method,
  p_reason  text,
  p_lines   jsonb,
  p_cod_ref smallint
)
returns public.credit_note
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_total    int := 0;
  v_neto     int;
  v_iva      int;
  v_folio    int;
  v_nc       public.credit_note;
  ln         record;
  v_price    int;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la nota de crédito no tiene líneas';
  end if;

  -- Precio de referencia: si la NC es por boleta, usar el precio congelado de la venta
  -- (price_snapshot); si es manual (sin boleta), el precio actual del producto.
  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    if p_sale is not null then
      select price_snapshot into v_price
        from public.sale_line
        where sale_id = p_sale and product_id = ln.product_id
        limit 1;
    end if;
    if v_price is null then
      select price into v_price from public.product where id = ln.product_id;
    end if;
    v_total := v_total + ln.qty * v_price;
    v_price := null;
  end loop;

  v_neto  := round(v_total / 1.19);
  v_iva   := v_total - v_neto;
  v_folio := public.siguiente_folio(p_branch, 'credit_note');

  insert into public.credit_note (business_id, branch_id, cash_session_id, folio, sale_id,
                                  method, reason, total, neto, iva, cashier_id, cod_ref)
  values (v_business, p_branch, p_session, v_folio, p_sale,
          p_method, p_reason, v_total, v_neto, v_iva, auth.uid(), p_cod_ref)
  returning * into v_nc;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           coalesce((e->>'restock')::boolean, false) as restock
      from jsonb_array_elements(p_lines) e
  loop
    -- Snapshot del precio: de la boleta si existe, si no del producto.
    if p_sale is not null then
      select price_snapshot into v_price
        from public.sale_line where sale_id = p_sale and product_id = ln.product_id limit 1;
    end if;
    insert into public.credit_note_line (credit_note_id, product_id, name_snapshot, price_snapshot, qty, restock)
    select v_nc.id, p.id, p.name, coalesce(v_price, p.price), ln.qty, ln.restock
      from public.product p where p.id = ln.product_id;
    v_price := null;

    if ln.restock then
      insert into public.inventory (product_id, branch_id, stock)
      values (ln.product_id, p_branch, ln.qty)
      on conflict (product_id, branch_id)
        do update set stock = public.inventory.stock + ln.qty;
    end if;
  end loop;

  return v_nc;
end;
$$;
```

- [ ] **Step 2: Test — la NC por boleta usa el precio de la venta**

En `supabase/tests/rpc_test.sql`, siguiendo el patrón del archivo (seed de business/branch/product/sale), agregar un caso: crear un producto con precio actual distinto al `price_snapshot` de una venta, emitir NC por esa venta con `p_cod_ref=1`, y verificar que `credit_note.total` usa el `price_snapshot`, y que `cod_ref = 1`.

```sql
-- Pseudocolumna de aserción (adaptar a los helpers del archivo):
-- 1) insert product price=1000; insert sale + sale_line price_snapshot=800, qty=1
-- 2) update product set price=1000  (cambia el precio "actual")
-- 3) select emitir_nota_credito(branch, session, sale_id, 'efectivo', 'anula', '[{"product_id":..,"qty":1,"restock":true}]'::jsonb, 1);
-- 4) assert: (select total from credit_note where ...) = 800   -- usó snapshot, no 1000
-- 5) assert: (select cod_ref from credit_note where ...) = 1
```

- [ ] **Step 3: Correr tests de RPC**

Run: `pnpm db:reset && pnpm test:db`
Expected: PASS incluyendo el nuevo caso (total = price_snapshot).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714090000_credit_note_dte.sql supabase/tests/rpc_test.sql
git commit -m "feat(nc): emitir_nota_credito usa precio de la boleta y guarda cod_ref"
```

---

## Task 3: Edge Function `emitir-nota-credito`

**Files:**
- Create: `supabase/functions/emitir-nota-credito/index.ts`
- Create: `supabase/functions/emitir-nota-credito/.env.example`

**Interfaces:**
- Consumes: columnas de Task 1; RPC de Task 2 ya dejó la `credit_note` con `cod_ref`, `total`, `neto`, `iva`, `sale_id`, `reason`.
- Produces: `POST { credit_note_id }` → `{ status: "emitida"|"rechazada"|"error", folio?, timbre_png?, message? }`. Persiste `dte_*` en `credit_note`.

- [ ] **Step 1: Escribir la función** (clon de `emitir-boleta/index.ts` con DTE 61)

```typescript
// supabase/functions/emitir-nota-credito/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
const SUCURSAL = (Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz").replace(/\s+/g, "_");
const ACTECO = Number(Deno.env.get("SIMPLEFACTURA_ACTECO") ?? "477397");
const EMISOR = {
  RUTEmisor: Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1",
  RznSoc: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmis: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  Acteco: [ACTECO],
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { credit_note_id } = await req.json();
    if (!credit_note_id) return json({ status: "error", message: "credit_note_id requerido" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: nc, error: e1 } = await admin
      .from("credit_note")
      .select("id,folio,neto,iva,total,reason,cod_ref,dte_status,dte_folio,dte_timbre,sale_id")
      .eq("id", credit_note_id).single();
    if (e1 || !nc) return json({ status: "error", message: "nota de crédito no encontrada" }, 404);

    if (nc.dte_status === "emitida" && nc.dte_folio) {
      return json({ status: "emitida", folio: nc.dte_folio, timbre_png: nc.dte_timbre });
    }
    if (!nc.sale_id) return json({ status: "error", message: "la NC no referencia una boleta" }, 400);

    // Boleta referenciada: necesita el folio SII y su fecha de emisión.
    const { data: sale, error: e2 } = await admin
      .from("sale").select("dte_folio,emitted_at").eq("id", nc.sale_id).single();
    if (e2 || !sale) return json({ status: "error", message: "boleta no encontrada" }, 404);
    if (!sale.dte_folio) return json({ status: "error", message: "la boleta no está emitida en el SII" }, 409);

    const codRef = nc.cod_ref ?? 1;
    const fchRef = sale.emitted_at ? isoDate(new Date(sale.emitted_at)) : isoDate(new Date());
    const razon = codRef === 1 ? "ANULA BOLETA ELECTRONICA" : "DEVOLUCION MERCADERIA";

    const body = {
      Documento: {
        Encabezado: {
          IdDoc: { TipoDTE: 61, FchEmis: isoDate(new Date()), FchVenc: isoDate(new Date()), FmaPago: 1 },
          Emisor: EMISOR,
          Receptor: { RUTRecep: "66666666-6", RznSocRecep: "Cliente sin especificar", DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago" },
          Totales: { MntNeto: String(nc.neto), TasaIVA: "19", IVA: String(nc.iva), MntTotal: String(nc.total) },
        },
        Detalle: [{
          NroLinDet: "1",
          NmbItem: `${razon} N ${sale.dte_folio}`,
          QtyItem: "1", PrcItem: String(nc.neto), MontoItem: String(nc.neto),
        }],
        Referencia: [{
          NroLinRef: 1, TpoDocRef: "39", FolioRef: String(sale.dte_folio),
          FchRef: fchRef, CodRef: codRef, RazonRef: nc.reason ?? razon,
        }],
      },
    };

    const emit = await fetch(`${SF_URL}/invoiceCreditDebitNotesV2/${SUCURSAL}/${codRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await sfToken()}` },
      body: JSON.stringify(body),
    });
    const emitText = await emit.text();
    if (!emit.ok) {
      await admin.from("credit_note").update({ dte_status: "error" }).eq("id", credit_note_id);
      return json({ status: "error", message: `emision ${emit.status}: ${emitText}` }, 502);
    }
    const emitJson = JSON.parse(emitText);
    const folio = emitJson?.data?.folio;
    if (!folio) {
      await admin.from("credit_note").update({ dte_status: "rechazada" }).eq("id", credit_note_id);
      return json({ status: "rechazada", message: emitJson?.message ?? "sin folio" }, 200);
    }

    let timbre_png: string | null = null;
    try {
      const token = await sfToken();
      const tr = await fetch(`${SF_URL}/dte/timbre`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          credenciales: { rutEmisor: EMISOR.RUTEmisor },
          dteReferenciadoExterno: { folio, codigoTipoDte: 61, ambiente: SF_AMBIENTE },
        }),
      });
      if (tr.ok) timbre_png = JSON.parse(await tr.text())?.data ?? null;
    } catch (_) { /* noop */ }

    await admin.from("credit_note").update({
      dte_status: "emitida", dte_folio: folio, dte_timbre: timbre_png, emitted_at: new Date().toISOString(),
    }).eq("id", credit_note_id);

    return json({ status: "emitida", folio, timbre_png });
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});
```

- [ ] **Step 2: `.env.example`**

```
SIMPLEFACTURA_URL=https://api.simplefactura.cl
SIMPLEFACTURA_EMAIL=
SIMPLEFACTURA_PASSWORD=
SIMPLEFACTURA_AMBIENTE=1
SIMPLEFACTURA_SUCURSAL=Planta_con_Mati
SIMPLEFACTURA_RUT_EMISOR=78444692-1
SIMPLEFACTURA_RZN=SAN JOSE SPA
SIMPLEFACTURA_GIRO=VENTA AL POR MENOR DE FLORES, PLANTA
SIMPLEFACTURA_ACTECO=477397
SIMPLEFACTURA_DIR=GRAL URRUTIA 630 LOCAL 104
SIMPLEFACTURA_CMNA=Villarrica
```

- [ ] **Step 3: Desplegar y verificar secrets**

Run: `supabase functions deploy emitir-nota-credito`
Confirmar en el dashboard que `SIMPLEFACTURA_*` (incluido `AMBIENTE=1` y los del emisor San José) están seteados para la función (los mismos secrets que `emitir-boleta`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/emitir-nota-credito/
git commit -m "feat(nc): Edge Function emitir-nota-credito (DTE 61)"
```

---

## Task 4: Capa de datos frontend — `sii.ts` y `sales.ts`

**Files:**
- Modify: `src/data/sii.ts`
- Modify: `src/data/sales.ts`

**Interfaces:**
- Produces: `emitirNotaCreditoDte(ncId: string): Promise<EmitirResult>`; `useCreditNotes(branchId?: string)`; `CreditNoteRow`; `emitirNotaCredito` acepta `p_cod_ref`.

- [ ] **Step 1: `emitirNotaCreditoDte` en `sii.ts`** (réplica de `emitirBoleta`, cambiando función y body)

```typescript
// Agregar en src/data/sii.ts, junto a emitirBoleta:
export async function emitirNotaCreditoDte(creditNoteId: string): Promise<EmitirResult> {
  const { data, error } = await supabase.functions.invoke("emitir-nota-credito", {
    body: { credit_note_id: creditNoteId },
  });
  if (error) {
    let message = error.message;
    try { message = (await (error as { context?: Response }).context?.json())?.message ?? message; } catch { /* noop */ }
    return { status: "error", message };
  }
  return data as EmitirResult;
}
```
(Si `emitirBoleta` extrae el mensaje de error de otra forma, replicar exactamente ese patrón.)

- [ ] **Step 2: `emitirNotaCredito` acepta `p_cod_ref`** en `sales.ts`

Modificar la firma y el `rpc(...)` de `emitirNotaCredito` (líneas 241-260) para incluir `p_cod_ref: 1 | 3`:

```typescript
export async function emitirNotaCredito(args: {
  p_branch: string; p_session: string | null; p_sale: string | null;
  p_method: "efectivo" | "tarjeta"; p_reason: string;
  p_lines: CreditNoteLineInput[]; p_cod_ref: 1 | 3;
}): Promise<CreditNote> {
  if (!args.p_lines.length) throw new Error("La nota de crédito no tiene líneas.");
  const { data, error } = await supabase.rpc("emitir_nota_credito", {
    p_branch: args.p_branch, p_session: args.p_session, p_sale: args.p_sale,
    p_method: args.p_method, p_reason: args.p_reason, p_lines: args.p_lines,
    p_cod_ref: args.p_cod_ref,
  });
  if (error) throw error;
  return data as CreditNote;
}
```

- [ ] **Step 3: `useCreditNotes` + `CreditNoteRow`** en `sales.ts` (patrón de `useSalesTodayDte`/`useQuotes`)

```typescript
export interface CreditNoteRow {
  id: string; folio: number; total: number; reason: string | null; created_at: string;
  dte_status: string; dte_folio: number | null; dte_timbre: string | null;
  sale_id: string | null; cod_ref: number | null; method: string;
  lines: { name_snapshot: string; price_snapshot: number; qty: number }[];
}

export function useCreditNotes(branchId: string | undefined) {
  return useQuery({
    queryKey: ["credit-notes", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<CreditNoteRow[]> => {
      const { data, error } = await supabase
        .from("credit_note")
        .select("id,folio,total,reason,created_at,dte_status,dte_folio,dte_timbre,sale_id,cod_ref,method,credit_note_line(name_snapshot,price_snapshot,qty)")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        id: c.id, folio: c.folio, total: c.total, reason: c.reason, created_at: c.created_at,
        dte_status: c.dte_status, dte_folio: c.dte_folio, dte_timbre: c.dte_timbre,
        sale_id: c.sale_id, cod_ref: c.cod_ref, method: c.method,
        lines: c.credit_note_line ?? [],
      }));
    },
  });
}
```

- [ ] **Step 4: Verificar compilación**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/data/sii.ts src/data/sales.ts
git commit -m "feat(nc): emitirNotaCreditoDte, useCreditNotes y p_cod_ref"
```

---

## Task 5: Módulo — `NotasCreditoScreen` (listado) + navegación

**Files:**
- Create: `src/modules/notas-credito/NotasCreditoScreen.tsx`
- Modify: `src/App.tsx`, `src/session/nav.ts`, `src/shell/AppLayout.tsx`

**Interfaces:**
- Consumes: `useCreditNotes`, `emitirNotaCreditoDte` (Task 4); `printCreditNote` (`src/lib/print.ts`).
- Produces: ruta `/notas-credito`.

- [ ] **Step 1: Navegación — `nav.ts`** (convertir `ADMIN` en lista)

```typescript
const ADMIN: NavItem[] = [
  { to: "/admin", label: "Administración" },
  { to: "/notas-credito", label: "Notas de crédito" },
];
export function navForRole(role: Role): NavItem[] {
  return role === "admin" || role === "kromi" ? [...BASE, ...ADMIN] : BASE;
}
```

- [ ] **Step 2: Icono — `AppLayout.tsx`**

Importar `FileMinus` de `lucide-react` y añadir a `NAV_ICON`: `"Notas de crédito": FileMinus`.

- [ ] **Step 3: Rutas — `App.tsx`**

Añadir imports y rutas bajo un wrapper de rol (patrón `AdminRoute`):

```tsx
import { NotasCreditoScreen } from "@/modules/notas-credito/NotasCreditoScreen";
import { NuevaNotaCredito } from "@/modules/notas-credito/NuevaNotaCredito";
// ...dentro del <Route element={AppLayout}>:
<Route path="notas-credito" element={
  <RequireRole role={profile?.role} allow={["admin", "kromi"]}><NotasCreditoScreen /></RequireRole>
} />
<Route path="notas-credito/nueva" element={
  <RequireRole role={profile?.role} allow={["admin", "kromi"]}><NuevaNotaCredito /></RequireRole>
} />
```
(`profile` viene de `useAuth()` — mover el `AdminRoute` a un patrón que exponga `profile` en `App`, o envolver cada ruta como hace `AdminRoute`.)

- [ ] **Step 4: `NotasCreditoScreen.tsx`** — listado con estado DTE, reimprimir, reintentar

```tsx
import { useNavigate } from "react-router-dom";
import { useCreditNotes, type CreditNoteRow } from "@/data/sales";
import { emitirNotaCreditoDte } from "@/data/sii";
import { printCreditNote } from "@/lib/print";
// ...usar branchId del contexto de sesión igual que VentaScreen (useAuth/useBranch).

// Render: cabecera con botón "Nueva nota de crédito" → navigate("/notas-credito/nueva").
// Tabla: folio, dte_folio (boleta ref via sale — mostrar dte_folio de la NC y la boleta),
//   fecha (created_at), total, motivo (reason), badge de estado (dte_status).
// Acciones por fila:
//   - "Reimprimir" (si dte_status === "emitida"): arma el payload (ver Task 8) e invoca printCreditNote.
//   - "Reintentar" (si dte_status !== "emitida"): await emitirNotaCreditoDte(row.id); refetch.
```
Seguir el estilo visual de `CotizacionesScreen`/`StockScreen` (tabla shadcn, badges). El `branchId` se obtiene igual que en esas pantallas.

- [ ] **Step 5: Verificar en la app**

Run: `pnpm tauri dev` — entrar como admin, ver "Notas de crédito" en el menú, abrir el listado (vacío o con NC previas), sin errores de consola.

- [ ] **Step 6: Commit**

```bash
git add src/modules/notas-credito/NotasCreditoScreen.tsx src/App.tsx src/session/nav.ts src/shell/AppLayout.tsx
git commit -m "feat(nc): módulo Notas de crédito con listado y navegación admin"
```

---

## Task 6: `NuevaNotaCredito` — pantalla completa + flujo de emisión

**Files:**
- Create: `src/modules/notas-credito/NuevaNotaCredito.tsx`

**Interfaces:**
- Consumes: `buscarVentaPorFolio`, `emitirNotaCredito` (con `p_cod_ref`), `emitirNotaCreditoDte`, `printCreditNote`.
- Produces: ruta `/notas-credito/nueva`; al emitir OK vuelve al listado.

- [ ] **Step 1: Portar la lógica de `CreditNoteDialog` a una vista de pantalla**

Reutilizar del actual `CreditNoteDialog.tsx` (SIN el modo "manual" ni el `<Dialog>`): estado de folio buscado, `handleBuscarFolio` → `buscarVentaPorFolio`, líneas precargadas con `maxQty`, toggle `restock`, `reason`, `method`. Layout de pantalla completa (no modal) según el mockup del spec, con `[← Volver al listado]` (`useNavigate`).

- [ ] **Step 2: Selector anular / devolver → `cod_ref`**

Radio "Anular boleta completa" vs "Devolver líneas seleccionadas".
- Anular: `cod_ref = 1`, líneas = todas las de la boleta con su `qty` completa, restock por defecto.
- Devolver: `cod_ref = 3`, solo líneas marcadas con su cantidad (≤ vendida).

- [ ] **Step 3: `handleEmitir` — cadena completa**

```tsx
async function handleEmitir() {
  // 1) registro local + stock
  const nc = await emitirNotaCredito({
    p_branch: branchId, p_session: sessionId, p_sale: foundSale.id,
    p_method: method, p_reason: reason, p_lines: lines, p_cod_ref: codRef,
  });
  // 2) emisión DTE 61 al SII
  const em = await emitirNotaCreditoDte(nc.id);
  if (em.status !== "emitida" || !em.folio) {
    toast.error("La NC quedó pendiente de emisión. Reintentar desde el listado.");
    navigate("/notas-credito");
    return;
  }
  // 3) imprimir comprobante CON timbre (payload de Task 8)
  await printCreditNote({
    negocio: businessToNegocio(business, getPrinterName()),
    folio: nc.folio, fecha, hora, sale_folio: foundSale.dte_folio ?? foundSale.folio,
    metodo: method, motivo: reason,
    items: lines.map(l => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot })),
    neto: nc.neto, iva: nc.iva, total: nc.total,
    dte_folio: em.folio, timbre_png: em.timbre_png ?? null,
  });
  toast.success(`Nota de crédito ${em.folio} emitida`);
  navigate("/notas-credito");
}
```
Precondición en UI: si `foundSale.dte_status !== "emitida"` o falta `dte_folio`, deshabilitar "Emitir" y mostrar "La boleta no está emitida en el SII" (para eso `buscarVentaPorFolio` debe traer `dte_status,dte_folio` — extender su `select`).

- [ ] **Step 4: Extender `buscarVentaPorFolio`** (en `sales.ts`) para traer `dte_status,dte_folio,emitted_at` en el `select` y en `SaleWithLines`.

- [ ] **Step 5: Verificar en la app**

Run: `pnpm tauri dev` — nueva NC, buscar una boleta emitida (p. ej. 5002), anular, emitir. Verificar folio SII, aceptación (traza) y comprobante con timbre. Verificar que una boleta pendiente bloquea "Emitir".

- [ ] **Step 6: Commit**

```bash
git add src/modules/notas-credito/NuevaNotaCredito.tsx src/data/sales.ts
git commit -m "feat(nc): pantalla nueva NC con emisión DTE 61 e impresión"
```

---

## Task 7: Sacar la NC de Ventas

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`
- Delete: `src/modules/venta/CreditNoteDialog.tsx`

- [ ] **Step 1: Quitar de `VentaScreen.tsx`** el estado `ncOpen`, el botón que hace `setNcOpen(true)` (~línea 486) y el `<CreditNoteDialog .../>` (~línea 679). Quitar el import de `CreditNoteDialog`.

- [ ] **Step 2: Eliminar el archivo**

```bash
git rm src/modules/venta/CreditNoteDialog.tsx
```

- [ ] **Step 3: Verificar compilación y app**

Run: `pnpm build && pnpm tauri dev`
Expected: sin referencias colgantes a `CreditNoteDialog`; Ventas sin el botón de NC.

- [ ] **Step 4: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
git commit -m "refactor(nc): quitar nota de crédito del módulo de ventas"
```

---

## Task 8: Comprobante con timbre — `escpos.rs` + `print.ts`

**Files:**
- Modify: `src-tauri/src/escpos.rs` (struct `CreditNotePayload` + `build_credit_note`)
- Modify: `src/lib/print.ts` (tipo del payload)

**Interfaces:**
- Consumes: `dte_folio` + `timbre_png` del payload que arma Task 6.
- Produces: comprobante ESC/POS con PDF417 cuando hay timbre.

- [ ] **Step 1: Test Rust — el comprobante con timbre no lleva "no tributario"**

En `src-tauri/src/escpos.rs` (mod tests), añadir:

```rust
#[test]
fn credit_note_con_timbre_es_tributaria() {
    let p = CreditNotePayload {
        negocio: sample_negocio(), folio: 1, fecha: "2026-07-13".into(), hora: "20:19".into(),
        sale_folio: Some(5001), metodo: "efectivo".into(), motivo: "anula".into(),
        items: vec![], neto: 5, iva: 1, total: 6,
        dte_folio: Some(1), timbre_png: None,
    };
    let bytes = build_credit_note(&p);
    let txt = String::from_utf8_lossy(&bytes);
    // Con dte_folio presente ya es tributaria: no debe decir "Documento no tributario".
    assert!(!txt.contains("no tributario"));
    assert!(txt.contains("No 1"));
}
```
(Usar el helper de negocio de muestra que ya exista en el mod tests; si no existe, construir un `Negocio` mínimo como en los otros tests del archivo.)

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd src-tauri && cargo test credit_note_con_timbre`
Expected: FAIL (falta el campo `dte_folio`/`timbre_png` en el struct; hoy siempre imprime "no tributario").

- [ ] **Step 3: Extender el struct**

```rust
#[derive(Deserialize, Clone)]
pub struct CreditNotePayload {
    pub negocio: Negocio,
    pub folio: u32,
    pub fecha: String,
    pub hora: String,
    pub sale_folio: Option<u32>,
    pub metodo: String,
    pub motivo: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
    #[serde(default)] pub dte_folio: Option<u32>,
    #[serde(default)] pub timbre_png: Option<String>,
}
```

- [ ] **Step 4: Renderizar timbre en `build_credit_note`**

Reemplazar el bloque final (líneas 562-565, el footer "Documento no tributario") por el patrón del `build` de boleta (líneas 318-330): si hay `timbre_png` válido, imprimir el PDF417 + "Timbre Electronico SII / Res. 80 de 2014"; si no, mantener el footer no tributario (fallback, no debería ocurrir porque solo se imprime tras emisión OK). Añadir también `No {dte_folio}` del SII en la caja o bajo el folio interno.

```rust
    // pie: timbre SII si la NC ya fue emitida
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    match &p.timbre_png {
        Some(png) if timbre_png(&mut b, png) => {
            push_text(&mut b, "Timbre Electronico SII"); nl(&mut b);
            push_text(&mut b, "Res. 80 de 2014 - www.sii.cl"); nl(&mut b);
        }
        _ => { push_text(&mut b, "Documento no tributario"); nl(&mut b); }
    }
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
```

- [ ] **Step 5: Correr el test para verlo pasar**

Run: `cd src-tauri && cargo test credit_note_con_timbre`
Expected: PASS.

- [ ] **Step 6: Tipo TS del payload — `print.ts`**

Extender el tipo del argumento de `printCreditNote` con `dte_folio?: number` y `timbre_png?: string | null`.

- [ ] **Step 7: Verificar impresión real**

Run: `pnpm tauri dev` — emitir una NC de prueba y confirmar que el comprobante sale con PDF417 y sin "Documento no tributario".

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/escpos.rs src/lib/print.ts
git commit -m "feat(nc): comprobante de nota de crédito con timbre SII"
```

---

## Self-Review (post-escritura)

- **Cobertura del spec:** módulo propio (T5/T6), búsqueda por folio (T6, reutiliza `buscarVentaPorFolio`), anular+parcial con cod_ref (T2/T6), emisión DTE 61 (T3), listado (T4/T5), impresión con timbre (T8), sacar de ventas (T7), precondición boleta emitida (T3/T6). ✓
- **Validación pendiente declarada:** devolución parcial (CodRef 3) se prueba en T6 Step 5 con un folio de NC real.
- **Riesgo de folios:** T3/T6 consumen folios de NC reales (quedan 2). Antes de las pruebas end-to-end, solicitar más folios de NC de producción.
