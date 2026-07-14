# Mejoras POS (venta, historial, descuentos) + rename de funciones — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renombrar todas las funciones de Supabase (Edge + RPC) al inglés y añadir cuatro funcionalidades POS: búsqueda de cliente en venta, popup de cliente al primer ítem, descuentos configurables, y módulo de historial.

**Architecture:** Frontend React+Vite+TS (`src/`) sobre Supabase/Postgres (RPC `security definer` + Edge Functions Deno). Se implementa en 4 fases secuenciales; la Fase 0 (rename) va primero para que el resto use ya los nombres en inglés. Cambios de BD en migraciones nuevas (nunca editar históricas). La app apunta a cloud/producción.

**Tech Stack:** React 19, Vite 6, TanStack Query, Tailwind v4, shadcn/ui, Supabase (Postgres, Edge Functions), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-mejoras-pos-venta-historial-descuentos-rename-design.md`

## Global Constraints

- Prosa/UI en **español**; identificadores, nombres de funciones, claves y flags en **inglés**.
- Commits **solo** como `Cromilakis <ipcromilakis@gmail.com>`; **prohibido** `Co-Authored-By` y cualquier atribución a Claude/Anthropic. Formato de commit: `git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "…"`.
- **Nunca** `git add -A`; agregar por ruta explícita.
- La app apunta a **cloud/producción**: todo `supabase db push`/`db query --linked`/`functions deploy`/`functions delete` requiere **confirmación explícita del usuario** antes de ejecutarse. Las tareas de despliegue quedan marcadas y NO se ejecutan sin OK.
- **No editar migraciones históricas** ya aplicadas; los cambios de esquema/función van en migraciones nuevas.
- Verificación por tarea: `pnpm build` verde (compila TS) y `pnpm test` verde. Reproducir antes de afirmar éxito.
- Externalizar textos no es obligatorio aquí: el proyecto hoy usa strings en español inline en JSX; seguir ese patrón existente (no introducir i18n).

## Nombres (mapeo, fuente de verdad para todo el plan)

| Español (actual) | Inglés (nuevo) |
|---|---|
| Edge `emitir-boleta` | `issue-receipt` |
| Edge `emitir-nota-credito` | `issue-credit-note` |
| RPC `siguiente_folio(uuid, public.folio_doc)` | `next_folio` |
| RPC `abrir_caja(uuid, int)` | `open_cash_session` |
| RPC `cerrar_caja(uuid, int)` | `close_cash_session` |
| RPC `_registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, int)` | `_register_sale` |
| RPC `cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb)` | `charge_sale` |
| RPC `emitir_nota_credito(uuid, uuid, uuid, public.sale_method, text, jsonb, smallint)` | `issue_credit_note` |
| RPC `crear_cotizacion(uuid, uuid, date, jsonb, int)` | `create_quote` |
| RPC `convertir_cotizacion(uuid, uuid, public.sale_method, int)` | `convert_quote` |
| RPC `eliminar_cotizacion(uuid)` | `delete_quote` |
| RPC `recepcionar_factura(uuid, jsonb, jsonb, jsonb, text)` | `receive_invoice` |
| RPC `norm_rut(text)` | `normalize_rut` |
| Wrapper TS `rpcAbrirCaja` (`src/data/work.ts`) | `rpcOpenCashSession` |
| Wrapper TS `rpcCerrarCaja` (`src/data/work.ts`) | `rpcCloseCashSession` |
| Wrapper TS `emitirBoleta` (`src/data/sii.ts`) | `issueReceipt` |
| Wrapper TS `emitirNotaCreditoDte` (`src/data/sii.ts`) | `issueCreditNoteDte` |
| Wrapper TS `cobrarVenta` (`src/data/sales.ts`) | `chargeSale` |
| Wrapper TS `crearCotizacion` (`src/data/sales.ts`) | `createQuote` |
| Wrapper TS `convertirCotizacion` (`src/data/sales.ts`) | `convertQuote` |
| Wrapper TS `eliminarCotizacion` (`src/data/sales.ts`) | `deleteQuote` |
| Wrapper TS `emitirNotaCredito` (`src/data/sales.ts`) | `issueCreditNote` |

Los nombres de **parámetros** de las RPC (`p_branch`, `p_quote`, etc.) **no cambian**. El helper `cartToLines` y los hooks (`useQuotes`, `useSalesTodayDte`, etc.) **no cambian**. Se mantienen en inglés: `current_business_id`, `current_role_pos`, `is_pos_admin`, `is_kromi`, `set_updated_at`, `handle_new_user`, y términos de dominio `rut`/`folio`/`dte`/`iva`.

---

# FASE 0 — Rename de funciones a inglés

### Task 0.1: Migración de rename (Postgres)

**Files:**
- Create: `supabase/migrations/20260714130000_rename_functions_english.sql`

**Interfaces:**
- Produces: las 11 funciones RPC con sus nombres en inglés (misma firma y comportamiento). `charge_sale`, `convert_quote`, `_register_sale`, `create_quote`, `issue_credit_note` con cuerpo actualizado que invoca los nuevos nombres internos.

**Contexto de cuerpos vigentes (para el paso 3, copiar verbatim cambiando solo los nombres invocados):**
- `_register_sale` ← cuerpo vigente de `_registrar_venta` en `supabase/migrations/20260708120000_descuentos.sql:12-126`. Llamada interna a cambiar: `public.siguiente_folio(` → `public.next_folio(` (línea 91 del cuerpo).
- `charge_sale` ← cuerpo vigente de `cobrar_venta` en `supabase/migrations/20260708140000_product_discount.sql:11-90`. Llamada interna: `public._registrar_venta(` → `public._register_sale(` (línea 88).
- `convert_quote` ← cuerpo vigente de `convertir_cotizacion` en `supabase/migrations/20260709100000_cotizacion_descuentos.sql:73-104`. Llamada interna: `public._registrar_venta(` → `public._register_sale(` (línea 100).
- `create_quote` ← cuerpo vigente de `crear_cotizacion` en `supabase/migrations/20260709100000_cotizacion_descuentos.sql:19-65`. Llamada interna: `public.siguiente_folio(` → `public.next_folio(` (línea 52).
- `issue_credit_note` ← cuerpo vigente de `emitir_nota_credito` en `supabase/migrations/20260714090000_credit_note_dte.sql` (la RPC, no la Edge Function). Llamada interna: `public.siguiente_folio(` → `public.next_folio(`.

- [ ] **Step 1: Escribir la migración — parte A: renombrar (preserva grants y cuerpo)**

```sql
-- ============================================================================
-- Migración: renombrar funciones al inglés. ALTER FUNCTION RENAME preserva
-- cuerpo y grants. Las 5 con llamadas internas se re-crean (CREATE OR REPLACE)
-- después para que el cuerpo invoque los nombres nuevos (plpgsql resuelve por
-- nombre en runtime). No se editan migraciones históricas.
-- ============================================================================

-- Parte A — rename de nombres (bottom-up: dependencias primero)
alter function public.siguiente_folio(uuid, public.folio_doc)                                       rename to next_folio;
alter function public._registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, int)       rename to _register_sale;
alter function public.cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb)          rename to charge_sale;
alter function public.emitir_nota_credito(uuid, uuid, uuid, public.sale_method, text, jsonb, smallint) rename to issue_credit_note;
alter function public.crear_cotizacion(uuid, uuid, date, jsonb, int)                                rename to create_quote;
alter function public.convertir_cotizacion(uuid, uuid, public.sale_method, int)                     rename to convert_quote;
alter function public.eliminar_cotizacion(uuid)                                                     rename to delete_quote;
alter function public.recepcionar_factura(uuid, jsonb, jsonb, jsonb, text)                          rename to receive_invoice;
alter function public.abrir_caja(uuid, int)                                                         rename to open_cash_session;
alter function public.cerrar_caja(uuid, int)                                                        rename to close_cash_session;
alter function public.norm_rut(text)                                                                rename to normalize_rut;
```

- [ ] **Step 2: Parte B — re-crear las 5 funciones con llamadas internas (cuerpo actualizado)**

Copiar el cuerpo vigente de cada una (ver "Contexto de cuerpos vigentes" arriba), con `create or replace function public.<NUEVO_NOMBRE>(<misma firma>)`, cambiando **solo** la llamada interna indicada. Orden: `_register_sale`, luego `charge_sale`, `convert_quote`, `create_quote`, `issue_credit_note`. Al final, re-aplicar el revoke del núcleo con el nombre nuevo:

```sql
revoke execute on function public._register_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, int)
  from public, anon, authenticated;
```

> Ejemplo del patrón para `_register_sale` (cabecera + la línea cambiada; el resto del cuerpo es idéntico a `20260708120000_descuentos.sql:12-126`):
> ```sql
> create or replace function public._register_sale(
>   p_branch uuid, p_session uuid, p_lines jsonb, p_method public.sale_method,
>   p_recv int, p_customer uuid, p_total_disc int default 0
> ) returns public.sale language plpgsql security definer set search_path = '' as $$
> -- … cuerpo idéntico …
>   v_folio := public.next_folio(p_branch, 'sale');   -- <— única línea cambiada
> -- … resto idéntico …
> $$;
> ```

- [ ] **Step 3: Verificar localmente que la migración aplica y las funciones existen con el nombre nuevo**

Run: `pnpm db:reset`
Expected: aplica todas las migraciones sin error (incluida la nueva).

Luego, contra la BD local:
Run: `supabase db query "select proname from pg_proc where proname in ('next_folio','_register_sale','charge_sale','issue_credit_note','create_quote','convert_quote','delete_quote','receive_invoice','open_cash_session','close_cash_session','normalize_rut') order by proname;"`
Expected: 11 filas. Y `select proname from pg_proc where proname in ('cobrar_venta','crear_cotizacion','abrir_caja');` → 0 filas.

- [ ] **Step 4: Correr los tests de BD**

Run: `pnpm test:db`
Expected: PASS. Si algún test de BD referencia los nombres viejos (`cobrar_venta`, `crear_cotizacion`, etc.), actualizarlos al nombre nuevo en el mismo commit (buscar con `grep -rl "cobrar_venta\|crear_cotizacion\|convertir_cotizacion\|eliminar_cotizacion\|emitir_nota_credito\|abrir_caja\|cerrar_caja\|siguiente_folio\|recepcionar_factura\|norm_rut" supabase/`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260714130000_rename_functions_english.sql
# + cualquier archivo de test:db actualizado
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "refactor(db): renombrar funciones RPC al ingles (migracion de rename)"
```

---

### Task 0.2: Renombrar Edge Functions y referencias del frontend

**Files:**
- Rename dir: `supabase/functions/emitir-boleta/` → `supabase/functions/issue-receipt/`
- Rename dir: `supabase/functions/emitir-nota-credito/` → `supabase/functions/issue-credit-note/`
- Modify: `src/data/sii.ts` (wrappers + `functions.invoke`)
- Modify: `src/data/work.ts` (wrappers + `.rpc`)
- Modify: `src/data/sales.ts` (wrappers + `.rpc`)
- Modify: `src/data/purchases.ts` (`.rpc`)
- Modify (usos de wrappers): `src/modules/venta/VentaScreen.tsx`, `src/modules/cotizaciones/CotizacionesScreen.tsx`, `src/modules/notas-credito/NuevaNotaCredito.tsx`, `src/modules/notas-credito/NotasCreditoScreen.tsx`, `src/modules/cierre/CierrePanel.tsx` (usa `rpcCerrarCaja`)

**Interfaces:**
- Consumes: nombres nuevos de RPC de Task 0.1.
- Produces: wrappers TS renombrados (ver tabla de nombres). Firmas idénticas salvo el nombre.

- [ ] **Step 1: Renombrar las carpetas de Edge Functions**

```bash
git mv supabase/functions/emitir-boleta supabase/functions/issue-receipt
git mv supabase/functions/emitir-nota-credito supabase/functions/issue-credit-note
```
(No hay `[functions.*]` en `supabase/config.toml`; el nombre de deploy se deriva de la carpeta.)

- [ ] **Step 2: Actualizar `src/data/sii.ts`**

Renombrar `emitirBoleta` → `issueReceipt` y `emitirNotaCreditoDte` → `issueCreditNoteDte`; cambiar `functions.invoke("emitir-boleta")` → `"issue-receipt"` y `functions.invoke("emitir-nota-credito")` → `"issue-credit-note"`. Actualizar los comentarios en español que citan el nombre de la Edge Function.

- [ ] **Step 3: Actualizar `src/data/work.ts`, `src/data/sales.ts`, `src/data/purchases.ts`**

- `work.ts`: `rpcAbrirCaja` → `rpcOpenCashSession` con `.rpc("open_cash_session", …)`; `rpcCerrarCaja` → `rpcCloseCashSession` con `.rpc("close_cash_session", …)`.
- `sales.ts`: `cobrarVenta` → `chargeSale` con `.rpc("charge_sale", …)`; `crearCotizacion` → `createQuote` con `.rpc("create_quote", …)`; `convertirCotizacion` → `convertQuote` con `.rpc("convert_quote", …)`; `eliminarCotizacion` → `deleteQuote` con `.rpc("delete_quote", …)`; `emitirNotaCredito` → `issueCreditNote` con `.rpc("issue_credit_note", …)`.
- `purchases.ts`: `.rpc("recepcionar_factura")` → `.rpc("receive_invoice")` (el wrapper se llama `recepcionarFactura`; renombrar a `receiveInvoice` y actualizar su uso en el módulo de compras).

- [ ] **Step 4: Actualizar los imports/usos en los módulos**

Buscar y reemplazar los nombres viejos de wrappers en los archivos de módulos listados arriba. Comando de verificación (debe dar 0 tras el cambio):
Run: `grep -rn "emitirBoleta\|emitirNotaCreditoDte\|cobrarVenta\|crearCotizacion\|convertirCotizacion\|eliminarCotizacion\|\bemitirNotaCredito\b\|rpcAbrirCaja\|rpcCerrarCaja\|recepcionarFactura" src/`
Expected: sin resultados.

- [ ] **Step 5: Verificar build y tests**

Run: `pnpm build`
Expected: `✓ built` sin errores TS.
Run: `pnpm test`
Expected: PASS (actualizar tests que referencien wrappers viejos).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions src/data/sii.ts src/data/work.ts src/data/sales.ts src/data/purchases.ts src/modules
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "refactor(app): usar nombres en ingles de Edge Functions y RPC"
```

---

### Task 0.3: Despliegue a cloud (REQUIERE CONFIRMACIÓN DEL USUARIO)

**No ejecutar sin OK explícito del usuario.** Pasos a proponer:
1. `supabase db query --linked --file supabase/migrations/20260714130000_rename_functions_english.sql` (aplica el rename de RPC en cloud).
2. `supabase functions deploy issue-receipt` y `supabase functions deploy issue-credit-note`.
3. `supabase functions delete emitir-boleta` (la vieja en cloud). `emitir-nota-credito` no está desplegada aún; si `functions list` la muestra, borrarla también.
4. Humo: una venta emite boleta (invoca `issue-receipt`); abrir/cerrar caja funciona.

- [ ] Confirmar con el usuario y ejecutar. Marcar completa solo tras el humo verde.

---

# FASE 1 — Búsqueda de cliente en la venta

### Task 1.1: Función pura `shouldPromptCustomer`

**Files:**
- Create: `src/modules/venta/customerPrompt.ts`
- Test: `src/modules/venta/customerPrompt.test.ts`

**Interfaces:**
- Produces: `export function shouldPromptCustomer(cartWasEmpty: boolean, customerId: string | null, alreadyAsked: boolean): boolean`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from "vitest";
import { shouldPromptCustomer } from "./customerPrompt";

describe("shouldPromptCustomer", () => {
  it("pide cliente al primer ítem si no hay cliente ni se preguntó", () => {
    expect(shouldPromptCustomer(true, null, false)).toBe(true);
  });
  it("no pide si el carrito ya tenía ítems", () => {
    expect(shouldPromptCustomer(false, null, false)).toBe(false);
  });
  it("no pide si ya hay cliente seleccionado", () => {
    expect(shouldPromptCustomer(true, "c1", false)).toBe(false);
  });
  it("no pide si ya se preguntó en esta venta", () => {
    expect(shouldPromptCustomer(true, null, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- customerPrompt`
Expected: FAIL ("shouldPromptCustomer is not a function" / módulo no existe).

- [ ] **Step 3: Implementar**

```ts
/** Decide si abrir el popup de cliente al agregar un ítem: solo al primero de la
 *  venta, si no hay cliente y no se preguntó antes en esta venta. */
export function shouldPromptCustomer(cartWasEmpty: boolean, customerId: string | null, alreadyAsked: boolean): boolean {
  return cartWasEmpty && customerId === null && !alreadyAsked;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test -- customerPrompt`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/modules/venta/customerPrompt.ts src/modules/venta/customerPrompt.test.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(venta): logica pura para el popup de cliente al primer item"
```

---

### Task 1.2: Componente `CustomerPickerDialog`

**Files:**
- Create: `src/modules/venta/CustomerPickerDialog.tsx`

**Interfaces:**
- Consumes: `useCustomers`, `filterCustomers`, `createCustomer`, `CustomerRow` de `src/data/customers.ts`; `notifyError`/`errMsg` de `src/lib/errors`; `useQueryClient`.
- Produces:
  ```ts
  interface CustomerPickerDialogProps {
    open: boolean;
    businessId: string | undefined;
    onSelect: (customer: CustomerRow) => void;
    onContinueWithout: () => void;
    onClose: () => void;
  }
  export function CustomerPickerDialog(props: CustomerPickerDialogProps): JSX.Element | null
  ```

- [ ] **Step 1: Implementar el componente**

Modal (patrón overlay del proyecto: `fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6`, contenido `onClick={(e) => e.stopPropagation()}`). Estado interno: `query`, `mode: "search" | "new"`, y campos del alta rápida (`name`, `phone`, `email`, `saving`). Retorna `null` si `!open`.

- Modo "search": input con `autoFocus` que filtra `filterCustomers(useCustomers(businessId).data ?? [], query)`; lista clicable (nombre + `phone`/`email`); botón "Continuar sin cliente" → `onContinueWithout()`; botón "Nuevo cliente" → `setMode("new")`. Encabezado con botón "×" → `onClose()`.
- Modo "new": inputs nombre (requerido), teléfono, email; "Guardar" valida nombre no vacío (si vacío, `toast.error("El nombre es obligatorio.")`), llama `await createCustomer({ business_id: businessId!, name, phone: phone || null, email: email || null })`, `qc.invalidateQueries({ queryKey: ["customers", businessId] })`, y `onSelect(nuevo)`; en error `notifyError("No se pudo crear el cliente.", errMsg(e))`. Botón "Volver" → `setMode("search")`.
- Reset de estado (`query`, `mode`, campos) vía `useEffect` cuando `open` pasa a true (patrón de `PayDialog:19-24`).

Usar clases Tailwind del proyecto (bordes `#E1E5EE`, marca `var(--brand)`, texto `#0F2A1B`/`#556A7C`), coherente con `PayDialog`/`CustomerForm`.

> Nota: revisar la firma real de `createCustomer` en `src/data/customers.ts` y respetarla (recibe el objeto con `business_id`, `name`, `email`, `phone`). Devolver/propagar el `CustomerRow` creado para `onSelect`.

- [ ] **Step 2: Verificar build**

Run: `pnpm build`
Expected: `✓ built` sin errores TS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/venta/CustomerPickerDialog.tsx
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(venta): CustomerPickerDialog (buscar por nombre/telefono/email + alta rapida)"
```

---

### Task 1.3: Integrar el picker en `VentaScreen`

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`

**Interfaces:**
- Consumes: `CustomerPickerDialog` (Task 1.2), `shouldPromptCustomer` (Task 1.1).

- [ ] **Step 1: Estado y helpers**

Añadir imports:
```tsx
import { CustomerPickerDialog } from "./CustomerPickerDialog";
import { shouldPromptCustomer } from "./customerPrompt";
```
Añadir estado (junto a `customerId`, línea ~88):
```tsx
const [pickerOpen, setPickerOpen] = useState(false);
const [askedForCustomer, setAskedForCustomer] = useState(false);
```
Derivar el cliente actual para mostrar su nombre:
```tsx
const selectedCustomer = customerId ? allCustomers.find((c) => c.id === customerId) ?? null : null;
```

- [ ] **Step 2: Reemplazar el `<select>` de cliente (VentaScreen.tsx:459-471) por el botón**

```tsx
<div className="flex items-center gap-1.5">
  <button
    onClick={() => setPickerOpen(true)}
    title="Cliente de la venta"
    className="rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-[13px] font-bold text-[#2A3A2E]"
  >
    {selectedCustomer ? selectedCustomer.name : "Sin cliente"}
  </button>
  {selectedCustomer && (
    <button onClick={() => setCustomerId(null)} title="Quitar cliente" className="flex size-[34px] items-center justify-center rounded-xl border border-[#E1E5EE] bg-white text-[#556A7C]">×</button>
  )}
</div>
```

- [ ] **Step 3: Enganchar el popup al primer ítem en `addToCart` (VentaScreen.tsx:150)**

Al inicio de `addToCart`, tras el guard de stock, antes de `setCart`:
```tsx
if (shouldPromptCustomer(cart.length === 0, customerId, askedForCustomer)) {
  setAskedForCustomer(true);
  setPickerOpen(true);
}
```
(El ítem se agrega igual; el popup no bloquea.)

- [ ] **Step 4: Resetear la bandera al limpiar/cobrar**

En `clearCart` (línea 197) añadir `setAskedForCustomer(false);`. En `handleConfirmPay`, donde hoy hace `setCustomerId(null)` (línea 351), añadir `setAskedForCustomer(false);`. En `handleHold` tras `setCustomerId(null)` (línea 242) añadir `setAskedForCustomer(false);`.

- [ ] **Step 5: Renderizar el diálogo**

Junto al `PayDialog` (línea 669):
```tsx
<CustomerPickerDialog
  open={pickerOpen}
  businessId={businessId}
  onSelect={(c) => { setCustomerId(c.id); setPickerOpen(false); }}
  onContinueWithout={() => setPickerOpen(false)}
  onClose={() => setPickerOpen(false)}
/>
```

- [ ] **Step 6: Verificar build**

Run: `pnpm build`
Expected: `✓ built`. Verificación manual: buscar por teléfono/email selecciona; primer ítem abre popup una sola vez; "sin cliente" no reabre; alta rápida crea y selecciona.

- [ ] **Step 7: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(venta): boton de cliente con buscador y popup al primer item"
```

---

# FASE 2 — Descuentos configurables

### Task 2.1: Migración de datos — tabla `discount` + `sale.discount_id`

**Files:**
- Create: `supabase/migrations/20260714140000_discount.sql`

**Interfaces:**
- Produces: tabla `public.discount(id, business_id, name, percent, active, valid_from, valid_until, created_at, updated_at, deleted_at)`; columna `public.sale.discount_id uuid null`; policies `discount_read`/`discount_write`.

- [ ] **Step 1: Escribir la migración (tabla + columna + RLS + trigger)**

```sql
-- ============================================================================
-- Migración: descuentos configurables al total de la boleta. Config admin.
-- Depende de: 20260707100000_catalog.sql (set_updated_at), 20260707100100_operations.sql (sale)
-- ============================================================================

create table public.discount (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  percent     int  not null check (percent between 1 and 100),
  active      boolean not null default true,
  valid_from  date,
  valid_until date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index idx_discount_business on public.discount(business_id);

create trigger trg_discount_updated
  before update on public.discount
  for each row execute function public.set_updated_at();

alter table public.sale add column discount_id uuid references public.discount(id) on delete set null;

alter table public.discount enable row level security;

-- Lectura: negocio propio o kromi (mismo patrón que las demás tablas del negocio).
create policy discount_read on public.discount for select
  using (business_id = public.current_business_id() or public.is_kromi());

-- Escritura: solo admin del negocio (configuración administrativa).
create policy discount_write on public.discount for all
  using (business_id = public.current_business_id() and public.is_pos_admin())
  with check (business_id = public.current_business_id() and public.is_pos_admin());
```

> Verificar en `supabase/migrations/20260707100400_rls.sql` si `current_business_id`/`is_pos_admin` son los nombres exactos (lo son) y si hay un patrón de `grant`/loop que también cubra la tabla nueva; seguir ese patrón si aplica (p. ej. si el loop de `*_read` requiere registrar la tabla, en cuyo caso NO duplicar la policy `discount_read`). Ajustar para no crear políticas duplicadas.

- [ ] **Step 2: Aplicar local y verificar**

Run: `pnpm db:reset`
Expected: aplica sin error.
Run: `supabase db query "select column_name from information_schema.columns where table_name='discount' order by column_name; select column_name from information_schema.columns where table_name='sale' and column_name='discount_id';"`
Expected: columnas de `discount` + `discount_id` en `sale`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260714140000_discount.sql
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(db): tabla discount + sale.discount_id + RLS admin"
```

---

### Task 2.2: `charge_sale` acepta `p_discount_id`

**Files:**
- Create: `supabase/migrations/20260714150000_charge_sale_discount_id.sql`

**Interfaces:**
- Consumes: `charge_sale` (renombrada en Fase 0), tabla `discount` (Task 2.1).
- Produces: `charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb, uuid)` — nueva firma con `p_discount_id uuid default null` al final; guarda `sale.discount_id`.

- [ ] **Step 1: Escribir la migración**

Reescribe `charge_sale` (copiando el cuerpo vigente tras Fase 0, es decir el de `20260708140000_product_discount.sql` con `_registrar_venta`→`_register_sale` y `siguiente_folio`→`next_folio`) añadiendo el parámetro y la lógica de descuento predefinido. Como cambia la firma (8º parámetro), usar `drop function` de la firma de 7 args y `create function` nuevo + `grant`.

Lógica añadida (dentro de `charge_sale`, tras calcular `v_bruto` y antes del cálculo de `v_tot_disc` ad-hoc):
```sql
-- Descuento predefinido (config admin): tiene prioridad sobre el ad-hoc.
-- No requiere rol admin (es un descuento aprobado por el admin en config).
if p_discount_id is not null then
  declare v_pct int; begin
    select percent into v_pct
      from public.discount
     where id = p_discount_id
       and business_id = v_business
       and active = true
       and (valid_from  is null or valid_from  <= current_date)
       and (valid_until is null or valid_until >= current_date)
       and deleted_at is null;
    if v_pct is null then
      raise exception 'el descuento no existe, no está activo o no está vigente';
    end if;
    v_tot_disc := least(v_bruto, round(v_bruto * v_pct / 100.0));
  end;
  -- p_total_disc se ignora si vino junto con p_discount_id (mutuamente excluyentes).
else
  -- (bloque ad-hoc existente: calcula v_tot_disc desde p_total_disc y exige is_pos_admin)
  if v_tvalue > 0 and v_tkind is not null then
    v_tot_disc := case
      when v_tkind = 'pct'    then least(v_bruto, round(v_bruto * v_tvalue / 100.0))
      when v_tkind = 'amount' then least(v_bruto, v_tvalue)
      else 0 end;
  end if;
  if (v_has_disc or v_tot_disc > 0) and not public.is_pos_admin() then
    raise exception 'los descuentos requieren rol administrador';
  end if;
end if;
```
> Importante: cuando `p_discount_id` es válido, NO exigir `is_pos_admin()`. Cuando es null, mantener EXACTA la validación ad-hoc actual (incluido el chequeo de `v_has_disc` por descuento de línea). El `v_has_disc` (descuento de línea) sigue exigiendo admin en ambas ramas si hay descuento de línea — revisar que el chequeo cubra ese caso también cuando hay `p_discount_id` (si hay descuento de línea ad-hoc + descuento predefinido, el de línea sigue requiriendo admin).

Persistir `discount_id`: `_register_sale` no conoce `p_discount_id`. Guardarlo con un `update` tras la venta dentro de `charge_sale`:
```sql
v_sale := public._register_sale(p_branch, p_session, v_lines, p_method, p_recv, p_customer, v_tot_disc);
if p_discount_id is not null then
  update public.sale set discount_id = p_discount_id where id = v_sale.id;
end if;
return v_sale;
```
(Requiere cambiar el `return public._register_sale(...)` final por asignación a `v_sale` + `return v_sale;`, declarando `v_sale public.sale;`.)

Grant:
```sql
grant execute on function public.charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar local y verificar por script**

Run: `pnpm db:reset`
Expected: aplica sin error.

Verificación funcional (adaptar al harness `pnpm test:db` si existe un test de RPC; si no, script SQL de humo con una sesión de caja abierta):
- `charge_sale` con `p_discount_id` de un descuento activo 10% → `sale.discount_amount` = 10% del bruto y `sale.discount_id` seteado, sin requerir admin.
- `p_discount_id` de un descuento inactivo/vencido/otro negocio → excepción.

Run: `pnpm test:db`
Expected: PASS (añadir/actualizar el test de `charge_sale` si el harness lo soporta; si no, dejar constancia del script de humo ejecutado).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260714150000_charge_sale_discount_id.sql
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(db): charge_sale acepta p_discount_id (descuento predefinido, sin exigir admin)"
```

---

### Task 2.3: Capa de datos `discounts.ts`

**Files:**
- Create: `src/data/discounts.ts`
- Test: `src/data/discounts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DiscountRow { id: string; name: string; percent: number; active: boolean; valid_from: string | null; valid_until: string | null; }
  export function isDiscountVigente(d: Pick<DiscountRow,"active"|"valid_from"|"valid_until">, today?: Date): boolean
  export function useDiscounts(businessId?: string)         // key ["discounts", businessId] — todos (no eliminados)
  export function useActiveDiscounts(businessId?: string)    // key ["active-discounts", businessId] — active + vigentes hoy
  export async function createDiscount(input: { business_id: string; name: string; percent: number; active: boolean; valid_from: string | null; valid_until: string | null; }): Promise<DiscountRow>
  export async function updateDiscount(id: string, input: Partial<{ name: string; percent: number; active: boolean; valid_from: string | null; valid_until: string | null; }>): Promise<void>
  export async function softDeleteDiscount(id: string): Promise<void>
  ```

- [ ] **Step 1: Test que falla (`isDiscountVigente`)**

```ts
import { describe, it, expect } from "vitest";
import { isDiscountVigente } from "./discounts";

const D = (over: Partial<{active:boolean;valid_from:string|null;valid_until:string|null}> = {}) =>
  ({ active: true, valid_from: null, valid_until: null, ...over });
const today = new Date("2026-07-14T12:00:00");

describe("isDiscountVigente", () => {
  it("inactivo nunca es vigente", () => expect(isDiscountVigente(D({ active: false }), today)).toBe(false));
  it("activo sin fechas es vigente", () => expect(isDiscountVigente(D(), today)).toBe(true));
  it("dentro del rango es vigente", () => expect(isDiscountVigente(D({ valid_from: "2026-07-01", valid_until: "2026-07-31" }), today)).toBe(true));
  it("antes de valid_from no es vigente", () => expect(isDiscountVigente(D({ valid_from: "2026-08-01" }), today)).toBe(false));
  it("después de valid_until no es vigente", () => expect(isDiscountVigente(D({ valid_until: "2026-07-10" }), today)).toBe(false));
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- discounts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `discounts.ts`**

`isDiscountVigente`: `if (!d.active) return false;` comparar `today` (a `YYYY-MM-DD` local) contra `valid_from`/`valid_until` (nulls = sin límite). Los hooks siguen el patrón de `src/data/customers.ts` (`useQuery`, `supabase.from("discount").select("id,name,percent,active,valid_from,valid_until").eq("business_id", …).is("deleted_at", null).order("name")`). `useActiveDiscounts` filtra en cliente con `isDiscountVigente`. `createDiscount`/`updateDiscount`/`softDeleteDiscount` como en `customers.ts` (insert/update/soft-delete con `deleted_at`).

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test -- discounts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/data/discounts.ts src/data/discounts.test.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(data): capa de datos de descuentos + isDiscountVigente"
```

---

### Task 2.4: Pestañas en `/admin` + CRUD `DiscountsSettings`

**Files:**
- Create: `src/modules/admin/AdminScreen.tsx`
- Create: `src/modules/admin/DiscountsSettings.tsx`
- Modify: `src/App.tsx:11,15-22,51` (importar y usar `AdminScreen` en `AdminRoute`)

**Interfaces:**
- Consumes: `BusinessSettings` (existente, sin cambios), `discounts.ts` (Task 2.3), `isDiscountVigente`.
- Produces: `export function AdminScreen(): JSX.Element`.

- [ ] **Step 1: `AdminScreen` con pestañas**

Contenedor con estado `const [tab, setTab] = useState<"negocio" | "descuentos">("negocio")` y el patrón de tabs de `CotizacionesScreen.tsx:249-258` (botón con subrayado `var(--brand)`). Renderiza `<BusinessSettings/>` en "negocio" y `<DiscountsSettings/>` en "descuentos".

- [ ] **Step 2: `DiscountsSettings` — listado + formulario**

Consume `useDiscounts(businessId)` (businessId de `useAuth().profile?.business_id`). Lista de descuentos: nombre, `percent`%, badge de estado (Activo/Inactivo con `isDiscountVigente` → "Vigente"/"Fuera de vigencia"), rango de fechas. Botón "Nuevo descuento" y "Editar" abren un formulario (modal o inline) con: nombre (requerido), porcentaje (1–100), activo (checkbox), vigencia desde/hasta (date inputs opcionales). "Guardar" llama `createDiscount`/`updateDiscount` e invalida `["discounts", businessId]` y `["active-discounts", businessId]`. Eliminar: `softDeleteDiscount` con confirmación (patrón `confirmDeleteId` + modal de `StockScreen`/`CotizacionesScreen`). Errores con `notifyError`. Validaciones: nombre no vacío, `percent` entre 1 y 100.

- [ ] **Step 3: Cablear la ruta**

En `src/App.tsx`: `import { AdminScreen } from "@/modules/admin/AdminScreen";` y en `AdminRoute` cambiar `<BusinessSettings />` por `<AdminScreen />` (mantener `RequireRole allow={["admin","kromi"]}`). Quitar el import de `BusinessSettings` de `App.tsx` si ya no se usa allí (ahora lo importa `AdminScreen`).

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: `✓ built`. Manual: la pestaña Descuentos permite crear "Alianza Plan Café 10%", editar, activar/desactivar y eliminar.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/AdminScreen.tsx src/modules/admin/DiscountsSettings.tsx src/App.tsx
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(admin): pestanas Negocio/Descuentos y CRUD de descuentos"
```

---

### Task 2.5: Selector de descuento en el cobro

**Files:**
- Modify: `src/modules/venta/PayDialog.tsx`
- Modify: `src/modules/venta/VentaScreen.tsx`
- Modify: `src/data/sales.ts` (`chargeSale` acepta `p_discount_id`)

**Interfaces:**
- Consumes: `useActiveDiscounts`, `DiscountRow`, `isDiscountVigente`; `resolveDiscount` de `src/lib/money.ts`.
- Produces: `PayDialog` con prop `discounts: DiscountRow[]` y `onConfirm(method, recv, discountId: string | null)`.

- [ ] **Step 1: `chargeSale` acepta `p_discount_id`**

En `src/data/sales.ts`, añadir `p_discount_id?: string | null` al objeto de args de `chargeSale` y pasarlo a `.rpc("charge_sale", { …, p_discount_id: args.p_discount_id ?? null })`.

- [ ] **Step 2: `PayDialog` — selector y recálculo**

Añadir a `PayDialogProps`: `discounts: DiscountRow[];` y cambiar `onConfirm` a `(method: PayMethod, recv: number, discountId: string | null) => void`. Estado interno `const [discountId, setDiscountId] = useState<string | null>(null)` (reset en el `useEffect` de `open`). Calcular:
```tsx
const selected = discounts.find((d) => d.id === discountId) ?? null;
const discAmount = selected ? resolveDiscount(total, "pct", selected.percent) : 0;
const effectiveTotal = total - discAmount;
```
Mostrar un `<select>` con "Sin descuento" + `discounts.map(d => <option value={d.id}>{d.name} (−{d.percent}%)</option>)`. Mostrar `effectiveTotal` como total a cobrar y, si hay descuento, la línea del monto descontado. `recv` para tarjeta pasa a ser `effectiveTotal`; para efectivo, `canConfirm = recv >= effectiveTotal`. `onConfirm(method, recv, discountId)`.

- [ ] **Step 3: `VentaScreen` — pasar descuentos y discountId**

`import { useActiveDiscounts } from "@/data/discounts";` y `const { data: activeDiscounts } = useActiveDiscounts(businessId);`. Pasar `discounts={activeDiscounts ?? []}` al `PayDialog`. Cambiar la firma de `handleConfirmPay(method, recv, discountId)` y pasar `p_discount_id: discountId` en la llamada a `chargeSale`. Invalidar además `["active-discounts", businessId]` no es necesario tras cobrar.

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: `✓ built`. Manual: elegir "Plan Café 10%" reduce el total mostrado y la venta guarda el descuento; "Sin descuento" cobra el total pleno.

- [ ] **Step 5: Commit**

```bash
git add src/modules/venta/PayDialog.tsx src/modules/venta/VentaScreen.tsx src/data/sales.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(venta): selector de descuento predefinido en el cobro"
```

---

### Task 2.6: Aplicar descuentos a cloud (REQUIERE CONFIRMACIÓN DEL USUARIO)

**No ejecutar sin OK.** Proponer: aplicar `20260714140000_discount.sql` y `20260714150000_charge_sale_discount_id.sql` a cloud (`supabase db query --linked --file …` cada una, o `db push`). Humo: crear un descuento en config, cobrar una venta aplicándolo, verificar `sale.discount_id` y el total.

- [ ] Confirmar y ejecutar.

---

# FASE 3 — Módulo Historial

### Task 3.1: Hook `useSalesHistory` + filtros puros

**Files:**
- Create: `src/data/salesHistory.ts`
- Test: `src/data/salesHistory.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SalesHistoryFilters { from?: string; to?: string; customerId?: string | null; folio?: number | null; page?: number; }
  export interface SaleHistoryRow {
    id: string; folio: number; total: number; neto: number; iva: number; discount_amount: number;
    method: string; sold_at: string; customer_id: string | null; customer_name: string | null;
    dte_status: string | null; dte_folio: number | null; dte_timbre: string | null;
    lines: { name_snapshot: string; price_snapshot: number; qty: number; discount_amount: number }[];
  }
  export const HISTORY_PAGE = 50;
  export function dayRangeUtc(fromIso: string, toIso: string): { start: string; end: string } // [00:00 from, 24:00 to) en ISO
  export function useSalesHistory(branchId: string | undefined, filters: SalesHistoryFilters)  // key ["sales-history", branchId, filters]
  ```

- [ ] **Step 1: Test que falla (`dayRangeUtc`)**

```ts
import { describe, it, expect } from "vitest";
import { dayRangeUtc } from "./salesHistory";

describe("dayRangeUtc", () => {
  it("start es 00:00 del from y end es 00:00 del día siguiente al to", () => {
    const { start, end } = dayRangeUtc("2026-07-01", "2026-07-14");
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(end).getDate()).toBe(15); // exclusivo: día siguiente al 'to'
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- salesHistory`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`dayRangeUtc`: `start = new Date(fromIso + "T00:00:00")`; `end = new Date(toIso + "T00:00:00"); end.setDate(end.getDate() + 1)`; devolver `.toISOString()`. `useSalesHistory`: `useQuery` con `queryKey ["sales-history", branchId, filters]`, `enabled: !!branchId`. Query: `supabase.from("sale").select("id,folio,total,neto,iva,discount_amount,method,sold_at,customer_id,dte_status,dte_folio,dte_timbre,customer:customer_id(name),sale_line(name_snapshot,price_snapshot,qty,discount_amount)").eq("branch_id", branchId)`. Aplicar `.gte("sold_at", start).lt("sold_at", end)` con `dayRangeUtc(from ?? hoy, to ?? hoy)`; si `customerId` → `.eq("customer_id", customerId)`; si `folio` → `.eq("folio", folio)`. `.order("sold_at", { ascending: false })`. Paginación: `const page = filters.page ?? 0; .range(page*HISTORY_PAGE, page*HISTORY_PAGE + HISTORY_PAGE - 1)`. Mapear a `SaleHistoryRow` (aplanando `customer.name` → `customer_name`, `sale_line` → `lines`).

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test -- salesHistory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/salesHistory.ts src/data/salesHistory.test.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(data): useSalesHistory con filtros y paginacion"
```

---

### Task 3.2: `HistorialScreen` — filtros, listado, paginación + ruta y nav

**Files:**
- Create: `src/modules/historial/HistorialScreen.tsx`
- Modify: `src/App.tsx` (import + ruta `/historial` con `RequireRole`)
- Modify: `src/session/nav.ts` (ítem "Historial" para admin/kromi)

**Interfaces:**
- Consumes: `useSalesHistory`, `SaleHistoryRow`, `HISTORY_PAGE` (Task 3.1); `CustomerPickerDialog` (Fase 1) para el filtro de cliente; `fmtCLP` de `src/lib/money`.
- Produces: `export function HistorialScreen(): JSX.Element`.

- [ ] **Step 1: Ruta protegida en `App.tsx`**

Añadir componente `HistorialRoute()` (patrón de `NotasCreditoRoute`, `allow={["admin","kromi"]}`) y `<Route path="historial" element={<HistorialRoute />} />`.

- [ ] **Step 2: Ítem de nav**

En `src/session/nav.ts`: `const HISTORIAL: NavItem = { to: "/historial", label: "Historial" };` y en `navForRole`, para admin/kromi, insertarlo (p. ej. tras `NC`, dentro del bucle o junto a `ADMIN`). Mantener el orden: Historial visible solo para admin/kromi.

- [ ] **Step 3: `HistorialScreen` — estado y filtros**

Estado: `from`/`to` (default hoy, `isoToday()`), `customerId`, `folioStr`, `page` (0), y `rows` acumuladas. `const { data, isFetching } = useSalesHistory(branchId, { from, to, customerId, folio: folioStr ? Number(folioStr) : null, page })`. Acumular: al cambiar filtros, reset `page=0` y `rows=[]`; al recibir `data`, si `page===0` → `rows=data`, si no → `rows=[...rows, ...data]`. Barra de filtros: dos date inputs, botón "Cliente" (abre `CustomerPickerDialog`, guarda `customerId`; "×" limpia), input de folio, botón "Buscar". Encabezado como `CotizacionesScreen` ("Ventas" / "Historial").

- [ ] **Step 4: Listado + "Cargar más"**

Filas: `COT`→`Venta #{folio}`, fecha/hora (`toLocaleString es-CL`), cliente (`customer_name ?? "Sin cliente"`), método, `fmtCLP(total)`, badge DTE (emitida `SII {dte_folio}` / pendiente / rechazada, patrón de "Boletas del día" `VentaScreen:725-737`). Estado vacío. Botón "Cargar más" visible mientras la última página traiga `HISTORY_PAGE` filas; incrementa `page`.

- [ ] **Step 5: Verificar build**

Run: `pnpm build`
Expected: `✓ built`. Manual: filtra por fecha/cliente/folio; "cargar más" pagina.

- [ ] **Step 6: Commit**

```bash
git add src/modules/historial/HistorialScreen.tsx src/App.tsx src/session/nav.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(historial): modulo /historial con filtros y paginacion"
```

---

### Task 3.3: Acciones — ver detalle, reimprimir, emitir NC

**Files:**
- Modify: `src/modules/historial/HistorialScreen.tsx`
- Modify: `src/modules/notas-credito/NuevaNotaCredito.tsx` (aceptar folio precargado por navegación)

**Interfaces:**
- Consumes: `printReceipt` de `src/lib/print`; `businessToNegocio`/`useBusiness`; `getPrinterName`; `useNavigate` de react-router.

- [ ] **Step 1: Ver detalle (modal)**

Estado `const [detail, setDetail] = useState<SaleHistoryRow | null>(null)`. Botón "Detalle" por fila. Modal (overlay del proyecto) con líneas (`lines`), neto/iva/total/descuento (`fmtCLP`), cliente, método, folio SII.

- [ ] **Step 2: Reimprimir boleta**

Botón "Reimprimir" habilitado solo si `row.dte_folio`. Handler construye el payload igual que `VentaScreen.reimprimirBoleta` (VentaScreen.tsx:302-326): `printReceipt({ negocio: businessToNegocio(business, getPrinterName()), folio, fecha, hora, items: lines.map(...), neto, iva, total, descuento: Σ discount_amount, dte_folio, timbre_png: dte_timbre, reimpresion: true, metodo: method, open_drawer: false })`. Errores con `notifyError`.

- [ ] **Step 3: Emitir NC precargando folio**

Botón "Nota de crédito" habilitado si `row.dte_folio`. `const nav = useNavigate();` → `nav("/notas-credito/nueva", { state: { folio: row.dte_folio } })`. En `NuevaNotaCredito.tsx`, leer `const { state } = useLocation();` y, si `state?.folio`, precargar el buscador por folio (disparar la búsqueda existente por folio SII con ese valor al montar). Reusar la lógica de búsqueda por folio ya presente en ese módulo (no duplicarla).

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: `✓ built`. Manual: detalle muestra líneas; reimprimir imprime una boleta emitida; "NC" abre el módulo con el folio cargado.

- [ ] **Step 5: Commit**

```bash
git add src/modules/historial/HistorialScreen.tsx src/modules/notas-credito/NuevaNotaCredito.tsx
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(historial): ver detalle, reimprimir boleta y emitir NC desde el historial"
```

---

## Notas de ejecución

- **Orden de migraciones cloud** (cuando el usuario confirme): primero las pendientes de trabajo previo (`20260714090000_credit_note_dte` si no está), luego `20260714130000_rename`, `20260714140000_discount`, `20260714150000_charge_sale_discount_id`. La de rename debe ir antes que las de descuentos (que asumen `charge_sale`).
- **Tests de BD**: si `pnpm test:db` tiene un harness de RPC, añadir/actualizar tests ahí (Fase 0 y Task 2.2). Si el harness no cubre RPC nuevas fácilmente, documentar el script de humo ejecutado en el reporte de la tarea.
- Las tareas de despliegue (0.3, 2.6, y el push de las migraciones de historial no aplica —Fase 3 no cambia BD—) **nunca** corren sin confirmación explícita del usuario.
