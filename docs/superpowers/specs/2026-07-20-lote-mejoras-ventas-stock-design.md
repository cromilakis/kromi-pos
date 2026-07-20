# Lote de mejoras: venta, inicio, stock y proveedor — Diseño

**Fecha:** 2026-07-20
**Rama:** feature/lote-mejoras-ventas-stock

## Objetivo

Lote de 7 mejoras sobre la venta, el inicio (dashboard), el stock y el alta de
producto. Incluye reubicación de controles del carrito, nuevas métricas por método de
pago, distinción visual del stock crítico, exportación CSV con diálogo nativo,
normalización de estilos de formularios, y un subsistema nuevo de histórico de precios
por proveedor con gráfico de línea.

## Estado actual (verificado)

- **Venta** (`src/modules/venta/VentaScreen.tsx`): el header de acciones tiene el botón
  de *cliente* (abre `CustomerPickerDialog`, líneas ~576-585) y el de *carritos guardados*
  ("Guardadas (n)", líneas ~587-592). El panel del carrito (`src/modules/venta/Cart.tsx`)
  tiene en su header dos íconos: guardar/retener (`onHold`) y vaciar. El cliente
  seleccionado hoy solo se muestra como texto en el botón del header.
- **Inicio** (`src/modules/inicio/InicioScreen.tsx`): 4 tarjetas — "Ventas de hoy"
  (conteo), "Total vendido", "Ticket promedio", "Nuevos clientes" (hardcodeado 0).
  `useSalesToday`/`summarizeSales` (`src/data/sales.ts`) solo suma `total`, cuenta filas
  y calcula promedio; el campo `method` existe en `sale` pero no se agrupa.
- **Stock crítico**: el flag `product.critical` (booleano manual) solo pinta un badge
  `★ Crítico`. El "stock bajo" (`min_stock>0 && stock<=min_stock`, `isLowStock`) se muestra
  aparte con color rojo y texto "Stock bajo". El banner de StockScreen dice "crítico" pero
  filtra por stock bajo, no por el flag.
- **Export CSV**: `downloadCsv` en `StockScreen.tsx` usa Blob + `<a download>` (descarga
  de navegador a Descargas, sin diálogo). Solo existe `exportCriticalCsv` (lista de stock
  bajo). No hay export del inventario completo. El PDF del DTE (`src/lib/fileSave.ts`
  `saveUrlAs`) sí usa el diálogo nativo de Tauri (`@tauri-apps/plugin-dialog` + `invoke("save_file")`).
- **Estilos**: `ProductForm.tsx` usa `<select>` nativos con el mismo `inputStyle` inline
  que los inputs, pero sin `appearance`/`height`, por lo que el navegador los renderiza con
  alto/flecha distintos. Existe un `ui/select.tsx` (shadcn/Radix) no usado en estos forms.
- **Proveedor**: `ProductForm` tiene un `<select>` de proveedor que guarda
  `product.supplier_id`. Ese campo **solo** se usa en el form, el tipo `ProductRow`, el
  `select` de `useProducts` y los tests — **no** en compras ni en ninguna RPC. Las compras
  registran precio+fecha por producto en `purchase_invoice` (`supplier_id`, `issued_at`) +
  `purchase_invoice_line` (`product_id`, `unit_cost`). No hay librería de gráficos instalada.

## Decisiones (aprobadas)

- Los 7 puntos van en **un solo lote** (una rama, un plan).
- Gráfico del histórico: **instalar `recharts`**.
- En la vista de proveedor del producto, el proveedor elegido es **solo visor/filtro** del
  histórico; el producto **deja de guardar** `supplier_id` (se elimina el atributo).
- "CCB" del pedido = **CSV**: el punto 4 aplica al export CSV (diálogo nativo), no al PDF.

---

## 1. Carrito: reubicar cliente y carritos guardados

**Archivos:** `src/modules/venta/Cart.tsx`, `src/modules/venta/VentaScreen.tsx`.

- Quitar del header de `VentaScreen` el botón de *cliente* (+ su "×") y el de *carritos
  guardados* ("Guardadas").
- En el header de `Cart.tsx`, junto al ícono de **guardar carrito** (`onHold`), agregar un
  ícono de **abrir carritos guardados** que dispare la apertura del modal de guardadas.
- Debajo de la fila de íconos, arriba del listado de ítems, una línea de **cliente actual**:
  - Con cliente: muestra el nombre (y "×" para quitarlo).
  - Sin cliente: texto **"Cliente no registrado"**, clickeable, que abre el
    `CustomerPickerDialog` (registro/selección de cliente).
- `Cart` recibe por props los handlers/estado necesarios (cliente seleccionado, abrir
  picker, abrir guardadas, quitar cliente, cantidad de guardadas). `VentaScreen` mantiene
  el estado (`pickerOpen`, `heldOpen`, `customerId`) y los modales; solo se mueve el disparo.

## 2. Inicio: métricas por método de pago

**Archivos:** `src/data/sales.ts`, `src/modules/inicio/InicioScreen.tsx`.

- `summarizeSales` pasa a devolver también `card` y `cash` (suma de `total` filtrando por
  `method`). `useSalesToday` debe seleccionar `total,method`.
- Las 4 pilas del Inicio quedan: **Total vendido** (`total`), **Ticket promedio** (`avg`),
  **Total tarjeta** (`card`), **Total efectivo** (`cash`). Se eliminan "Ventas de hoy"
  (conteo) y "Nuevos clientes".

