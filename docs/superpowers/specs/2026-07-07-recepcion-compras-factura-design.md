# Diseño — Recepción de compras por factura (carga de stock)

**Proyecto:** kromi-pos
**Fecha:** 2026-07-07
**Sub-proyecto:** independiente (feature nueva, no estaba en el prototipo). Se apoya en ①, ②, ③a.
**Estado:** aprobado en brainstorming; pendiente de plan.

---

## 1. Contexto y objetivo

Hoy la carga de stock es manual (Stock: CRUD + CSV). Esta feature permite **subir una factura de compra (PDF)**, extraer sus datos con IA de visión, revisarlos en una **pantalla de confirmación** y, al confirmar, **sumar stock de forma masiva**, creando el proveedor y los productos que falten, guardando el **historial de costos** y **archivando la factura** para descargarla después.

Referencia real usada en el diseño: factura electrónica de FLORITERRA LIMITADA (RUT 78.964.380-6) a SAN JOSE SPA, 24 líneas `cantidad · código · descripción · valor unitario · total`, neto/iva/total.

## 2. Decisiones fijadas (del brainstorming)

| Tema | Decisión |
|---|---|
| Formato de entrada | **PDF** por ahora; arquitectura extensible a imágenes/XML (la visión ya cubre imágenes) |
| Extracción | **IA de visión OpenAI**, modelo **`gpt-5-nano`** (alias → última nano de GPT-5), *structured output* (JSON schema) |
| Dónde corre la IA | **Edge function** (servidor); `OPENAI_API_KEY` como **secret de la función**, nunca en el cliente |
| Costo vs precio | La carga **suma stock** y **guarda el costo** (historial por producto+proveedor+fecha, para variación de precios). El **precio de venta NO se toca** (margen/precios dinámicos = módulo futuro de analítica) |
| Mapeo de productos | **Recordar el código del proveedor** (`supplier_product`): auto-mapeo en compras recurrentes; la primera vez se mapea/crea |
| Proveedor | Identificar por **RUT**; si no existe, marcar "nuevo" y crearlo al confirmar |
| Archivo | El PDF se guarda en **Supabase Storage** (bucket privado por negocio), asociado a la factura/proveedor, **descargable** |
| Confirmación | La IA **solo sugiere**; la carga real **siempre** requiere confirmación/edición del usuario |
| Acceso | Desde el módulo **Stock** (botón "Cargar desde factura") |

## 3. Flujo

1. En **Stock**, "Cargar desde factura" → el usuario selecciona el **PDF**.
2. El cliente envía el PDF a la edge function `extract-invoice`. La función:
   a. Sube el PDF a **Storage** (bucket `purchase-invoices`, ruta por negocio).
   b. Envía el documento a **OpenAI `gpt-5-nano`** (visión) con *structured output* (JSON schema del §5) → obtiene `{ proveedor, documento, lineas }`.
   c. Devuelve al cliente el JSON extraído **más** el `pdf_path` en Storage.
3. **Pantalla de confirmación** (frontend):
   - **Proveedor**: se busca en `supplier` por RUT normalizado. Si existe → se muestra vinculado. Si no → bloque "**Nuevo proveedor**" con los datos extraídos (editables) que se creará al confirmar.
   - **Líneas**: para cada una, auto-mapeo vía `supplier_product (supplier_id, supplier_code)` → `product_id`. Estados por línea:
     - *Mapeada*: muestra el producto del catálogo vinculado.
     - *Sin mapear*: el usuario elige un producto existente **o** marca "crear producto nuevo" (nombre = descripción; categoría; precio de venta se define después, no aquí).
   - Muestra `cantidad · código · descripción · costo unitario · total` y los totales de la factura (neto/iva/total) para cuadrar.
4. **Confirmar** → RPC atómica `recepcionar_factura` (una transacción):
   - Crea el proveedor si es nuevo.
   - Crea los productos nuevos marcados.
   - Upsert de `supplier_product` (código → producto, `last_cost`) para recordar el mapeo.
   - Inserta `purchase_invoice` (+ `purchase_invoice_line` por línea) con el **costo unitario** → historial.
   - **Suma stock**: `inventory[product, branch] += cantidad` por línea (sucursal activa).
5. El PDF queda archivado; se puede **descargar** después desde Proveedores / un listado de facturas de compra (Storage signed URL).

## 4. Modelo de datos (nuevo)

Todas con `business_id` + RLS por negocio, PK uuid, `created_at`.

