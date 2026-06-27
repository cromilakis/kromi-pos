# Diseño — Stock: productos críticos + carga masiva

**Fecha:** 2026-06-27
**Pantalla:** Stock (`screen === 'stock'`) + indicador en Inicio
**Objetivo:** Tres funcionalidades sobre Stock: (1) marcar productos como **críticos** y verlos en un panel, (2) **exportar** los críticos con poca disponibilidad a CSV para pedir reposición, (3) **cargar stock masivamente** desde un archivo CSV/JSON sumando al stock actual.

## Contexto

- `src/index.html`, frontend estático autocontenido (React vendorizado, inline styles, sin libs).
- Ya existe `product.minStock` (mínimo por producto) y el bloque "Stock bajo" del Inicio basado en él.
- El `stockCard` (~2140) calcula "stock bajo" con un `<= 5` hardcodeado, **inconsistente** con `minStock`. Se reconcilia en este trabajo.
- Producto: `{ id, name, cat, price, stock, minStock, img }`. Form `prodForm` con add/edit (`openAddProduct`/`openEditProduct`/`saveProduct`).
- `barcodeOf(id)` genera un código de barras determinístico por producto.

## A) Propiedad `critical` (check manual)

- Nuevo booleano **`product.critical`** (default `false`): marca un producto como **esencial** (no puede faltar). Independiente de `minStock`.
- **Checkbox "Producto crítico (esencial)"** en el formulario de agregar/editar (`prodForm.critical`).
- Se siembran varios productos críticos en el mock (mezcla de bajos y OK) para una demo representativa.
- **Reconciliación:** `stockCard` pasa a calcular `low = stock > 0 && stock <= minStock` (en vez de `<= 5`).
- Indicador visual: tag sutil "Crítico" en las tarjetas de productos marcados.

## B) Panel de stock crítico (pantalla Stock, solo admin)

- **Items críticos con poca disponibilidad** = `critical && (stock === 0 || stock <= minStock)`, ordenados por faltante (`minStock - stock`) descendente.
- **Banner** (solo si hay ≥1 y `isAdmin`): *"⚠ Hay N productos críticos con poca disponibilidad"*. Clic → **despliega/colapsa** el panel (estado `stockCriticalOpen`).
- **Panel**: lista con nombre, categoría, stock actual vs mínimo, faltante.
- **Botón "Exportar CSV"** en el panel → descarga `stock-critico-AAAA-MM-DD.csv`.
  - Columnas: `codigo,nombre,categoria,stock_actual,minimo,faltante`.
  - Mecanismo: `Blob` + `URL.createObjectURL` + ancla de descarga (sin Rust).
- Si no hay críticos bajos, el banner no aparece.

## C) Indicador en Inicio (admin)

- Se **mantiene** el bloque "Stock bajo" (basado en `minStock`).
- Encima, **alerta destacada** (cuando hay críticos bajos y `isAdmin`): *"⚠ N productos críticos requieren reposición"*, con botón/link "Ir a Stock".

## D) Carga masiva de stock por archivo

- **Botón "Cargar stock"** en la toolbar de Stock (junto a "Nuevo producto", solo admin).
- `<input type="file" accept=".csv,.json">` oculto, disparado por el botón; lectura con `FileReader.readAsText` (funciona en el webview de Tauri, sin Rust).
- **Match por código de barras** (`barcodeOf(id)`).
- **Formatos** (detectados por extensión):
  - **CSV**: columnas `codigo,cantidad` (con o sin fila de encabezado; el encabezado se detecta si la 2ª columna no es numérica).
  - **JSON**: array `[{ "codigo": "750...", "cantidad": 3 }, ...]` (alias aceptados: `barcode`/`code`, `qty`/`cantidad`).
- **Previsualización + confirmación** (modal `stockImport`):
  - Filas reconocidas: `producto: actual → +cantidad = nuevo` (se agregan cantidades repetidas del mismo código).
  - Filas no reconocidas: lista de códigos no encontrados (se ignoran).
  - Botones "Confirmar carga" / "Cancelar". Recién al confirmar se aplica.
- **Semántica: suma** al stock actual (2 + 3 = 5). No crea productos nuevos.
- Errores: archivo vacío/ilegible/JSON inválido → mensaje claro, no se aplica nada.

## Archivos de ejemplo (para pruebas)

Se generan `samples/carga-stock-ejemplo.csv` y `samples/carga-stock-ejemplo.json` con códigos reales (vía `barcodeOf`) para probar la carga de inmediato.

## Estado / handlers nuevos

- Estado: `prodForm.critical`, `stockCriticalOpen` (bool), `stockImport` (objeto preview | null).
- Handlers: `toggleProdCritical`, `toggleStockCritical`, `exportCriticalCsv`, `pickStockFile` (dispara input), `onStockFile` (parsea → preview), `confirmStockImport`, `cancelStockImport`.

## Restricciones / fuera de alcance

- Sin dependencias nuevas; parser CSV/JSON propio y simple.
- Persistencia en memoria (Postgres en etapa posterior).
- No se crean productos desde el archivo; códigos desconocidos se informan.
- Sin diálogo nativo de guardado de Tauri (descarga vía Blob); se puede sumar después.

## Criterios de aceptación

1. Agregar/editar un producto permite marcarlo **crítico**; persiste y se ve un indicador en la tarjeta.
2. En Stock (admin), si hay críticos con stock ≤ mínimo o agotados, aparece el banner; al clic se ve el panel con esos items.
3. "Exportar CSV" descarga un archivo con los críticos bajos y sus columnas.
4. En Inicio (admin), una alerta indica cuántos críticos requieren reposición, con acceso a Stock.
5. "Cargar stock" con un CSV/JSON válido muestra la previsualización; al confirmar, el stock de cada producto reconocido **aumenta** en la cantidad del archivo; los códigos desconocidos se reportan y se ignoran.
6. `stockCard` marca "Stock bajo" según `minStock` (no `<= 5`).
