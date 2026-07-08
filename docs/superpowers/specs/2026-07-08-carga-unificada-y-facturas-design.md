# Carga de stock unificada + pantalla de facturas con filtros — Diseño

**Fecha:** 2026-07-08
**Rama:** `feature/recepcion-facturas`

## Objetivo

1. Unificar en **un solo botón "Cargar stock"** la carga por CSV y por factura PDF: abre una pantalla interna con una zona de **arrastrar y soltar** que acepta CSV y PDF, y despacha según el formato.
2. Convertir el listado de **facturas de compra** en una **pantalla interna** (ya no modal) con **filtros** (proveedor, rango de fechas, rango de monto, texto por folio/razón social).

## Decisiones fijadas (con el usuario)

- CSV empareja cada fila por **código interno** del producto (`internal_code`, ej. `001-00T017`). Solo suma a productos existentes; los códigos no encontrados se listan y se ignoran.
- Filtros de facturas: proveedor, rango de fechas, rango de monto, y búsqueda de texto (folio + razón social). Todos.

## Navegación

`StockScreen` ya alterna una vista interna (`list` / `recepcion`). Se extiende a **`list` · `cargar` · `facturas`** (se elimina `recepcion`, absorbida por `cargar`). En la barra de acciones quedan **dos** botones: **"Cargar stock"** → `cargar`; **"Facturas de compra"** → `facturas`. Ambas vistas ocupan el ancho completo del contenido con encabezado y "← Volver a stock".

## 1. Pantalla "Cargar stock" (`cargar`) — `src/modules/stock/StockLoad.tsx` (nuevo)

- **Dropzone** único (arrastrar y soltar + click para explorar), `accept=".csv,application/pdf"`. Estados de arrastre (resaltado del borde).
- Al recibir un archivo, despacha por extensión/MIME:
  - **PDF** → `extractInvoice(file)` (OpenAI); mientras tanto muestra "Procesando Factura" con spinner; al volver, renderiza `InvoiceConfirm` (mismo componente actual) en la pantalla. `onDone`/`onCancel` vuelven a la lista de stock (o al dropzone).
  - **CSV** → lee el texto, `parseStockCsv`, arma preview con `matchStockRows` (empareja por `internal_code`); muestra la tabla de preview (código, producto, stock actual, +suma, resultado) + códigos no encontrados; "Confirmar" aplica con `upsertInventory` e invalida queries.
  - Otro tipo → toast "Solo se aceptan archivos CSV o PDF".
- Reutiliza la lógica existente; el componente `InvoiceUpload` (picker propio) se retira: su rol de subida lo cubre el dropzone unificado, y su estado "Procesando Factura"/cancelar se traslada a `StockLoad`.

### Lógica CSV extraída — `src/lib/stockCsv.ts` (nuevo)

- `parseStockCsv(text: string): { codigo: string; cantidad: number }[]` (movido desde `StockScreen`, misma implementación).
- `matchStockRows(entries, products)` puro:
  ```ts
  interface StockMatchRow { id: string; name: string; internal_code: string; current: number; add: number; next: number; }
  interface StockMatchResult { rows: StockMatchRow[]; unknown: string[]; }
  function matchStockRows(
    entries: { codigo: string; cantidad: number }[],
    products: { id: string; name: string; internal_code: string | null; stock: number }[],
  ): StockMatchResult
  ```
  Empareja `entries[].codigo` contra `products[].internal_code` (no nulo). Suma cantidades de filas con el mismo código. Cantidades `<= 0` o código vacío se ignoran. Códigos sin producto → `unknown` (sin duplicar).

## 2. Pantalla "Facturas de compra" (`facturas`) — `src/modules/compras/PurchaseInvoicesScreen.tsx` (nuevo)

- Reemplaza el modal `PurchaseInvoicesList.tsx` (se elimina el modal).
- **Barra de filtros**: Proveedor (`<select>` con `useSuppliers`), Desde/Hasta (`<input type="date">`), Monto mín/máx (`<input type="number">` con `$`), y búsqueda de texto (folio + razón social).
- **Tabla**: Proveedor · Folio · Fecha · Total · Descargar PDF (URL firmada, igual que hoy).
- Filtrado en cliente sobre las facturas cargadas, vía `filterInvoices` (abajo).
- Estados: cargando, sin facturas, sin resultados (con filtros aplicados).

### Lógica de filtros — `src/lib/invoiceFilters.ts` (nuevo)

```ts
interface InvoiceFilters { supplierId: string; from: string; to: string; min: string; max: string; text: string; }
interface FilterableInvoice { supplier_id: string | null; folio: string | null; issued_at: string | null; total: number | null; supplierName: string; }
function filterInvoices<T extends FilterableInvoice>(invoices: T[], f: InvoiceFilters): T[]
```
- `supplierId` vacío = todos; si no, `supplier_id === f.supplierId`.
- `from`/`to` (YYYY-MM-DD) comparan contra `issued_at`; vacío = sin límite; facturas sin fecha se excluyen solo si hay algún límite de fecha.
- `min`/`max` comparan contra `total`; vacío = sin límite.
- `text` (case-insensitive, trim) matchea si `folio` **o** `supplierName` lo contienen; vacío = no filtra.

## Datos — `src/data/purchases.ts`

- `usePurchaseInvoices`: subir `limit` a 500 y agregar `supplier_id` al `select` (para el filtro por proveedor). El resto igual (orden por `created_at desc`).

## Cambios en `StockScreen.tsx`

- `view: "list" | "cargar" | "facturas"`.
- Barra de acciones: reemplazar los botones "Cargar stock" (CSV), "Cargar desde factura" (PDF) y "Facturas de compra" (modal) por **"Cargar stock"** (→ `cargar`) y **"Facturas de compra"** (→ `facturas`). Se mantiene "Categorías" y "+ Agregar producto".
- Eliminar del cuerpo: el `<input type="file" .csv>`, `pickFile`/`onFile`/`confirmImport`/`importPreview` y el modal de preview CSV (migran a `StockLoad`/`stockCsv.ts`); y el estado/uso de `PurchaseInvoicesList` (migra a `PurchaseInvoicesScreen`).
- Renderizar la vista según `view`.

## Manejo de errores

- Tipo de archivo no soportado → toast.
- CSV inválido / sin filas válidas → mensaje en el preview.
- Extracción PDF → manejo actual (toast con mensaje real).
- Filtros sin resultados → estado "Sin resultados".

## Testing

- `src/lib/stockCsv.test.ts`: `matchStockRows` — empareja por `internal_code`, suma duplicados, ignora cantidades ≤ 0 y códigos vacíos, reporta desconocidos sin duplicar, tolera `internal_code` null.
- `src/lib/invoiceFilters.test.ts`: `filterInvoices` — cada filtro por separado y combinados; texto por folio y por razón social; sin fecha con y sin límites.
- typecheck + test + build verdes.

## Restricciones (heredadas)

- Identidad de commits: solo `Cromilakis <ipcromilakis@gmail.com>`. Sin co-author ni atribución a Claude.
- `OPENAI_API_KEY`/secretos solo en la edge function. Escritura crítica solo por RPC (la recepción sigue por `recepcionar_factura`; el CSV solo hace `upsertInventory`, que ya existía).
- Nunca `git add -A`; no tocar `src-tauri/*`. Marca vía `var(--brand)`.
