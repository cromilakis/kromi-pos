# Mejoras POS: venta, historial, descuentos y renombrado de funciones — Diseño

**Fecha:** 2026-07-14
**Estado:** aprobado (diseño), pendiente de plan de implementación

## Objetivo

Cuatro funcionalidades nuevas en kromi-pos más un refactor transversal de nombres:

0. **(Fase 0) Renombrar al inglés** las Edge Functions y las RPC de Postgres que hoy están en español.
1. **Búsqueda de cliente en la venta**: reemplazar el `<select>` por un popup que busca por nombre/teléfono/email, con alta rápida.
2. **Popup de cliente al primer artículo**: al agregar el primer ítem de una venta nueva, si no hay cliente, abrir ese mismo popup.
3. **Módulo Historial**: listado de ventas con filtros por fecha, cliente y folio (solo admin/supervisor).
4. **Descuentos configurables**: gestionar descuentos al total de la boleta en Configuración y aplicarlos en el cobro.

> Las features 1 y 2 comparten un único componente (`CustomerPickerDialog`), por eso se agrupan en la Fase 1.

## Orden de implementación

**Fase 0 (rename) → Fase 1 (cliente) → Fase 2 (descuentos) → Fase 3 (historial).**

El rename va primero para dejar la base limpia: las features nuevas usan directamente los nombres en inglés (p. ej. la Fase 2 modifica `charge_sale`, no `cobrar_venta`).

## Contexto del código actual (hallazgos)

- **Clientes**: tabla `customer` con `name`, `email`, `phone` (no hay `rut`). Ya existe `filterCustomers(rows, q)` (case-insensitive por los tres campos) y `useCustomers(businessId)` en `src/data/customers.ts`. `createCustomer(input)` inserta directo (RLS `customer_write` lo permite; no pasa por RPC).
- **Selector de cliente hoy**: `<select>` nativo en `src/modules/venta/VentaScreen.tsx`, estado `customerId` (`useState<string | null>(null)`). El carrito es `cart: CartItem[]` (`{ id, qty }`), se agrega con `addToCart(p)` (desde click en tarjeta o al escanear). No hay ningún gate antes del primer `addToCart`.
- **Ventas**: tabla `sale` (`folio`, `method`, `total`, `neto`, `iva`, `customer_id`, `sold_at`, `discount_amount`) + `sale_line`. Columnas DTE: `dte_status`, `dte_folio`, `dte_timbre`. Hooks existentes: `useSalesToday`, `useRecentSales(limit)`, `useSalesTodayDte` (fuente de "Boletas del día", solo hoy, `.limit(200)`), y `buscarVentaPorFolio(branchId, folio)`. **No hay** hook con filtros por fecha/cliente/folio ni paginación. RLS de `sale` permite SELECT filtrado del negocio propio.
- **Configuración**: `/admin` es hoy **una sola pantalla monolítica** `src/modules/admin/BusinessSettings.tsx` (datos del negocio + logo + `<PrinterSettings/>`), sin tabs. Protegida con `RequireRole allow=["admin","kromi"]` vía `AdminRoute()` en `src/App.tsx`. El nav (`src/session/nav.ts`) muestra "Administración" solo a admin/kromi.
- **Descuentos**: `src/lib/money.ts` tiene `resolveDiscount(base, kind, value)` y `computeTotals(lines, totalDiscount)`. La RPC `cobrar_venta` **ya acepta** `p_total_disc jsonb` (`{kind, value}`) y guarda el monto en `sale.discount_amount`, pero **la UI de venta nunca lo envía** (`handleConfirmPay` no pasa `p_total_disc`). Los descuentos ad-hoc exigen `is_pos_admin()`. **No existe** ninguna tabla de descuentos/promociones. La emisión SII ya refleja el descuento total como `DescuentoMonto` en la Edge Function de boleta.

---

# Fase 0 — Renombrado a inglés

## Alcance

**Edge Functions** (`supabase/functions/`):

| Actual | Nuevo |
|---|---|
| `emitir-boleta` | `issue-receipt` |
| `emitir-nota-credito` | `issue-credit-note` |
| `extract-invoice` | (ya en inglés, sin cambio) |

**RPC / funciones Postgres** (firmas vigentes hoy, que identifican cada función):

