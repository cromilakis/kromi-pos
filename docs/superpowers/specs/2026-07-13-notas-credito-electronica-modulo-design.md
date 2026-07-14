# Módulo de Notas de Crédito Electrónicas (DTE 61) — Diseño

**Fecha:** 2026-07-13
**Estado:** Aprobado (brainstorming)

## Contexto

Hoy la nota de crédito (NC) en kromi-pos es un **diálogo modal dentro del módulo de Ventas** (`CreditNoteDialog` montado en `VentaScreen`). Solo hace **registro local**: la RPC `emitir_nota_credito` inserta `credit_note` + líneas y repone stock, y se imprime un comprobante **"Documento no tributario"** (sin timbre). **No emite el DTE 61 al SII.**

Se validó por script (producción) que San José SpA puede emitir una NC electrónica **61** que anula una boleta: folio 1, `Anulación DTE tipo 39 folio 5001`, **aceptada por el SII** (TrackId 12241121978). El formato quedó confirmado: endpoint `POST /invoiceCreditDebitNotesV2/{sucursal}/{motivo}`, montos netos, referencia `CodRef=1` a la boleta 39.

## Objetivo

Rediseñar la NC como **módulo propio** con pantalla dedicada que:

1. Busca la boleta **por folio** (único identificador visible de la boleta).
2. Permite **anular completa** o **devolver líneas parciales**.
3. **Emite el DTE 61** electrónico al SII, referenciando la boleta.
4. Imprime un **comprobante tributario con timbre** (PDF417).
5. Lista **todas las NC emitidas**, con estado y acciones.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Emisión electrónica | Sí — emite el DTE 61 al SII (folio + timbre reales) |
| Operaciones | Anular completa (`CodRef 1`) + devolución parcial (`CodRef 3`) |
| Permisos | Solo admin/supervisor (`RequireRole allow=["admin","kromi"]`) |
| UI | Pantalla propia (no modal) |
| Montos del DTE | Línea-resumen en netos (validado y aceptado por el SII); el comprobante detalla los productos |
| Modo "manual" (sin boleta) | Eliminado — una NC electrónica debe referenciar una boleta |

## Arquitectura

### Navegación (3 piezas coordinadas)

- **Router** `src/App.tsx`: ruta `notas-credito` (listado) y `notas-credito/nueva` (formulario), envueltas en `RequireRole allow=["admin","kromi"]` (patrón `AdminRoute`).
- **Menú** `src/session/nav.ts`: entrada en la lista de items admin (junto a "Administración"), `{ to: "/notas-credito", label: "Notas de crédito" }`.
- **Icono** `src/shell/AppLayout.tsx`: mapear el label a un icono lucide en `NAV_ICON` (p. ej. `FileMinus`).
- **Se elimina** el botón "Nota de crédito" y el `<CreditNoteDialog>` de `VentaScreen.tsx`.

### Pantallas (`src/modules/notas-credito/`)

- **`NotasCreditoScreen.tsx`** — listado de NC emitidas: columnas folio NC, boleta referenciada, fecha, total, motivo, **estado DTE** (emitida / pendiente / rechazada). Acciones por fila: **reimprimir** comprobante y **reintentar emisión** si quedó pendiente. Botón **"Nueva nota de crédito"**.
- **`NuevaNotaCredito.tsx`** (ruta `/notas-credito/nueva`) — vista de **pantalla completa** (no modal): buscar boleta por folio → mostrar la boleta (líneas, totales) → elegir **anular completa** o **devolver líneas seleccionadas** (cantidad por línea con tope a lo vendido, toggle "reponer stock") → motivo y medio de devolución → **Emitir NC 61**.

La *lógica* del `CreditNoteDialog` actual (búsqueda por folio, selección por línea con `maxQty`, restock, cálculo de total en cliente) se reutiliza; la UI se rehace como vista propia. Se elimina el modo "manual".

## Flujo de emisión

Al confirmar **"Emitir NC 61"** (mismo patrón que boletas):

1. `emitirNotaCredito` (RPC) → registra `credit_note` + líneas + **repone stock** → devuelve la NC (folio interno).
2. `emitirNotaCreditoDte(ncId)` (nuevo, en `src/data/sii.ts`) → invoca la Edge Function **`emitir-nota-credito`**.
3. La Edge Function arma el DTE 61, lo envía a SimpleFactura y persiste `dte_folio` / `dte_timbre` / `dte_track_id` / `dte_status` en `credit_note`.
4. Si **aceptada** → imprime el comprobante **con timbre**. Si **no** → queda **pendiente**, **no se imprime**, y se avisa para reintentar desde el listado (nunca un "pendiente de emisión" en papel).