- **`supplier_product`**: `business_id, supplier_id→supplier, supplier_code text, product_id→product, last_cost int, updated_at`. `UNIQUE(supplier_id, supplier_code)`. Habilita auto-mapeo y guarda el último costo por (proveedor, código).
- **`purchase_invoice`**: `id, business_id, supplier_id→supplier, branch_id→branch, doc_type text, folio text, issued_at date, neto int, iva int, total int, pdf_path text, created_by→app_user, created_at`. `UNIQUE(business_id, supplier_id, folio)` (evita cargar dos veces la misma factura).
- **`purchase_invoice_line`**: `id, invoice_id→purchase_invoice (cascade), product_id→product null, supplier_code text, description text, qty int, unit_cost int, line_total int`. Es el **historial de costos** (consulta: costo de un producto a lo largo del tiempo).
- **Storage**: bucket privado `purchase-invoices`, objetos bajo `{business_id}/{invoice_id}.pdf`, con políticas de acceso por negocio.

## 5. Extracción con IA (edge function `extract-invoice`)

- **Entrada**: el PDF (multipart o base64) + contexto (business_id del token).
- **Modelo**: OpenAI `gpt-5-nano` (visión). Se pasa el documento como input de archivo/imagen a la API (Responses API con `input_file`/imagen). *Structured Output* con `response_format: { type: "json_schema", ... }` para forzar el JSON.
- **Esquema de salida** (JSON):
  ```
  {
    proveedor: { razon_social: string, rut: string },
    documento: { tipo: string, folio: string, fecha: string /*ISO*/, neto: number, iva: number, total: number },
    lineas: [ { supplier_code: string, description: string, qty: number, unit_cost: number, line_total: number } ]
  }
  ```
- **Secret**: `OPENAI_API_KEY` como secret de la edge function (Supabase). NUNCA en el cliente ni en variables `VITE_*`.
- **Errores**: PDF ilegible / sin contenido → error claro; timeout o fallo de OpenAI → error; JSON que no valida el schema → se reporta para revisión manual. La extracción es una **sugerencia**: el usuario confirma/edita siempre.
- **Verificación de montos**: en la confirmación se contrasta `Σ(qty·unit_cost)` contra el `total`/`neto` extraído y se avisa si no cuadra (la IA pudo equivocarse en una cifra).

## 6. Seguridad

- La `OPENAI_API_KEY` vive solo en el servidor (secret de la edge function). El cliente nunca la ve.
- Tablas nuevas con RLS por negocio; el bucket de Storage con acceso por negocio (descarga vía signed URL emitida por el servidor/políticas).
- La carga de stock (crear proveedor/productos, sumar inventario, registrar factura) va por **RPC atómica** `recepcionar_factura` (coherente con el modelo de ①: nada crítico se escribe suelto desde el cliente sin validación). La RPC valida tenancy.
- El costo se guarda; el precio de venta no se altera.

## 7. Alcance

**Incluye:** botón en Stock, subida de PDF, edge function de extracción (OpenAI visión), pantalla de confirmación (proveedor nuevo por RUT, auto-mapeo por código, crear productos), RPC de recepción (crea/mapea/registra/suma stock), archivado y descarga del PDF, verificación de montos.

**Fuera de alcance (futuro):** XML del DTE, OCR dedicado; calculadora de margen / precios dinámicos (módulo de analítica futuro); reportes de variación de costos (el dato queda guardado, el reporte llega después); edición de facturas ya cargadas (por ahora solo cargar y descargar).

## 8. Testing y verificación

- **Unit**: validación/normalización del JSON de extracción (fixture: la factura de Floriterra), lógica de auto-mapeo (`supplier_product`), verificación de montos (`Σ qty·unit_cost` vs total), normalización de RUT del proveedor.
- **Edge function**: prueba con la factura real de Floriterra (llamada controlada a OpenAI o mock del cliente OpenAI) → JSON esperado.
- **RPC `recepcionar_factura`**: pgTAP/psql — crea proveedor+productos+mapeos, inserta invoice+líneas, suma inventory; atómica (revierte ante fallo); no duplica factura (unique folio).
- **En vivo**: subir la factura de Floriterra → confirmar (proveedor nuevo Floriterra, mapear/crear productos) → ver stock sumado en la sucursal, factura archivada y descargable, y una segunda carga del mismo proveedor auto-mapeando por código.

## 9. Orden y dependencias

Depende de ③a (Stock, `product`, `inventory`) y de ① (`supplier`, RLS, RPC). Sugerido implementarlo **después de mergear ③a**. Es independiente de ③b (Administración).
