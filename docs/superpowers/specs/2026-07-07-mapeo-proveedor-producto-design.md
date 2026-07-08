# Mapeo proveedor↔producto + panel compacto — Diseño

**Fecha:** 2026-07-07
**Rama:** `feature/recepcion-facturas` (extiende el sub-proyecto de recepción de compras por factura)
**Contexto previo:** `2026-07-07-recepcion-compras-factura-design.md`

## Objetivo

Enriquecer el flujo de recepción de factura para que: (1) el proveedor tenga un **ID interno correlativo** por negocio; (2) cada producto tenga un **código interno único** derivado de `{ID proveedor}-{código del proveedor}`; (3) el panel de proveedor y las líneas se autocompleten desde la factura y se muestren de forma **compacta** (tabla).

El modelo de compartir un mismo producto entre varios proveedores (cada uno con su propio código de proveedor, sumando al mismo stock) **ya existe** vía `supplier_product` y no cambia.

## Decisiones fijadas (con el usuario)

- **ID interno del proveedor**: correlativo numérico automático por negocio, mostrado con ceros a la izquierda (`001`, `002`, …). Sin intervención del usuario.
- **Código interno del producto**: auto-generado y **fijo** (no editable), con formato `{seq proveedor con 3 dígitos}-{código del proveedor}` → ej. `001-ABC123`.
- **Productos existentes**: no hay productos en la base todavía; todos los productos generarán código. **Sin backfill.**

## 1. Datos (migración nueva)

Archivo nuevo: `supabase/migrations/20260707140000_supplier_product_codes.sql`.

### Cambios de esquema

```sql
alter table public.supplier add column seq int;
create unique index uq_supplier_seq on public.supplier(business_id, seq) where seq is not null;

alter table public.product add column internal_code text;
create unique index uq_product_internal_code on public.product(business_id, internal_code) where internal_code is not null;
```

- `supplier.seq`: correlativo por negocio. Nullable (proveedores creados por otras vías podrían no tenerlo aún), pero la RPC de recepción siempre lo asigna al crear un proveedor.
- `product.internal_code`: código interno único por negocio. Nullable; se genera al crear productos vía recepción.

### RPC `recepcionar_factura` (modificación)

La RPC vive en `supabase/migrations/20260707130000_purchases.sql`. La migración nueva la reemplaza con `create or replace function` (misma firma, mismo `security definer set search_path=''`).

Cambios:

1. **Al crear proveedor nuevo**: asignar `seq` correlativo de forma atómica dentro de la transacción:
   ```sql
   -- dentro del bloque de creación de proveedor
   select coalesce(max(seq), 0) + 1 into v_seq
     from public.supplier where business_id = v_business;
   insert into public.supplier (business_id, seq, razon_social, rut, giro, email, phone, address)
     values (v_business, v_seq, ...);
   ```
   La RPC corre en una sola transacción; el `insert` con `unique(business_id, seq)` protege ante duplicados. Si el proveedor ya existe (`p_supplier->>'id'` presente), se lee su `seq`; si ese `seq` fuese `null` (proveedor creado por otra vía antes de esta migración), se le asigna el próximo correlativo con `update` antes de continuar, de modo que `v_seq` nunca sea `null` al generar códigos.

2. **Al crear producto nuevo**: generar `internal_code`:
   ```sql
   v_code := lpad(v_seq::text, 3, '0') || '-' ||
             coalesce(nullif(ln->>'supplier_code',''), v_line_idx::text);
   insert into public.product (business_id, name, category_id, price, supplier_id, internal_code)
     values (v_business, ..., v_code);
   ```
   Donde `v_seq` es el correlativo del proveedor de esta factura y `v_line_idx` es un contador de línea de respaldo cuando el código del proveedor viene vacío (evita colisión `001-` repetido).

3. La RPC sigue devolviendo `public.purchase_invoice` (sin cambios de firma).

### Multi-proveedor sobre el mismo producto

Sin cambios de esquema. Cuando un segundo proveedor trae un producto ya existente, el usuario lo enlaza al producto existente (elige en la UI): se inserta/actualiza la fila `supplier_product` (su `supplier_code` → `product_id`), el stock suma, y el `internal_code` del producto **no cambia** (lo fijó el primer proveedor). El auto-mapeo posterior recuerda ese `supplier_code`.

## 2. Extracción (edge function + `invoice.ts`)

### `supabase/functions/extract-invoice/index.ts`

Ampliar el `schema` de structured outputs para el objeto `proveedor`:

```
proveedor: { razon_social, rut, giro, direccion }
```