| Actual | Nuevo |
|---|---|
| `siguiente_folio(uuid, public.folio_doc)` | `next_folio` |
| `abrir_caja(uuid, int)` | `open_cash_session` |
| `cerrar_caja(uuid, int)` | `close_cash_session` |
| `_registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, int)` | `_register_sale` |
| `cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb)` | `charge_sale` |
| `emitir_nota_credito(uuid, uuid, uuid, public.sale_method, text, jsonb, smallint)` | `issue_credit_note` |
| `crear_cotizacion(uuid, uuid, date, jsonb, int)` | `create_quote` |
| `convertir_cotizacion(uuid, uuid, public.sale_method, int)` | `convert_quote` |
| `eliminar_cotizacion(uuid)` | `delete_quote` |
| `recepcionar_factura(uuid, jsonb, jsonb, jsonb, text)` | `receive_invoice` |
| `norm_rut(text)` | `normalize_rut` |

**Se mantienen** (ya en inglés): `current_business_id`, `current_role_pos`, `is_pos_admin`, `is_kromi`, `set_updated_at`, `handle_new_user`. **Se mantienen** los términos de dominio que son nombres propios: `rut`, `folio`, `dte`, `iva`.

## Enfoque

### Base de datos — una migración nueva
`supabase/migrations/20260714130000_rename_functions_english.sql`. **No se editan migraciones históricas** (ya aplicadas en cloud; el historial es inmutable).

Grafo de llamadas internas (SQL→SQL):
```
charge_sale       ──▶ _register_sale ──▶ next_folio
convert_quote     ──▶ _register_sale
issue_credit_note ──▶ next_folio
create_quote      ──▶ next_folio
```

Estrategia:
1. `ALTER FUNCTION public.<viejo>(<args>) RENAME TO <nuevo>;` para las 11 funciones. `ALTER … RENAME` **preserva el cuerpo y los grants**, así que no hay que re-otorgar permisos.
2. `CREATE OR REPLACE FUNCTION` de las funciones cuyo **cuerpo llama** a otra renombrada, para actualizar la referencia interna: `_register_sale` (llama `next_folio`), `charge_sale` (llama `_register_sale`), `convert_quote` (llama `_register_sale`), `issue_credit_note` (llama `next_folio`), `create_quote` (llama `next_folio`). El cuerpo se copia **verbatim de la versión vigente** de cada función, cambiando solo el nombre invocado. `_register_sale` sigue revocado de `public, anon, authenticated` (repetir el `revoke` con el nombre nuevo y la firma de 7 args).

> Nota: en plpgsql las llamadas a funciones se resuelven por nombre en runtime; por eso el paso 2 es obligatorio tras el rename, o las funciones fallarían al invocar el nombre viejo.

### Edge Functions
Renombrar las carpetas `emitir-boleta` → `issue-receipt` y `emitir-nota-credito` → `issue-credit-note`. No hay `[functions.*]` en `supabase/config.toml`: el nombre de deploy se deriva de la carpeta, así que no hay config adicional. El contenido de cada `index.ts` no cambia (salvo comentarios).

### Frontend
Actualizar las referencias (únicas en todo `src/`):
- `src/data/sii.ts`: `functions.invoke("emitir-boleta")` → `"issue-receipt"`; `functions.invoke("emitir-nota-credito")` → `"issue-credit-note"`. Renombrar los wrappers TS: `emitirBoleta` → `issueReceipt`, `emitirNotaCreditoDte` → `issueCreditNoteDte` (y sus usos en `VentaScreen.tsx`, `CotizacionesScreen.tsx`, `NuevaNotaCredito.tsx`, `NotasCreditoScreen.tsx`).
- `src/data/sales.ts`: `.rpc("cobrar_venta")` → `"charge_sale"`; `.rpc("crear_cotizacion")` → `"create_quote"`; `.rpc("convertir_cotizacion")` → `"convert_quote"`; `.rpc("eliminar_cotizacion")` → `"delete_quote"`; `.rpc("emitir_nota_credito")` → `"issue_credit_note"`. Renombrar los wrappers TS correspondientes (`cobrarVenta`, `crearCotizacion`, `convertirCotizacion`, `eliminarCotizacion`, `emitirNotaCredito`) → nombres en inglés coherentes, actualizando sus importaciones.
- `src/data/work.ts`: `.rpc("abrir_caja")` → `"open_cash_session"`; `.rpc("cerrar_caja")` → `"close_cash_session"`.
- `src/data/purchases.ts`: `.rpc("recepcionar_factura")` → `"receive_invoice"`; `functions.invoke("extract-invoice")` no cambia.
- Los nombres de parámetros de las RPC (`p_branch`, `p_quote`, etc.) **no cambian** (siguen en el patrón `p_*`); solo cambia el nombre de la función.

