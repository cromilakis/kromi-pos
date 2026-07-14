# Productos tipo "servicio" (sin stock) — Diseño

**Fecha:** 2026-07-14
**Rama:** feature/notas-credito (rama de trabajo actual)

## Objetivo

Permitir vender **servicios**: productos a pedido del cliente que **no tienen stock**
(p. ej. "Visita domiciliaria" a $20.000). Deben poder crearse y editarse desde la
gestión de productos (Stock) igual que un producto normal, pero **sin configuración
de stock**, y venderse siempre (disponibilidad ilimitada).

## Contexto del modelo actual

- `product` no tiene tipo. El stock vive en `inventory` (por sucursal, PK
  `product_id + branch_id`).
- La RPC `_register_sale` (migración `20260714130000_rename_functions_english.sql`)
  **exige** para toda línea una fila en `inventory` con `stock >= qty`
  (líneas 88-92) y luego descuenta (`update inventory ... stock - qty`, 130-132).
  Una línea sin inventario lanza "stock insuficiente".
- `charge_sale` (migración `20260714150000_charge_sale_discount_id.sql`) arma las
  líneas con precio/descuento y delega el registro en `_register_sale`.
- Frontend: `data/stock.ts` (`ProductRow`, `useProductsWithStock`, `createProduct`,
  `updateProduct`, `upsertInventory`), `ProductForm.tsx` (siempre pide stock),
  `StockScreen.tsx` (muestra stock, ajuste +/-, alerta crítico), `VentaScreen.tsx`
  (valida disponibilidad = `stock - inCart`, bloquea "Sin stock").

## Decisión de modelado

Bandera explícita **`product.is_service boolean not null default false`**.
Semántica clara ("es un servicio"), fácil de mostrar como "Servicio" en la UI.
Los servicios **nunca** crean fila en `inventory` ni descuentan stock.
(Descartado: usar ausencia de fila de inventory o stock 0 — ambiguo y frágil.)

## Cambios por capa

### 1. Base de datos (nueva migración `YYYYMMDDHHMMSS_product_service.sql`)

- `alter table public.product add column is_service boolean not null default false;`
- Recrear `_register_sale` para que, cuando la línea corresponda a un producto con
  `is_service = true`:
  - **Salte** la validación `stock >= qty`.
  - **Salte** el `update inventory`.
  - La `sale_line` se inserta igual (name/price snapshot, qty, descuento). El
    servicio participa del bruto, total, IVA, puntos y descuentos como cualquier
    línea.
- Respetar la firma vigente de la cadena `charge_sale` → `_register_sale` (con
  `p_discount_id`). No cambia la firma de `charge_sale`.
- Los servicios se detectan con un `join`/lookup a `product.is_service` dentro del
  loop de `_register_sale`.

### 2. Capa de datos (`src/data/stock.ts`)

- `ProductRow`: agregar `is_service: boolean`.
- `useProductsWithStock`: incluir `is_service` en el `select`. Para servicios
  `stock` = 0 (no se usa en la UI de servicio).
- `createProduct` / `updateProduct`: aceptar `is_service`.

### 3. Formulario de producto (`src/modules/stock/ProductForm.tsx`)

- Toggle **"Es un servicio (a pedido, sin stock)"**.
- Al activarlo: ocultar/deshabilitar **Stock**, **Stock mínimo** y **Producto
  crítico**. Precio, categoría, proveedor, descuento, código de barras e imagen
  siguen disponibles.
- Al guardar: si `is_service`, **no** llamar `upsertInventory`.

### 4. Pantalla de stock (`src/modules/stock/StockScreen.tsx`)

- En tabla y bloques, mostrar etiqueta **"Servicio"** en la columna de stock.
- Deshabilitar botones de ajuste `+/-` (`adjustStock`) para servicios.
- Excluir servicios de la alerta de "stock crítico" y del CSV crítico
  (`isLowStock` debe devolver `false` para servicios).

### 5. Pantalla de venta (`src/modules/venta/VentaScreen.tsx`)

- Servicios: disponibilidad **ilimitada** → `available` efectivamente infinito;
  nunca "Sin stock"; el botón `+` no se topa; no se ajustan por stock al
  restaurar carrito.
- En la tarjeta del producto, mostrar **"Servicio"** en lugar de "N disp.".

### 6. Dato de ejemplo

- Crear el servicio **"Visita domiciliaria" — $20.000** como dato real del negocio
  (vía la app una vez implementada la capacidad).

## Tests

- `src/data/stock.test.ts`: `mapProductsWithStock` no rompe con servicios;
  `is_service` se propaga.
- `pnpm test:db`: venta con línea de servicio **no** valida ni descuenta
  inventario, pero suma al total; venta mixta (producto + servicio) descuenta solo
  el producto.

## Fuera de alcance (YAGNI)

- Cotizaciones y notas de crédito: los servicios se comportan igual (no reponen
  stock porque no lo tienen). No se agrega UI especial.
- Sección separada de "servicios" en la venta: van en la grilla común con badge
  "Servicio".

## Criterios de aceptación

1. Se puede crear/editar un producto marcándolo como servicio, sin pedir stock.
2. Un servicio aparece como "Servicio" en Stock (tabla y bloques) sin controles de
   ajuste de stock.
3. Un servicio se puede agregar a la venta sin límite y cobrar; la venta se registra
   con la línea del servicio y su monto, sin tocar `inventory`.
4. Una venta mixta descuenta stock solo de los productos físicos.
5. Existe "Visita domiciliaria" ($20.000) como servicio vendible.