- `giro` y `direccion`: `string` (pueden venir vacíos si la factura no los trae; el modelo devuelve "" en ese caso). Ajustar `required` para incluirlos (strict mode exige listarlos) y aclarar en el prompt que son del **emisor/proveedor**, no del receptor.
- El folio (número de factura electrónica) ya se extrae en `documento.folio`; sin cambios.

### `src/lib/invoice.ts`

- Extender el tipo `Extraction.proveedor` con `giro?: string` y `direccion?: string`.
- `normalizeExtraction`: normalizar los nuevos campos (trim, default `""`).
- Tests en `invoice.test.ts`: cubrir que `normalizeExtraction` preserva/normaliza `giro` y `direccion`.

## 3. UI de confirmación (`src/modules/stock/InvoiceConfirm.tsx`)

### Panel de proveedor compacto

- **Proveedor existente**: chip/fila compacta con su ID interno (`001`), razón social, RUT, giro y dirección (solo lectura).
- **Proveedor nuevo**: grilla compacta de inputs prellenados desde la extracción — razón social, RUT, giro, **dirección** (campo nuevo en el formulario), email, teléfono. El `address` ya lo acepta la RPC; hoy el formulario no lo envía → agregarlo al `p_supplier`.

### Líneas en tabla compacta

Reemplazar las tarjetas por una **tabla** de filas densas con encabezado:

| Cant | Cód. prov | Descripción | Costo unit | Total | Producto interno |
|------|-----------|-------------|-----------|-------|------------------|

- **Producto interno** (última columna): 
  - Auto-mapeado → muestra el `internal_code` + nombre del producto vinculado, con opción "Cambiar".
  - Sin resolver → selector "Elegir producto existente…" (muestra `internal_code` + nombre) o botón "+ Crear nuevo".
  - Crear nuevo → input de nombre + categoría, y **preview no editable** del código que se generará (`{seq}-{cód. prov}`). El `seq` del proveedor se conoce: si existe, de su registro; si es nuevo, es el próximo correlativo (se puede mostrar como "(nuevo)" o calcular con un hook que lea `max(seq)+1`).
- Marcas de verificación de montos (línea en rojo si `qty × unit_cost ≠ line_total`) se conservan, adaptadas a la fila de tabla.
- Filas con overflow horizontal contenido (la tabla scrollea dentro de su contenedor si no cabe).

### Datos auxiliares

- `useProductsWithStock` (en `src/data/stock.ts`) debe exponer `internal_code` para mostrarlo en el selector y en el chip de auto-mapeo. Verificar el `select` y el tipo.
- Para el preview del código de un proveedor nuevo se necesita el próximo `seq`: hook `useNextSupplierSeq(businessId)` que consulte `max(seq)+1` del negocio (solo lectura, informativo; la asignación real la hace la RPC atómicamente).

## 4. Sin backfill

No hay productos existentes en la base; la migración solo agrega columnas e índices. No se escribe data.

## Manejo de errores

- Unicidad de `internal_code`: si por concurrencia dos recepciones generasen el mismo código, el `unique` aborta la transacción de la RPC (atómica) → el cliente muestra el error y el usuario reintenta. Escenario muy improbable en un POS de un negocio.
- Campos de proveedor vacíos en la factura (`giro`/`direccion` = ""): se guardan como `null` (la UI/normalización convierte "" → null antes de enviar).
- Línea sin código de proveedor: el `internal_code` usa el índice de línea como respaldo (`{seq}-{idx}`), evitando colisión.

## Testing

- **BD** (`supabase/tests/purchases_test.sql` o nuevo): recepción con proveedor nuevo asigna `seq=1` y genera `internal_code` `001-<código>`; segunda recepción de otro proveedor asigna `seq=2`; enlazar producto existente desde un segundo proveedor no cambia su `internal_code` y suma stock; código de proveedor vacío no colisiona.
- **Lógica** (`src/lib/invoice.test.ts`): `normalizeExtraction` con `giro`/`direccion`.
- **typecheck + test + build** verdes al final.

## Restricciones (heredadas)

- Identidad de commits: solo `Cromilakis <ipcromilakis@gmail.com>`. Sin co-author ni atribución a Claude.
- `OPENAI_API_KEY` y secretos nunca en cliente ni `VITE_`; solo secret de edge function.
- Escritura de tablas críticas solo vía RPC. `product`/`supplier` no las escribe el cliente directamente en este flujo (van por la RPC).
- Nunca `git add -A`; no tocar `src-tauri/*`. Marca vía `var(--brand)`.