### Cloud (con confirmación del usuario)
1. Desplegar las 2 Edge Functions con el nombre nuevo (`supabase functions deploy issue-receipt`, `… issue-credit-note`).
2. Eliminar las 2 viejas (`supabase functions delete emitir-boleta`, `… emitir-nota-credito`).
3. Aplicar la migración de rename a cloud (`supabase db query --linked --file …` o `db push`).

> `issue-credit-note` aún no está desplegada en cloud (el módulo NC no se ha subido). En ese caso solo se despliega la nueva; no hay vieja que borrar.

## Testing (Fase 0)
- `pnpm build` verde (TypeScript compila con los nombres nuevos).
- `pnpm test` verde (los tests existentes que llamen wrappers deben seguir pasando con los nombres nuevos).
- Verificación manual/BD: `select proname from pg_proc where proname in (<nombres nuevos>)` devuelve las 11; los nombres viejos ya no existen.
- Prueba funcional de humo en cloud tras deploy: una venta emite boleta (invoca `issue-receipt`), abrir/cerrar caja funciona.

---

# Fase 1 — Búsqueda de cliente en la venta (features 1 y 2 originales)

## Componente `CustomerPickerDialog`

**Archivo nuevo:** `src/modules/venta/CustomerPickerDialog.tsx`.

**Props:**
```ts
interface CustomerPickerDialogProps {
  open: boolean;
  businessId: string | undefined;
  onSelect: (customer: CustomerRow) => void;   // eligió un cliente
  onContinueWithout: () => void;                // "continuar sin cliente"
  onClose: () => void;                          // cerró sin decidir (equivale a cancelar)
}
```

**Comportamiento:**
- Modal centrado (patrón overlay ya usado en el proyecto: `fixed inset-0 z-50 … bg-[rgba(0,0,64,.45)]`).
- Campo de búsqueda (autofocus) que filtra `useCustomers(businessId)` con `filterCustomers(rows, query)` (ya busca nombre + teléfono + email). Lista de resultados con nombre + teléfono/email; clic → `onSelect(customer)`.
- Botón **"Continuar sin cliente"** → `onContinueWithout()`.
- Botón **"Nuevo cliente"** → conmuta a un mini-formulario embebido (nombre requerido, teléfono y email opcionales). "Guardar" llama `createCustomer({ business_id, name, phone, email })`, invalida `["customers", businessId]`, y llama `onSelect(nuevoCliente)`. Validación: nombre no vacío.
- Estados de carga y error con `notifyError`/`toast` (patrón del proyecto).

## Integración en `VentaScreen`

1. **Feature 1 (botón cliente):** reemplazar el `<select>` de cliente por un **botón "Cliente"** que muestra el nombre del cliente elegido o "Sin cliente". Al pulsarlo, `setPickerOpen(true)`. `onSelect` → `setCustomerId(c.id)`; `onContinueWithout`/`onClose` → cierra (mantiene el `customerId` actual). Un botón "×" junto al nombre permite limpiar el cliente (`setCustomerId(null)`).
2. **Feature 2 (popup al primer ítem):** nueva bandera `askedForCustomer: boolean` (`useState(false)`). En `addToCart`, **antes** de agregar: si el carrito estaba vacío (primer ítem) y `customerId === null` y `!askedForCustomer`, entonces `setAskedForCustomer(true)` y `setPickerOpen(true)` (el ítem igual se agrega; el popup no bloquea la venta). La bandera evita reaparecer en ítems siguientes o si ya se eligió "sin cliente". Se resetea (`setAskedForCustomer(false)`) al cobrar (junto con el reset de `cart`/`customerId`) y al limpiar el carrito.

**Data flow:** el `customerId` resultante ya viaja hoy a `charge_sale` vía `p_customer` — sin cambios en el backend.

## Testing (Fase 1)
- Test unitario de `filterCustomers` ya cubre la búsqueda; agregar test del criterio de apertura del popup (función pura `shouldPromptCustomer(cartEmpty, customerId, asked)` extraída para testear sin render).
- Verificación manual: buscar por teléfono y por email encuentra al cliente; alta rápida crea y selecciona; primer ítem abre popup solo una vez; "sin cliente" no reabre.

---

# Fase 2 — Descuentos configurables (feature 4)

## Datos — tabla nueva `discount`

**Migración:** `supabase/migrations/20260714140000_discount.sql`.

```sql
create table public.discount (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  percent     int  not null check (percent between 1 and 100),
  active      boolean not null default true,
  valid_from  date,          -- null = sin límite inferior
  valid_until date,          -- null = sin límite superior
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index idx_discount_business on public.discount(business_id);
```
- Trigger `set_updated_at` (patrón existente).
- RLS (decidido): policy `discount_read` (loop genérico: negocio propio o kromi) + policy `discount_write` para ALL con `business_id = current_business_id() and is_pos_admin()` — es configuración administrativa, solo admin la gestiona.