## 3. Stock crítico: indicar el flag `critical`

**Archivos:** `src/modules/stock/StockScreen.tsx`, `src/modules/inicio/InicioScreen.tsx`.

- Donde hoy solo se muestra "stock bajo", los productos con `critical === true` deben
  llevar además un **indicador de crítico** (ícono/★ + etiqueta "Crítico"), visualmente
  distinto del stock bajo común.
- No se cambia la lógica de negocio (low-stock sigue siendo `min_stock`), solo la
  presentación: un producto puede ser "stock bajo", "crítico", o ambos, y se ve como tal.
- `useCriticalStock` (`src/data/sales.ts`) debe exponer el flag `critical` por fila para que
  la tarjeta de Inicio pueda marcarlo.

## 4 + 5. Export CSV con diálogo nativo + inventario completo

**Archivos:** `src/lib/fileSave.ts`, `src/modules/stock/StockScreen.tsx`.

- Agregar a `fileSave.ts` una función `saveTextAs(text, filename, mimeType)` que, en Tauri,
  abra el diálogo nativo "Guardar como" (`@tauri-apps/plugin-dialog` `save` + `invoke("save_file")`,
  reutilizando el patrón de `saveUrlAs`), y en navegador caiga al `<a download>` actual.
  No muestra toast de éxito.
- `downloadCsv` de `StockScreen` pasa a delegar en `saveTextAs` (conserva BOM y formato).
  El `exportCriticalCsv` existente queda usando el diálogo nativo.
- Nuevo **export del inventario completo**: botón "Exportar stock (CSV)" en el header de
  StockScreen que exporta todos los productos con columnas **`nombre, cantidad, precio`**
  (nombre = `name`, cantidad = `stock`, precio = `price`), nombre de archivo
  `stock-YYYY-MM-DD.csv`, vía `saveTextAs`.

## 6. Normalizar `<select>` con los inputs

**Archivos:** `src/modules/stock/ProductForm.tsx` (y demás forms con `<select>` nativos:
`PayDialog.tsx` descuento, `CustomerForm`/otros si aplica).

- Definir un `selectStyle` derivado de `inputStyle` con `appearance: "none"`, `height`
  explícito igual al alto efectivo del input, `lineHeight`, `padding` simétrico y una flecha
  custom (background SVG data-URI o un ícono absoluto) para que input y select se vean como
  un mismo diseño.
- Aplicar `selectStyle` a los `<select>` nativos de los formularios. No se migra a shadcn
  Select (fuera de alcance); se normalizan los nativos existentes.

## 7. Proveedor + histórico de precios (subsistema)

**Archivos:** `package.json` (recharts), `src/data/purchases.ts` (o nuevo `priceHistory.ts`),
nueva migración (drop `product.supplier_id`), `src/data/stock.ts`, `src/modules/stock/ProductForm.tsx`,
nuevo componente `src/modules/stock/PriceHistory.tsx`, `src/data/stock.test.ts`.

### 7.1 Quitar `supplier_id` del producto

- Migración: `alter table public.product drop column supplier_id;` (columna muerta: solo se
  usaba en el form/tipo/select/tests, nunca en compras ni RPC).
- Quitar `supplier_id` de `ProductRow`, del `select` de `useProducts`, de los inputs de
  `createProduct`/`updateProduct`, del `<select>` de proveedor en `ProductForm`, y de los
  fixtures de `stock.test.ts`.

### 7.2 Datos del histórico

- Nuevo hook `usePriceHistory(productId, supplierId?)` que une
  `purchase_invoice_line ⋈ purchase_invoice` filtrando por `product_id` (y `supplier_id` si
  se pasa), devolviendo una serie ordenada por `issued_at`: `{ issued_at, unit_cost, supplier_id, supplier_name }[]`.
- Hook `useProductSuppliers(productId)` (o derivado del anterior) que lista los proveedores
  que tienen compras de ese producto, para el dropdown-filtro.

### 7.3 UI en `ProductForm`

- Reemplazar el dropdown de proveedor por una sección **"Histórico de precios"**:
  - Dropdown de proveedor (los que tienen compras del producto) — filtro del gráfico.
    Opción "Todos" para ver todas las series/combinada.
  - Gráfico de línea (**recharts**) de `unit_cost` (eje Y, CLP) vs `issued_at` (eje X), con
    tooltip mostrando fecha y precio.
  - Solo aplica en producto **existente**; en alta nueva, mensaje "El histórico aparece
    tras registrar compras de este producto".
- El gráfico solo evidencia subidas/bajadas de un mismo producto por proveedor; no compara
  proveedores entre sí (se cambia el filtro para ver otro).

## Fuera de alcance

- Migrar los formularios al componente Select de shadcn/Radix (solo se normalizan los nativos).
- Comparación lado a lado de precios entre proveedores (solo cambio de filtro).
- Nuevas métricas de Inicio más allá de las 4 pilas definidas.

## Testing

- `pnpm test`: `summarizeSales` con `card`/`cash`; el hook de histórico si tiene lógica de
  transformación testeable; fixtures de `stock.test.ts` sin `supplier_id`.
- `pnpm typecheck` y `pnpm test:db` (migración drop column corre limpia).
- Verificación manual: carrito reubicado; 4 pilas correctas; badge crítico; diálogo nativo
  de CSV (en Tauri); export de inventario completo; selects normalizados; gráfico de
  histórico con datos de compras reales.