**Referencia a la boleta** (lo que la hace válida ante el SII):
- `TpoDocRef = 39`, `FolioRef = sale.dte_folio` (**folio SII** de la boleta, p. ej. 5001 — no el folio interno), `FchRef =` fecha de emisión de la boleta, `CodRef = 1` (anular) o `3` (devolución parcial), `RazonRef =` motivo.
- **Precondición:** solo se puede anular/devolver una boleta **ya emitida** (con `dte_folio`). Si está pendiente, el módulo no deja crear la NC.

**Montos:** el DTE 61 es afecto y va en **netos** (la boleta viene con IVA incluido). Se usa una **línea-resumen** por el neto total (`MntNeto`, `TasaIVA 19`, `IVA`, `MntTotal`). El **comprobante impreso** sí detalla los productos devueltos desde `credit_note_line`.

> **Validación pendiente:** la **anulación completa** (`CodRef 1`) con línea-resumen ya fue **aceptada por el SII** (folio 1). La **devolución parcial** (`CodRef 3`) con el mismo esquema aún **no se ha probado**; se validará durante la implementación con uno de los folios de prueba restantes antes de darla por cerrada.

## Base de datos

### Migración nueva (`credit_note` gana columnas DTE, análogo a `sale`)

- `dte_status text` — check (`pendiente`/`emitida`/`rechazada`/`error`), default `pendiente`.
- `dte_folio int`, `dte_timbre text` (PNG base64), `dte_track_id text`, `emitted_at timestamptz`.
- `cod_ref smallint` — 1 (anula) o 3 (devolución parcial); define la referencia y el motivo del endpoint.

La referencia a la boleta se resuelve desde el `sale_id` que ya existe en `credit_note`.

### Ajuste de la RPC `emitir_nota_credito`

- Recibe nuevo parámetro `p_cod_ref` y lo persiste.
- Para NC por boleta (`p_sale` no nulo), calcula el total con `sale_line.price_snapshot` (**precio de la boleta**) en lugar del precio actual del producto → el total cuadra con la boleta.
- Valida que la cantidad devuelta por línea no exceda la vendida.

## Edge Function `emitir-nota-credito`

Clon de `emitir-boleta` con estas diferencias:

- Recibe `{ credit_note_id }`; **idempotente** (si `dte_status='emitida'` y hay `dte_folio`, devuelve lo persistido).
- Lee `credit_note` + `credit_note_line` + la boleta (`sale`) por `sale_id`.
- **Precondición:** `sale.dte_folio` presente → si no, responde error "boleta no emitida".
- Arma DTE **TipoDTE 61**:
  - **Emisor** San José **con Acteco** (obligatorio en el 61; en la boleta no iba).
  - **Receptor** consumidor final (`66666666-6`).
  - **Totales** netos de la NC.
  - **Detalle**: línea-resumen (`NmbItem` "ANULA/DEVOLUCION BOLETA N …", `PrcItem`/`MontoItem` = neto).
  - **Referencia** a la boleta (`TpoDocRef 39`, `FolioRef=sale.dte_folio`, `FchRef`, `CodRef=credit_note.cod_ref`, `RazonRef=reason`).
- Endpoint `POST /invoiceCreditDebitNotesV2/{sucursal}/{cod_ref}`.
- Pide el timbre en **producción** (`ambiente=1` — la corrección del bug de la boleta ya incorporada).
- Persiste `dte_status`, `dte_folio`, `dte_timbre`, `emitted_at` (y `dte_track_id` si está disponible) en `credit_note` con service role.

## Listado e impresión

- **Listado**: `useCreditNotes(branchId)` en `src/data/sales.ts` (patrón de `useQuotes`: `.from("credit_note").select("…,credit_note_line(…)").eq("branch_id", …)`). La política RLS `_read` ya permite la lectura.
- **Impresión**: extender `CreditNotePayload` (TS en `src/lib/print.ts` y `struct` en `src-tauri/src/escpos.rs`) con `dte_folio` + `timbre_png`; `build_credit_note` renderiza el **PDF417** como hace la boleta (`ReceiptPayload.timbre_png`) y cambia el footer de "Documento no tributario" a la glosa de timbre SII. Si aún no hay timbre (NC pendiente), no se imprime el comprobante.

## Manejo de errores

- DTE rechazado/error → `credit_note.dte_status` = `rechazada`/`pendiente`; la NC local existe (stock ya repuesto), el comprobante **no** se imprime, y el listado ofrece **reintentar**. El formato ya está validado, así que el rechazo del SII es un caso excepcional.

## Fuera de alcance

- **Folios de NC de producción**: es un trámite operativo (no software). Hoy quedan 2; para operar hay que solicitar un rango mayor.
- **NC manual sin boleta**: eliminada — no puede emitir un DTE 61 (no hay documento a referenciar).
- Reversión automática de stock ante un rechazo definitivo del SII (caso excepcional; se maneja con el reintento).