**Columna nueva en `sale`:** `discount_id uuid references public.discount(id) on delete set null` (nullable, para trazabilidad: "¿cuántas ventas usaron Plan Café?"). Se agrega en la misma migración.

## Capa de datos

`src/data/discounts.ts` (nuevo):
```ts
export interface DiscountRow { id: string; name: string; percent: number; active: boolean; valid_from: string | null; valid_until: string | null; }
export function useDiscounts(businessId?: string)          // todos (config), key ["discounts", businessId]
export function useActiveDiscounts(businessId?: string)     // solo active + vigentes hoy, para el cobro
export async function createDiscount(input)
export async function updateDiscount(id, input)             // incluye toggle active
export async function softDeleteDiscount(id)
export function isDiscountVigente(d: DiscountRow, today?: Date): boolean  // valid_from<=hoy<=valid_until (nulls = sin límite)
```

## Configuración — introducir pestañas en `/admin`

`BusinessSettings.tsx` es hoy monolítico. Se introduce una navegación por pestañas simple dentro de `/admin`:
- **`src/modules/admin/AdminScreen.tsx`** (nuevo): contenedor con pestañas **"Negocio"** y **"Descuentos"** (estado local `tab`, mismo patrón visual de tabs que `CotizacionesScreen`).
- **"Negocio"** → renderiza el `BusinessSettings` actual **sin cambios** (se extrae su contenido a un componente si hace falta, sin tocar su lógica).
- **"Descuentos"** → **`src/modules/admin/DiscountsSettings.tsx`** (nuevo): lista de descuentos (nombre, %, estado activo/vigente, vigencia) + formulario de alta/edición (nombre, %, activo, vigencia desde/hasta) + eliminar (soft-delete con confirmación, patrón `confirmDeleteId`).
- `src/App.tsx`: `AdminRoute` pasa a renderizar `<AdminScreen/>` (mantiene `RequireRole allow=["admin","kromi"]`).

## Aplicación en el cobro

En `PayDialog` (o en `VentaScreen` antes de abrir el cobro — a definir en el plan según dónde encaje mejor el recálculo de totales):
- Selector **"Descuento"** poblado con `useActiveDiscounts(businessId)` + opción "Sin descuento".
- Al elegir un descuento, el total se recalcula: `computeTotals(lines, totalDiscount)` donde `totalDiscount = resolveDiscount(subtotalTrasDescuentosDeLinea, "pct", discount.percent)`. Se muestra el nuevo total y el monto descontado.

## Backend — `charge_sale` acepta descuento predefinido

La RPC `charge_sale` (ya renombrada en Fase 0) gana un parámetro `p_discount_id uuid default null`:
- Si `p_discount_id` no es null: el servidor lee `discount` (mismo `business_id`, `active`, vigente por fecha). Si es válido, aplica su `percent` como descuento total **sin exigir `is_pos_admin()`** (es un descuento aprobado por el admin, no ad-hoc). Guarda `sale.discount_id`. Si el descuento no existe/no vigente/otro negocio → `raise exception`.
- El descuento **ad-hoc** libre (`p_total_disc`) se mantiene y **sigue exigiendo** `is_pos_admin()`.
- **Precedencia (decidida):** `p_discount_id` y `p_total_disc` son **mutuamente excluyentes**. Si llegan ambos no-null, `p_discount_id` tiene prioridad y `p_total_disc` se ignora. La UI del cobro solo enviará uno de los dos.

`src/data/sales.ts`: `chargeSale(...)` gana `p_discount_id?: string | null`. `VentaScreen.handleConfirmPay` lo pasa según el descuento elegido.

**SII:** el descuento total ya se refleja como `DescuentoMonto` en la Edge Function `issue-receipt`; el monto guardado en `sale.discount_amount` no cambia de forma, así que **no requiere cambios** en la emisión.

## Testing (Fase 2)
- `isDiscountVigente` con casos: sin fechas, solo `valid_from`, solo `valid_until`, rango, fuera de rango.
- Test de esquema/RPC (`pnpm test:db` si aplica): `charge_sale` con `p_discount_id` válido aplica el %, guarda `discount_id`; con descuento inactivo/vencido/de otro negocio lanza excepción; sin exigir admin.
- Verificación manual: crear "Alianza Plan Café 10%" activo, cobrar aplicándolo, la boleta muestra el descuento y `sale.discount_id` queda seteado.

---

# Fase 3 — Módulo Historial (feature 2 original)

