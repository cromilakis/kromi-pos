# Lote de 8 mejoras — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar las 8 mejoras del lote (factura desde el cobro, bloqueo de caja de día anterior, arqueo sin "gracias", doble-clic en stock, fix de NC por folio SII + NC para factura, filtro de historial por medio de pago, vuelto fijo, y pestaña de folios en Admin).

**Architecture:** Casi todo frontend + 1 Edge Function nueva (folios) + 1 Edge Function modificada (issue-credit-note). Sin cambios de esquema. Ejecución por clusters, subagentes secuenciales con review.

**Tech Stack:** React + TS (Vitest), Rust (escpos), Deno Edge Functions, Supabase, SimpleFactura API.

## Global Constraints

- **Sin migraciones de BD** en este lote (los datos ya existen). La única migración a validar sobre el respaldo es la del redondeo (`20260719120000`), aparte.
- **Producción:** no emitir DTE reales para probar; validación solo en cuenta demo (ambiente 0). NC (#5): solo dejar el código listo, sin emitir.
- Commit identity = `Cromilakis <ipcromilakis@gmail.com>`; prohibido `Co-Authored-By` y atribución a Claude. Nunca `git add -A`.
- Prosa español, identificadores inglés.
- **Búsqueda de folio (#5): SIEMPRE por `dte_folio` (folio SII), nunca por el correlativo interno.**
- **#2 = bloqueo duro** (no permite vender hasta cerrar la caja del día anterior).
- **#8 = tipos 39 (boleta), 33 (factura), 61 (NC).**

## Orden y conflictos de archivo
Ejecutar secuencial en este orden. Archivos por tarea (para referencia de no-conflicto):
T1 escpos.rs · T2 StockScreen.tsx · T3 salesHistory.ts+HistorialScreen.tsx · T4 PayDialog.tsx · T5 work.ts+VentaScreen.tsx · T6 (factura) PayDialog.tsx+VentaScreen.tsx+CustomerPickerDialog.tsx · T7 sales.ts · T8 issue-credit-note/index.ts · T9 functions/folios/+data/folios.ts · T10 AdminScreen.tsx (+ sub-componente Folios).

---

### Task 1 (#3): Quitar "Gracias por tu compra" del comprobante de arqueo

**Files:** Modify `src-tauri/src/escpos.rs` (`build_cierre` + test).

- [ ] **Step 1: Test que falla**

En `mod tests` de `escpos.rs`, agregar:

```rust
    #[test]
    fn cierre_no_incluye_gracias_por_compra() {
        let b = build_cierre(&sample_cierre(192300));
        assert!(!contains(&b, b"Gracias"));
    }
```
(El `sample_cierre` usa `footer: "Gracias por tu compra!"`.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd src-tauri && cargo test escpos::tests::cierre_no_incluye_gracias`
Expected: FAIL (hoy imprime el footer).

- [ ] **Step 3: Quitar el footer del arqueo**

En `build_cierre()`, eliminar el bloque que imprime el footer (las 3 líneas):

```rust
    // pie
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
```

(Es el bloque previo al feed+corte final de `build_cierre`, ~línea 461-464. NO tocar el footer en `build` ni en `build_credit_note`.)

- [ ] **Step 4: Correr todos los tests de escpos**

Run: `cd src-tauri && cargo test escpos`
Expected: PASS (incl. el nuevo; los demás siguen verdes).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/escpos.rs
git commit -m "fix(arqueo): quitar 'gracias por tu compra' del comprobante de cierre"
```

---

### Task 2 (#4): Doble clic en un producto de Stock abre el editor

**Files:** Modify `src/modules/stock/StockScreen.tsx`.

- [ ] **Step 1: Localizar la fila del producto y el editor**

Leer `StockScreen.tsx`. El botón lápiz ejecuta `setEditing(p)` (abre el popup de edición). Identificar el elemento de fila del producto en la lista (el `<tr>`/`<div>` que representa cada producto `p`).

- [ ] **Step 2: Agregar `onDoubleClick`**

En el contenedor de la fila del producto, agregar `onDoubleClick={() => setEditing(p)}` (mismo handler que el lápiz). Cuidar no interferir con los botones de acción de la fila (el doble clic sobre la fila, no sobre los botones). Sin cambios de datos.

- [ ] **Step 3: Verificar**

Run: `pnpm build` (compila). `pnpm test` (sin regresiones).
Verificación visual (manejando la app): doble clic en una fila de Stock abre el mismo popup que el lápiz.

- [ ] **Step 4: Commit**

```bash
git add src/modules/stock/StockScreen.tsx
git commit -m "feat(stock): doble clic en un producto abre el editor"
```

---

### Task 3 (#6): Filtro de historial por medio de pago

**Files:** Modify `src/data/salesHistory.ts`, `src/modules/historial/HistorialScreen.tsx`.

- [ ] **Step 1: Agregar `method` a los filtros del query**

En `src/data/salesHistory.ts`, `interface SalesHistoryFilters`: agregar `method?: "efectivo" | "tarjeta" | null;`. En `useSalesHistory`, donde se aplican los filtros (siguiendo el patrón de `customerId`/`folio`), agregar:

```ts
      if (filters.method) query = query.eq("method", filters.method);
```
(colocarlo junto a los otros `.eq` condicionales; usar el nombre real de la variable de query del archivo).

- [ ] **Step 2: Control de filtro en la UI**

En `HistorialScreen.tsx`, agregar un selector "Medio de pago" (Todos / Efectivo / Tarjeta) siguiendo el patrón de los filtros existentes (estado `method` + botón "Buscar" que ya arma los `appliedX`). Pasar `method` a `useSalesHistory`. Al cambiar y buscar, re-consulta.

- [ ] **Step 3: Verificar**

Run: `pnpm build` + `pnpm test`.
Verificación visual: filtrar por Efectivo/Tarjeta muestra solo esas transacciones.

- [ ] **Step 4: Commit**

```bash
git add src/data/salesHistory.ts src/modules/historial/HistorialScreen.tsx
git commit -m "feat(historial): filtro por medio de pago (efectivo/tarjeta)"
```

---

### Task 4 (#7): El vuelto queda fijo tras confirmar el cobro

**Files:** Modify `src/modules/venta/PayDialog.tsx`.

- [ ] **Step 1: Congelar los valores al confirmar**

En `PayDialog.tsx`, al presionar Confirmar (antes de llamar `onConfirm`), capturar en un estado los valores a mostrar mientras se emite/imprime, para que no se recomputen cuando el `total` (prop) cambie al vaciarse el carrito. Implementación:

- Agregar estado: `const [frozen, setFrozen] = useState<{ payTotal: number; recv: number; change: number } | null>(null);`
- En el `onClick` del botón Confirmar: `setFrozen({ payTotal, recv, change }); onConfirm(method, recv, discountId, pointsRedeem, docType);`
- Al reabrir el diálogo (el `useEffect` sobre `open`), resetear `setFrozen(null)`.
- En el render del bloque de efectivo (recv/vuelto/total a pagar), usar los valores de `frozen` cuando `frozen && busy` (o `frozen` presente); si no, los valores en vivo. Ej.: `const showChange = frozen ? frozen.change : change;` y usar `showChange` en el label del Vuelto (y análogamente payTotal/recv).

Resultado: al confirmar, el Vuelto (y Paga con / Total a pagar) quedan fijos en pantalla durante la emisión e impresión, hasta que el diálogo se cierra.

- [ ] **Step 2: Verificar**

Run: `pnpm build` + `pnpm test`.
Verificación visual: cobrar en efectivo con vuelto; al confirmar, el label del vuelto permanece fijo mientras se genera/imprime la boleta.

- [ ] **Step 3: Commit**

```bash
git add src/modules/venta/PayDialog.tsx
git commit -m "fix(cobro): el vuelto queda fijo tras confirmar hasta cerrar el dialogo"
```

---

### Task 5 (#2): Bloquear Venta si la caja quedó abierta de un día anterior

**Files:** Modify `src/data/work.ts`, `src/modules/venta/VentaScreen.tsx`.

- [ ] **Step 1: Exponer `opened_at` en la sesión abierta**

En `src/data/work.ts` `useOpenSession`: agregar `opened_at` al `.select(...)` (`"id,register_id,status,opened_at"`) y al tipo `CashSession` (agregar `opened_at: string`). Verificar el nombre real del tipo/campo.

- [ ] **Step 2: Bloqueo duro en VentaScreen**

En `src/modules/venta/VentaScreen.tsx`, con `openSession` (de `useOpenSession`): si existe y `opened_at` corresponde a un **día anterior a hoy** (comparación por fecha local, no por hora), renderizar un bloqueo (en vez del carrito) con el mensaje:

> "La caja fue abierta el {fecha de opened_at}. Debes realizar el cierre de caja de ese día antes de comenzar las ventas de hoy."

y un botón/acceso para ir al cierre (abrir el `CierrePanel`/flujo de cierre existente). Helper de comparación por día local:

```ts
function isBeforeToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dDay < today;
}
```

El bloqueo debe anteponerse al render normal de Venta (y convivir con `AbrirCajaGate`: si no hay sesión abierta, sigue el gate de abrir caja; si hay sesión abierta de día anterior, este bloqueo).

- [ ] **Step 3: Verificar**

Run: `pnpm build` + `pnpm test`.
Verificación (con el respaldo local, que puede tener sesiones abiertas de días previos): entrar a Venta con una sesión abierta de ayer → muestra el bloqueo; cerrar esa caja → permite vender.

- [ ] **Step 4: Commit**

```bash
git add src/data/work.ts src/modules/venta/VentaScreen.tsx
git commit -m "feat(caja): bloquear venta si la caja quedo abierta de un dia anterior"
```

---

### Task 6 (#1): Elegir/crear cliente empresa desde el cobro para habilitar Factura

**Files:** Modify `src/modules/venta/PayDialog.tsx`, `src/modules/venta/VentaScreen.tsx`, `src/modules/venta/CustomerPickerDialog.tsx` (y reutilizar `src/modules/clientes/CustomerForm.tsx`).

**Interfaces:**
- Consumes: `CustomerForm` (switch Empresa + datos tributarios, ya existe), `createCustomer`/`updateCustomer` (`@/data/customers`, ya soportan campos empresa), `canFactura`/`selectedCustomer` en `VentaScreen`.

- [ ] **Step 1: Investigar el flujo actual de cliente en el cobro**

Leer `CustomerPickerDialog.tsx` y cómo `VentaScreen` setea `customerId`/`selectedCustomer` y calcula `canFactura`. Confirmar que el picker permite seleccionar clientes empresa existentes pero solo crear simples.

- [ ] **Step 2: Permitir elegir/crear empresa desde el cobro**

Objetivo: que el cajero pueda, dentro del flujo de cobro, seleccionar un cliente (incluida empresa) o crear/marcar uno como empresa con datos tributarios, de modo que `canFactura` se habilite y el botón "Factura" quede disponible sin salir de la venta. Enfoque (elegir el de menor fricción, reutilizando componentes):
- Extender `CustomerPickerDialog` para que su formulario de "nuevo cliente" reutilice `CustomerForm` (que ya tiene el switch Empresa + validación RUT), o
- Agregar en `PayDialog` un acceso "Elegir/crear cliente" que abra el picker (o el `CustomerForm`) y, al seleccionar/crear, actualice `customerId` en `VentaScreen` → recomputa `canFactura`.
- Al crear un cliente empresa, usar `createCustomer` con los campos tributarios; al seleccionar uno existente, `setCustomerId`.

El detalle exacto (modal anidado vs. paso) se resuelve en implementación siguiendo los componentes existentes; requisito: terminar con "Factura" habilitable eligiendo/creando la empresa en el cobro. NO tocar `issue-receipt` (la emisión del 33 ya funciona).

- [ ] **Step 3: Verificar**

Run: `pnpm build` + `pnpm test`.
Verificación (demo/local): en el cobro, elegir/crear un cliente empresa habilita "Factura"; cobrar como factura emite el DTE 33 (validar en demo si se prueba emisión).

- [ ] **Step 4: Commit**

```bash
git add src/modules/venta/PayDialog.tsx src/modules/venta/VentaScreen.tsx src/modules/venta/CustomerPickerDialog.tsx
git commit -m "feat(venta): elegir/crear cliente empresa desde el cobro para habilitar factura"
```

---

### Task 7 (#5a): Búsqueda de venta SIEMPRE por folio SII (`dte_folio`)

**Files:** Modify `src/data/sales.ts`.

- [ ] **Step 1: Cambiar el filtro de folio**

En `buscarVentaPorFolio` (`src/data/sales.ts:344-350`), reemplazar:

```ts
    .eq("branch_id", branchId)
    .eq("folio", folio)
```
por (búsqueda por folio SII, nunca el correlativo interno):

```ts
    .eq("branch_id", branchId)
    .eq("dte_folio", folio)
```

- [ ] **Step 2: Verificar (lectura, con el respaldo local — folio 5033)**

Run: `pnpm build` + `pnpm test`.
Con el respaldo cargado, verificar por lectura que buscar el folio SII **5033** encuentra la venta (antes fallaba). Se puede comprobar con una query directa:

```powershell
docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -c "select id,folio,dte_folio,doc_type,dte_status from public.sale where dte_folio = 5033;"
```
(confirmar que existe una fila con `dte_folio=5033`; el fix hace que la app la encuentre). NO emitir NC.

- [ ] **Step 3: Commit**

```bash
git add src/data/sales.ts
git commit -m "fix(nc): buscar la venta por folio SII (dte_folio), no por el correlativo interno"
```

---

### Task 8 (#5b): NC correcta para boleta (39) y factura (33)

**Files:** Modify `supabase/functions/issue-credit-note/index.ts`.

**Interfaces:**
- Consumes: `sale.doc_type`, `sale.customer_id`, y el `customer` (rut, razon_social, giro, direccion, comuna).

- [ ] **Step 1: Leer doc_type + cliente de la venta original**

En `issue-credit-note/index.ts`, cambiar la lectura de la venta (línea ~62-63) para traer más campos:

```ts
    const { data: sale, error: e2 } = await admin
      .from("sale").select("doc_type,dte_folio,emitted_at,customer_id").eq("id", nc.sale_id).single();
    if (e2 || !sale) return json({ status: "error", message: "documento no encontrado" }, 404);
    if (!sale.dte_folio) return json({ status: "error", message: "el documento no está emitido en el SII" }, 409);

    const esFactura = sale.doc_type === "factura";
    let receptor: Record<string, unknown> = {
      RUTRecep: "66666666-6", RznSocRecep: "Cliente sin especificar",
      DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago",
    };
    if (esFactura) {
      if (!sale.customer_id) return json({ status: "error", message: "la factura no tiene cliente para la NC" }, 400);
      const { data: cust, error: e3 } = await admin
        .from("customer").select("rut,razon_social,giro,direccion,comuna").eq("id", sale.customer_id).single();
      if (e3 || !cust || !cust.rut) return json({ status: "error", message: "cliente de la factura sin datos tributarios" }, 400);
      const rutDashed = (() => { const l = cust.rut.replace(/[.\-]/g, ""); return `${l.slice(0, -1)}-${l.slice(-1).toUpperCase()}`; })();
      receptor = {
        RUTRecep: rutDashed, RznSocRecep: cust.razon_social, GiroRecep: cust.giro,
        DirRecep: cust.direccion, CmnaRecep: cust.comuna, CiudadRecep: cust.comuna,
      };
    }
    const tpoDocRef = esFactura ? "33" : "39";
```

- [ ] **Step 2: Usar el receptor y TpoDocRef derivados en el body**

En el `body`, reemplazar el `Receptor` hardcodeado por `Receptor: receptor`, y en la `Referencia` cambiar `TpoDocRef: "39"` por `TpoDocRef: tpoDocRef`. El resto (Emisor formato factura, Detalle, Totales, endpoint `/invoiceCreditDebitNotesV2/{SUCURSAL}/{codRef}`) queda igual.

- [ ] **Step 3: Verificar (estático, sin emitir)**

Run: revisar que el body ahora deriva `TpoDocRef` (39/33) y el receptor por `doc_type`. No hay test automatizado del Edge Function (sin Deno CLI); la verificación es lectura del código + (opcional) `/dte/preview` en demo con una factura de prueba. NO emitir NC a producción.

Nota (documentada, no se cambia): el `{codRef}` en la URL como "motivo" tiene un conflicto doc-vs-cert; se mantiene y se marca para re-test en vivo.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/issue-credit-note/index.ts
git commit -m "fix(nc): derivar TpoDocRef (39/33) y receptor real segun doc_type de la venta"
```

---

### Task 9 (#8a): Edge Function `folios` + data layer

**Files:** Create `supabase/functions/folios/index.ts`, `src/data/folios.ts`.

**Interfaces:**
- Produces (Edge Function `folios`): `POST { action: "consultar", tipoDte }` → `{ sinUso: number, maxRequestable: number | null }`; `POST { action: "solicitar", tipoDte, cantidad }` → `{ ok: true, caf: <data> } | { ok:false, message }`.
- Produces (`src/data/folios.ts`): `consultarFolios(tipoDte)`, `solicitarFolios(tipoDte, cantidad)`.

- [ ] **Step 1: Crear la Edge Function**

Crear `supabase/functions/folios/index.ts`, reutilizando el patrón de token/secrets de `issue-receipt` (mismos `SIMPLEFACTURA_*`). Los endpoints de consulta usan `{rutEmpresa, tipoDTE, ambiente}`; `solicitar` usa `{credenciales:{rutEmisor, nombreSucursal}, cantidad, codigoTipoDte, ambiente}`. `maxRequestable`: null (sin límite) para tipos {39,41,34,52,110,111,112}; entero para {33,61,46,56,43}.

```ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
const RUT_EMISOR = Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1";
const SUCURSAL = Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz"; // con espacios (nombre real)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Tipos DTE sin límite de folios (la API devuelve 0 = sin límite).
const SIN_LIMITE = new Set([34, 39, 41, 52, 110, 111, 112]);

async function sfToken(): Promise<string> {
  const r = await fetch(`${SF_URL}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }) });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { action, tipoDte, cantidad } = await req.json();
    const t = Number(tipoDte);
    if (!t) return json({ status: "error", message: "tipoDte requerido" }, 400);
    const token = await sfToken();
    const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    if (action === "consultar") {
      // Folios sin uso (disponibles para emitir).
      const rSin = await fetch(`${SF_URL}/folios/consultar/sin-uso`, { method: "POST", headers: auth, body: JSON.stringify({ rutEmpresa: RUT_EMISOR, tipoDTE: t, ambiente: SF_AMBIENTE }) });
      const jSin = JSON.parse(await rSin.text());
      const sinUso = Array.isArray(jSin?.data) ? jSin.data.reduce((s: number, x: { cantidad?: number }) => s + (x.cantidad ?? 0), 0) : 0;
      // Cantidad máxima a solicitar.
      const rDisp = await fetch(`${SF_URL}/folios/consultar/disponibles`, { method: "POST", headers: auth, body: JSON.stringify({ rutEmpresa: RUT_EMISOR, tipoDTE: t, ambiente: SF_AMBIENTE }) });
      const jDisp = JSON.parse(await rDisp.text());
      const raw = Number(jDisp?.data ?? 0);
      const maxRequestable = SIN_LIMITE.has(t) ? null : raw; // null = sin límite
      return json({ status: "ok", sinUso, maxRequestable });
    }

    if (action === "solicitar") {
      const n = Number(cantidad);
      if (!n || n <= 0) return json({ status: "error", message: "cantidad debe ser mayor a 0" }, 400);
      const r = await fetch(`${SF_URL}/folios/solicitar`, { method: "POST", headers: auth, body: JSON.stringify({ credenciales: { rutEmisor: RUT_EMISOR, nombreSucursal: SUCURSAL }, cantidad: n, codigoTipoDte: t, ambiente: SF_AMBIENTE }) });
      const txt = await r.text();
      if (!r.ok) return json({ status: "error", message: `solicitud ${r.status}: ${txt}` }, 502);
      return json({ status: "ok", caf: JSON.parse(txt)?.data ?? null });
    }

    return json({ status: "error", message: "action inválida" }, 400);
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});
```

- [ ] **Step 2: Data layer**

Crear `src/data/folios.ts` que invoque la Edge Function vía `supabase.functions.invoke("folios", { body })`:

```ts
import { supabase } from "@/data/supabase"; // usar el cliente real del proyecto

export interface FoliosInfo { sinUso: number; maxRequestable: number | null }

export async function consultarFolios(tipoDte: number): Promise<FoliosInfo> {
  const { data, error } = await supabase.functions.invoke("folios", { body: { action: "consultar", tipoDte } });
  if (error) throw error;
  return { sinUso: data.sinUso ?? 0, maxRequestable: data.maxRequestable ?? null };
}

export async function solicitarFolios(tipoDte: number, cantidad: number): Promise<void> {
  const { data, error } = await supabase.functions.invoke("folios", { body: { action: "solicitar", tipoDte, cantidad } });
  if (error) throw error;
  if (data?.status === "error") throw new Error(data.message);
}
```
(Confirmar el import/nombre real del cliente supabase del proyecto — mirar cómo `sii.ts`/`sales.ts` lo importan.)

- [ ] **Step 3: Verificar contra demo**

Verificar (ambiente 0, demo) las 3 llamadas: `consultar` para 39 (esperar `maxRequestable=null` sin límite), 33 y 61 (esperar cap entero); y una `solicitar` de prueba en demo. Documentar los resultados. `pnpm build`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/folios/index.ts src/data/folios.ts
git commit -m "feat(folios): edge function para consultar y solicitar folios (SimpleFactura)"
```

---

### Task 10 (#8b): Pestaña "Folios" en Administración

**Files:** Modify `src/modules/admin/AdminScreen.tsx` (+ crear `src/modules/admin/FoliosPanel.tsx`).

**Interfaces:**
- Consumes: `consultarFolios`, `solicitarFolios` (Task 9).

- [ ] **Step 1: Agregar la pestaña**

En `AdminScreen.tsx`, agregar `"folios"` al tipo de `tab` y su `tabBtn("folios", "Folios")`, y renderizar `<FoliosPanel/>` cuando `tab === "folios"` (siguiendo el patrón de las pestañas existentes negocio/descuentos/puntos/seguridad).

- [ ] **Step 2: Crear `FoliosPanel.tsx`**

Componente que, por cada tipo (Boleta 39, Factura 33, Nota de crédito 61):
- Al montar, llama `consultarFolios(tipo)` y muestra: **Disponibles (sin usar)** = `sinUso`; **Máximo a solicitar** = `maxRequestable === null ? "Sin límite" : maxRequestable`.
- Un input numérico de cantidad (> 0; si `maxRequestable !== null`, capado a ese valor).
- Botón "Solicitar" → `solicitarFolios(tipo, cantidad)`; al éxito, `toast` y re-consultar los conteos; en error, `notifyError`.
- Usar los componentes UI existentes (`Button`, `Input`, `Card`) y `fmtCLP`/estilos coherentes; textos en español.

- [ ] **Step 3: Verificar**

Run: `pnpm build` + `pnpm test`.
Verificación (demo): la pestaña muestra disponibles y máximo por tipo; solicitar folios en demo actualiza los conteos.

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/AdminScreen.tsx src/modules/admin/FoliosPanel.tsx
git commit -m "feat(admin): pestana Folios para consultar y solicitar folios"
```

---

## Notas de verificación final
- `pnpm build`, `pnpm test`, `cd src-tauri && cargo test` verdes.
- Verificaciones manejando la app (con el respaldo local) donde son visuales: #2 (bloqueo caja día anterior), #4 (doble clic), #6 (filtro), #7 (vuelto fijo), #1 (factura desde el cobro), #8 (pestaña folios).
- #5: búsqueda por `dte_folio` encuentra el folio 5033 (lectura); body de NC deriva TpoDocRef/receptor. Sin emitir.
- #8: 3 llamadas validadas en demo (0=sin límite para 39; cap real 33/61).
- Migración del redondeo (`20260719120000`): validar sobre el respaldo con `pnpm test:db` antes de aplicar a prod (paso aparte con OK del usuario).
- Producción: no se emitió ningún DTE/NC real ni se aplicó la migración a prod en este lote.
