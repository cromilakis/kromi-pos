# Diseño — Visualización de descuentos en la boleta + logo/header

Fecha: 2026-07-18
Estado: aprobado (pendiente de plan de implementación)

## Problema

1. **Descuentos no visibles en la boleta impresa.** Cuando la venta tiene un
   descuento **global** (comercial o canje de puntos), el total impreso sale
   rebajado pero **sin una línea que lo explique**: el cliente ve un ítem a
   $17.990 y un TOTAL de $16.191 sin saber por qué. Causa raíz: los tres puntos
   que arman el payload de impresión calculan `descuento` sumando **solo los
   descuentos por línea** y **omiten** el descuento global (`discount_amount`).
   Además, el bloque de totales de `escpos.rs` ubica la línea de descuento entre
   "Neto" e "IVA", lo que no cuadra aritméticamente (el Neto ya está
   post-descuento).

2. **Logo se corta tras varias impresiones.** El `logo.escpos` es un raster de
   ~320×300 px (12.5 KB), centrado. Esa altura, reimpresa muchas veces, satura
   el buffer/cabezal térmico y el logo empieza a salir cortado; se resuelve
   reiniciando la impresora.

## Decisiones (confirmadas con el usuario)

- **Descuentos por producto** → se muestran en cada línea de producto (como hoy).
- **Descuento global** (comercial o canje) → se muestra **solo** en la sección
  de totales. Ya **no** se suman los descuentos por línea en los totales (elimina
  el doble conteo actual).
- Canje de puntos y descuento comercial son **mutuamente excluyentes**
  (lo valida `charge_sale`), por lo que en totales aparece **como máximo una**
  línea de descuento global.
- **Logo:** reducir el raster (~mitad) manteniéndolo **centrado**, con los datos
  del negocio como texto debajo (sin cambio de layout del header). No se adopta
  el header compuesto logo-izquierda/datos-derecha (requeriría renderizar el
  texto como imagen; descartado por costo/nitidez).

## Layout de totales (aprobado)

Caso completo (un producto con dcto de línea + descuento global):

```
Item                            Subtotal
========================================
Suculenta grande                 $10.000
   2 x $5.000
   Descuento 10%                  -$1.000
Marantha                          $8.990
   1 x $8.990
========================================
Subtotal                         $17.990
Descuento global 10%             -$1.799
----------------------------------------
Neto                             $13.606
IVA 19%                           $2.585

        TOTAL            $16.191
```

- `Subtotal` = Σ(precio×qty − descuento_línea) sobre los ítems.
- Reconciliación: `Subtotal − Descuento global − Canje = TOTAL = Neto + IVA`.
- Si hay canje en vez de descuento comercial, la línea dice
  `Canje de puntos (N pts)   -$X`.
- **Sin descuentos** (línea, global ni canje): el ticket queda **igual que hoy**
  (Neto / IVA / TOTAL, sin línea "Subtotal").

## Cambios

### 1. Datos — armadores de payload

El campo `descuento` del payload pasa a significar **descuento global comercial**
(no la suma de líneas). En cada sitio:

- `descuento` = `discount_amount − points_discount`
- `canje_monto` = `points_discount`
- `items[].descuento` = descuento por línea (se mantiene)

Sitios:
- `src/modules/historial/HistorialScreen.tsx:153` — `SaleHistoryRow` ya trae
  `discount_amount` y `points_discount`.
- `src/modules/venta/VentaScreen.tsx:353` — reimpresión (`SaleDteRow`).
- `src/modules/venta/VentaScreen.tsx:443` — venta en vivo (usa `sale`, que ya
  expone `discount_amount`/`points_discount`).
- `src/data/sales.ts` — agregar `discount_amount` al tipo **`SaleDteRow`** (int)
  y a su `select(...)` (línea ~59), para que la reimpresión de "Boletas del día"
  tenga el dato.

Nota: `discount_amount` es puramente el descuento **global** (en la RPC,
`p_total_disc`); los descuentos por línea viven en `sale_line.discount_amount`,
así que no hay riesgo de doble conteo entre ambos.

### 2. Render — `src-tauri/src/escpos.rs`

`build()` (boleta/factura):
- Mantener los descuentos por línea bajo cada producto.
- Reemplazar el bloque de totales actual (que hace
  `line_lr("Total descuentos", p.descuento)` entre Neto e IVA) por:
  - Si hay **algún** descuento (Σ dctos de línea > 0, o `p.descuento` > 0, o
    `p.canje_monto` > 0): imprimir `Subtotal` = Σ(precio×qty − descuento_línea).
  - Si `p.descuento` > 0: `Descuento global N%` con `-$monto`
    (N% = round(descuento×100 / Subtotal)).
  - Si `p.canje_monto` > 0: `Canje de puntos (N pts)` con `-$monto`.
  - Regla `-`, luego `Neto`, `IVA 19%`, y el `TOTAL` en doble tamaño (como hoy).
- Sin descuentos: no imprimir `Subtotal` ni líneas de descuento (comportamiento
  actual intacto).

`build_quote()` (cotización): mismo bloque de totales (hoy sufre el mismo doble
conteo: `descuento` = Σ líneas + global). Se alinea a la nueva semántica.
`CotizacionesScreen.tsx` debe pasar `descuento` = solo el global de la cotización
(`quote.discount_amount`), no `Σ líneas + global`.

`build_credit_note()`: la NC no muestra descuentos (solo ítems) → sin cambios.

### 3. Logo / header

- Regenerar `src-tauri/assets/logo.escpos` a ~mitad de tamaño (ancho objetivo
  ~180 px, alto proporcional → ~¼ de los bytes), manteniendo el prefijo
  `ESC a 1` (centrar) y sufijo `ESC a 0`, y el formato `GS v 0` por bandas.
- Añadir un script generador en `scripts/` (p. ej. `gen_logo_escpos.mjs`) que
  tome `public/logo.png` (JPEG 875×875), escale al ancho objetivo, convierta a
  monocromo (umbral o dithering Floyd–Steinberg) y emita el `logo.escpos`. Queda
  versionado para regenerar el asset a futuro.
- Header sigue centrado con los datos del negocio como texto (sin cambios).

### 4. Testing / verificación

- Tests unitarios en `escpos.rs`:
  - Con descuento global: el output contiene `Subtotal` y `Descuento global`.
  - Con canje: contiene `Canje de puntos`.
  - Sin descuento: **no** contiene `Subtotal`.
  - No hay doble conteo (la línea de descuento global refleja solo el global).
- Frontend: los armadores son triviales; validar (test o revisión) que
  `descuento = discount_amount − points_discount`.
- Verificación visual: como no hay impresora disponible, generar un **render de
  vista previa** del ticket (dump del ESC/POS a texto/imagen) para validar el
  layout y el nuevo logo antes de cerrar.

## Fuera de alcance

- Header compuesto (logo izq + datos der).
- Cambios al reparo del SII por `DscRcgGlobal` en boletas (tema separado; en
  verificación aparte).
- Visualización de descuentos en la pantalla de Venta (carrito on-screen); el
  reporte es sobre la boleta impresa.

## Restricción operativa

La app está en **producción**. Todo el trabajo aquí es sobre la representación
impresa (ESC/POS) y armado de payload: **no** emite DTE ni toca el SII. Las
pruebas de emisión (si hicieran falta) van solo contra la cuenta demo
(ambiente 0). Ver memoria `produccion-no-emitir-dte`.