## Ruta y navegación
- Ruta `/historial` en `src/App.tsx`, envuelta en `RequireRole allow=["admin","kromi"]` (patrón `AdminRoute`/notas-credito).
- Ítem "Historial" en `src/session/nav.ts`, visible solo para admin/kromi (junto al patrón de "Notas de crédito").

## Capa de datos
`src/data/sales.ts` — hook nuevo:
```ts
interface SalesHistoryFilters {
  from?: string;          // ISO date; default hoy
  to?: string;            // ISO date; default hoy
  customerId?: string | null;
  folio?: number | null;  // folio interno o folio SII (a decidir en el plan; por defecto folio interno)
  page?: number;          // 0-based, para "cargar más"
}
export function useSalesHistory(branchId: string | undefined, filters: SalesHistoryFilters)
// SELECT sobre sale + join customer(name) + sale_line, filtros aplicados server-side (rango sold_at,
// eq customer_id, eq folio), order sold_at desc, .range(page*PAGE, page*PAGE+PAGE-1). PAGE = 50.
```
- Permitido por RLS (SELECT del negocio propio).
- Paginación acumulativa: el hook devuelve la página; la pantalla acumula resultados y muestra "Cargar más" mientras la última página venga llena.

## Pantalla `HistorialScreen`
`src/modules/historial/HistorialScreen.tsx` (nuevo):
- **Filtros** en barra superior: rango de fechas (desde/hasta, default hoy), cliente (reutiliza el `CustomerPickerDialog` de la Fase 1 para elegir el filtro de cliente), folio (input numérico). Botón "Aplicar"/reactivo.
- **Listado**: filas con folio interno, fecha/hora, cliente, método, total, estado/folio DTE. Estado vacío cuando no hay resultados.
- **Acciones por fila:**
  - **Ver detalle** → modal con líneas (`sale_line`), totales (neto/iva/total/descuento), cliente, método y folio SII. Reutiliza el snapshot que ya trae el hook.
  - **Reimprimir boleta** → si la venta tiene `dte_folio`, llama `printReceipt(...)` con el mismo mapeo que "Boletas del día" (incluye `dte_folio` y `timbre_png` = `dte_timbre`, `reimpresion: true`). Deshabilitado si no hay boleta emitida.
  - **Emitir nota de crédito** → navega a `/notas-credito/nueva` con el folio SII precargado (query param o estado de navegación; el plan define el mecanismo, reusando la búsqueda por folio ya existente en el módulo NC).

## Testing (Fase 3)
- Test de construcción de filtros → query (función pura que arma el rango de fechas y condiciones, testeable sin red).
- Verificación manual: filtrar por rango de fechas, por cliente y por folio; "cargar más" pagina; reimprimir una boleta emitida; "emitir NC" abre el módulo con el folio correcto.

---

## Restricciones globales (aplican a todas las fases)

- **Idioma**: prosa/UI en español; identificadores, nombres de funciones, claves y flags en inglés (este spec es, en parte, para cumplir esto en las funciones).
- **Commits**: exclusivamente como `Cromilakis <ipcromilakis@gmail.com>`; prohibido `Co-Authored-By` y cualquier atribución a Claude/Anthropic.
- **Cloud**: la app apunta a producción. Todo cambio de esquema/función/Edge Function en cloud requiere confirmación explícita del usuario antes de aplicarse. Backup previo cuando corresponda.
- **Secretos** fuera del cliente y del repo.
- **Textos de UI** externalizados según el patrón del proyecto; no hardcodear strings dispersos si hay un mecanismo existente.
- **Migraciones históricas inmutables**: nunca editar una migración ya aplicada en cloud; los cambios van en migraciones nuevas.

## Migraciones nuevas (resumen)
1. `20260714130000_rename_functions_english.sql` (Fase 0).
2. `20260714140000_discount.sql` — tabla `discount`, `sale.discount_id`, RLS, y `charge_sale` con `p_discount_id` (Fase 2).

> Queda además pendiente de cloud, de trabajo previo, la migración de Notas de Crédito `20260714090000_credit_note_dte.sql` y la de `20260714120000_eliminar_cotizacion.sql` (ya aplicada). El plan coordinará el orden de aplicación en cloud.

## Fuera de alcance (YAGNI)
- Descuentos por monto fijo (`$`) — solo `%` por ahora.
- Descuentos automáticos por cliente/grupo, o por código.
- Combinación de múltiples descuentos en una misma boleta (solo uno predefinido a la vez).
- Renombrar helpers ya en inglés o términos de dominio (`rut`, `folio`, `dte`).
- Reescribir migraciones históricas al inglés.
