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

### 3. DTE — `issue-receipt/index.ts` (fix del reparo SII)

**Evidencia (cuenta demo, ambiente 0):** el `DscRcgGlobal` en una boleta con
montos brutos genera **siempre** el reparo `Monto Total No Cuadra con Parciales`,
tanto en **monto ($)** (folio 6371) como en **porcentaje (%)** (folio 6385). La
única estructura **Aceptada limpia** es **distribuir el descuento en las líneas**
(folio 6373). El SII no reconcilia un descuento global en boleta bruta.

Cambio: **eliminar `DscRcgGlobal`** y **prorratear el descuento global entre las
líneas** del `Detalle`, de modo que `Σ MontoItem = MntTotal` (cuadratura trivial).

- El descuento global a distribuir es `sale.discount_amount` (incluye canje o
  comercial; los descuentos por línea ya viven en `sale_line.discount_amount`).
- Base de prorrateo por línea: `base_i = price*qty − line_discount_i`.
- `extra_i = round(global × base_i / Σ base)`; el **remanente** de redondeo se
  ajusta en la última línea para que `Σ extra_i = global` exacto.
- Cada línea: `DescuentoMonto = line_discount_i + extra_i`,
  `MontoItem = price*qty − DescuentoMonto`.
- Resultado boleta: `Σ MontoItem = v_bruto − global = sale.total`; `MntNeto`/`IVA`/
  `MntTotal` siguen derivándose de `sale` (ya descontados). Se quita el bloque
  `DscRcgGlobal`.
- Factura (33): mismo prorrateo pero en **neto** (los importes se llevan a neto
  con `/1.19`), aplicado sobre el descuento global neto; se elimina igualmente el
  `DscRcgGlobal`. (El reparo se confirmó en boletas; se unifica el criterio para
  no arrastrar el `DscRcgGlobal` en ningún tipo.)

Nota: este cambio es **solo** del cuerpo del DTE que va al SII. **No afecta** la
boleta impresa, que sigue mostrando el "Descuento global" como línea de totales
(§2), porque el ticket se arma desde el payload (`sale` + líneas), no desde el
DTE.

### 4. Logo / header

- Regenerar `src-tauri/assets/logo.escpos` a ~mitad de tamaño (ancho objetivo
  ~180 px, alto proporcional → ~¼ de los bytes), manteniendo el prefijo
  `ESC a 1` (centrar) y sufijo `ESC a 0`, y el formato `GS v 0` por bandas.
- Añadir un script generador en `scripts/` (p. ej. `gen_logo_escpos.mjs`) que
  tome `public/logo.png` (JPEG 875×875), escale al ancho objetivo, convierta a
  monocromo (umbral o dithering Floyd–Steinberg) y emita el `logo.escpos`. Queda
  versionado para regenerar el asset a futuro.
- Header sigue centrado con los datos del negocio como texto (sin cambios).

### 5. Testing / verificación

**Boleta impresa (§2) + payloads (§1):**
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

**DTE (§3) — sin tocar producción:**
- Test unitario/determinista del armado del body de `issue-receipt`: `Σ MontoItem
  = MntTotal`, sin `DscRcgGlobal`, y el prorrateo cuadra al peso (incl. remanente
  en la última línea) para 1 línea, N líneas, y descuento que no divide exacto.
- Validación end-to-end contra la **cuenta demo (ambiente 0)**: script aparte que
  arme el body idéntico al de `issue-receipt` (con el fix) y lo emita en demo →
  confirmar estado **Aceptado** (sin reparo), como se hizo con folio 6373.
- ⚠️ **NO** repuntar los secrets de la Edge Function productiva a la demo. La
  validación va con un script independiente; la función productiva queda intacta.
- `/dte/preview` **no** sirve para esto (es más permisivo y no detecta el reparo
  de cuadratura, que solo aparece tras emisión real al SII).
- Producción: la estructura ya está confirmada en demo. Un "canary" opcional
  tras desplegar (una venta real chica con descuento, corregible con NC) queda a
  criterio del usuario, no es parte obligatoria del plan.

## Fuera de alcance

- Header compuesto (logo izq + datos der).
- Visualización de descuentos en la pantalla de Venta (carrito on-screen); el
  reporte es sobre la boleta impresa.

## Restricción operativa

La app está en **producción**. El cambio §3 modifica el **cuerpo del DTE** que
arma `issue-receipt`, pero **no** se emiten DTE reales para probar: toda emisión
de validación va contra la **cuenta demo (ambiente 0)** con un script aparte,
dejando la Edge Function productiva intacta. No se cambia `SIMPLEFACTURA_AMBIENTE`
ni se emite en producción para testear. Ver memoria `produccion-no-emitir-dte`.
