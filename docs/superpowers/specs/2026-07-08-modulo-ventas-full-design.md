# Diseño — "Full" al módulo de ventas (POS)

**Fecha:** 2026-07-08
**Proyecto:** kromi-pos
**Estado:** aprobado (roadmap); pendiente plan de implementación

## Contexto

El módulo de ventas ya es funcional: catálogo por categorías, carrito, cobro
(efectivo/tarjeta), cliente asociado, cotizaciones, notas de crédito, cierre de
caja e impresión de boleta ESC/POS. Este roadmap lo lleva "a fondo" en cinco
frentes más un fix de layout, cada uno como sub-proyecto con su propio ciclo de
plan → implementación → verificación.

El trabajo se implementa en secuencia por dependencias técnicas, pero el diseño
completo se define aquí de una vez.

### Hechos del código actual (base para el diseño)

- **Precios con IVA incluido**: `computeTotals` calcula `neto = round(total/1.19)`,
  `iva = total - neto` (`src/lib/money.ts`). La RPC replica esto en servidor.
- **`sale`** (`supabase/migrations/20260707100100_operations.sql:47-65`): `method`
  es enum `sale_method('efectivo','tarjeta')` de **un solo valor**; **no** hay
  columnas de descuento. `sale_line` (67-75) guarda `name_snapshot`,
  `price_snapshot`, `category_snapshot`, `qty`; **sin** descuento ni nota.
- **`cobrar_venta`** (`...100200_functions.sql:250-297`) → `_registrar_venta`
  (140-243): fija el **precio en el servidor** (`product.price`), valida stock,
  calcula neto/iva/points, saca folio con `siguiente_folio(branch,'sale')`,
  inserta venta y líneas, baja `inventory`, fideliza cliente. Un solo método.
- **`business`** (`...100000_catalog.sql:42-59`) **ya tiene** `name`, `rut`,
  `giro`, `direccion`, `tagline`, `footer`, `social_red`, `social_url`, `accent`,
  `logo_url`, `login_cover_url`, `plan`, `admin_email`. No hay columna de impresora.
- **RLS**: `sale` es solo-lectura por negocio; se escribe únicamente vía RPC
  `SECURITY DEFINER`. `business` no tiene política de UPDATE hoy.
- La impresora se configura localmente (`src/lib/printerConfig.ts`, localStorage)
  vía `PrinterSettings` en el sidebar; se mantiene así (es por-equipo físico).

## Decisiones tomadas

- **Descuentos**: por línea **y** al total, en **porcentaje y monto**. Aplicables
  **solo por admin** (rol `admin`/`kromi`), validado en servidor. Quedan
  registrados en la venta.
- **Retener/recuperar venta**: persistidas en **base de datos** (recuperables
  desde cualquier caja).
- **Datos del negocio**: **leer + editar** desde la app (pantalla de ajustes en
  Administración). El logo y las imágenes de producto se **suben como archivo**
  (ver sub-proyecto 8; reemplaza la decisión inicial de "logo por URL").
- **Imágenes (producto y logo)**: se **suben como archivo** a Supabase Storage
  (bucket público), redimensionadas y comprimidas **en el cliente** a **WebP**
  (producto máx 200px, logo máx 400px del lado mayor) para evitar archivos pesados.
- **Experiencia de caja (modos de venta)**: en Venta se oculta el menú lateral;
  botones con icono; y un **modo lectura (pistola)** tipo supermercado (lista sin
  imágenes, cantidad-antes-de-marcar) además del **modo catálogo** manual.
- **Código de barras**: **campo `barcode` dedicado** en `product` (distinto de
  `internal_code`).
- **Atajos de teclado**: **ninguno por ahora**. El lector de código de barras
  actúa como teclado que escribe en la búsqueda.
- **Cotizaciones como módulo aparte**: cotizar **no** requiere caja abierta. Se
  extrae a su propia ruta/módulo. Crear/ver cotizaciones lo pueden hacer
  **cajero y admin**. La **conversión a venta ocurre desde el módulo Cotizaciones**
  y **exige caja abierta** en ese momento (porque cobra y baja stock).

## Orden de implementación

1. Fix layout del carrito (sub-proyecto 1)
2. Cotizaciones como módulo independiente (sub-proyecto 7) — limpia `VentaScreen`
   antes de tocar el carrito en descuentos/retener
3. Datos del negocio / boleta (sub-proyecto 2)
4. Código de barras (sub-proyecto 3)
5. Descuentos (sub-proyecto 4)
6. Retener / recuperar venta (sub-proyecto 5; depende del formato de carrito con descuentos)
7. Pulido UX transversal (sub-proyecto 6)

Cada sub-proyecto es entregable y verificable de forma independiente.

### Sub-proyectos añadidos durante la ejecución

- **Sub-proyecto 8 — Subida de imágenes** (aprobado): reemplaza los inputs de URL
  por subida de archivo con procesamiento en cliente. Estado del avance real (2026-07-08):
  ya se completaron los sub-proyectos 1, 2, 3, 5 y 7; el orden restante acordado es
  **4 (descuentos) → 8 (imágenes) → 9 (experiencia de caja) → 6 (pulido)**.
- **Sub-proyecto 9 — Experiencia de caja / modos de venta** (nuevo).

---

## Sub-proyecto 1 — Fix layout del carrito

**Objetivo:** el panel de totales del carrito (Subtotal, IVA, Total, Cobrar) debe
quedar **fijo** en la parte inferior; cuando hay muchos ítems, sólo la **lista**
hace scroll. Nunca debe desplazarse el bloque de totales.

**Causa raíz:** `src/shell/AppLayout.tsx:72` usa `min-h-full` en el contenedor
raíz. La cadena de altura no queda anclada al viewport, así que `main`
(`flex-1 overflow-auto`) no tiene altura acotada y las pantallas con `h-full`
(`VentaScreen`) crecen con su contenido; el `Cart` (`flex-1`) empuja los totales.

**Cambios (frontend):**
- Anclar el layout a la altura del viewport: contenedor raíz de `AppLayout` a
  `h-screen` (o `h-dvh`) en vez de `min-h-full`.
- Verificar que `html, body, #root` tengan `height: 100%` (revisar `index.css`);
  ajustar si falta.
- Confirmar que `Cart` no requiere cambios (ya tiene lista `min-h-0 flex-1
  overflow-auto` y totales en bloque `border-t`).

**Riesgos / verificación:** el cambio afecta todas las pantallas. Verificar
manualmente que Stock, Clientes, Inicio y Administración sigan scrolleando dentro
de `main` y no se corten. Sin cambio de datos.

---

## Sub-proyecto 2 — Datos del negocio / boleta

**Objetivo:** que la boleta impresa y los documentos usen los datos reales del
negocio (hoy placeholders), y permitir editarlos desde la app.

**Cambios de datos (migración):**
- Política **RLS de UPDATE** en `business`: permitida sólo si
  `id = current_business_id()` y el usuario es admin (rol `admin` o `is_kromi()`).
  Si no existe un helper `is_admin()`, añadirlo siguiendo el patrón de
  `current_business_id()`/`is_kromi()`.

**Cambios de frontend:**
- `src/data/business.ts`: `useBusiness(businessId)` que lee los campos de
  `business`; `updateBusiness(id, patch)` para el formulario.
- `VentaScreen.handleConfirmPay`: reemplazar el `payload.negocio` placeholder por
  los datos de `useBusiness` (razon_social, rut, giro, direccion, footer, social).
- Reemplazar `negocioNombre = profile?.name` por `business.name` en `QuotePanel`
  y `CreditNoteDialog`.
- Nueva pantalla de ajustes en **Administración**: formulario para `name`, `rut`,
  `giro`, `direccion`, `tagline`, `footer`, `logo_url` (URL), `social_red`,
  `social_url`. Sólo admin.
- La impresora sigue gestionándose en `PrinterSettings` (local).

**Verificación:** boleta impresa con datos reales; edición persistida; un cajero
(no admin) no puede editar (RLS).

---

## Sub-proyecto 3 — Código de barras

**Objetivo:** agregar productos al carrito escaneando su código de barras.

**Cambios de datos (migración):**
- Columna `barcode text` en `product`.
- Índice único parcial `(business_id, barcode) where barcode is not null`.

**Cambios de frontend:**
- `ProductForm`: campo `barcode`.
- `src/data/stock.ts`: incluir `barcode` en select/insert/update de producto.
- `VentaScreen`: en la búsqueda de venta, si el texto ingresado coincide
  **exactamente** con el `barcode` de un producto, al presionar **Enter** se
  agrega ese producto al carrito y se limpia la búsqueda. El lector físico actúa
  como teclado (escribe el código y envía Enter). Sin atajos globales.

**Verificación:** escanear/escribir un barcode conocido + Enter agrega el
producto; barcode inexistente no rompe la búsqueda normal por nombre.

---

## Sub-proyecto 4 — Descuentos

**Objetivo:** aplicar descuentos por línea y al total (en % o monto), sólo admin,
registrados en la venta y reflejados en la boleta.

**Cambios de datos (migración):**
- `sale_line.discount_amount int not null default 0` (monto en pesos de la línea).
- `sale.discount_amount int not null default 0` (monto en pesos del descuento al
  total). Para trazabilidad, guardar además cómo se ingresó: `sale.discount_kind`
  (`'pct'|'amount'`) y `sale.discount_value int` (y equivalentes por línea si se
  decide en el plan; el monto resuelto es lo que la boleta y el cuadre usan).
- Recalcular en servidor: subtotal de línea `= qty*price - discount_line`; total
  `= sum(subtotales) - discount_total`; `neto = round(total/1.19)`,
  `iva = total - neto`. Checks: descuentos ≥ 0 y no dejan el total negativo.

**Cambios de RPC:**
- Extender `cobrar_venta`/`_registrar_venta` para aceptar descuento por línea y al
  total. **Validar en servidor** que el llamante es admin (`is_admin()`); si un
  no-admin envía descuentos, rechazar. El precio base lo sigue fijando el servidor.

**Cambios de frontend:**
- `src/lib/money.ts`: `computeTotals` extendido para aceptar descuentos por línea
  y total, con tests unitarios.
- `Cart`: UI de descuento por línea y descuento al total, visible sólo a admin;
  mostrar el descuento y el total con descuento.
- `PayDialog`: total a cobrar ya descontado.
- Boleta ESC/POS (`src-tauri/src/escpos.rs` + payload): mostrar descuentos.

**Verificación:** tests de `computeTotals`; test SQL de la RPC (admin aplica,
no-admin es rechazado, totales/stock correctos); boleta muestra el descuento.

---

## Sub-proyecto 5 — Retener / recuperar venta

**Objetivo:** suspender una venta en curso y retomarla luego, desde cualquier caja.

**Cambios de datos (migración):**
- Tabla `held_sale`: `id`, `business_id`, `branch_id`, `cashier_id`,
  `customer_id` (nullable), `label text` (opcional), `cart jsonb` (líneas con
  `product_id`, `qty` y descuentos, según formato del sub-proyecto 4),
  `total_snapshot int`, `created_at`.
- No es documento financiero (no mueve caja ni stock) → RLS con insert/select/
  delete por negocio (`business_id = current_business_id()` o `is_kromi()`).

**Cambios de frontend:**
- `src/data/heldSales.ts`: crear, listar y eliminar ventas retenidas.
- `Cart`/`VentaScreen`: botón "Retener" (guarda y vacía el carrito) y una lista
  "Ventas retenidas" para recuperar (recargando el carrito y **revalidando stock
  actual**) o descartar.

**Verificación:** retener vacía el carrito y persiste; recuperar restaura líneas y
descuentos; recuperar en otra caja funciona; stock insuficiente al recuperar se
informa.

---

## Sub-proyecto 6 — Pulido UX transversal

**Objetivo:** pulir sobre lo ya construido, sin refactor de alcance amplio.

**Cambios (frontend):** estados vacíos consistentes, feedback visual, jerarquía y
consistencia del catálogo/carrito/diálogos, responsividad razonable. El fix de
layout del carrito ya se resuelve en el sub-proyecto 1. Alcance acotado; los ítems
concretos se enumeran en el plan de implementación.

---

## Sub-proyecto 7 — Cotizaciones como módulo independiente

**Objetivo:** poder crear y consultar cotizaciones **sin abrir caja**, sacándolas
del gate de caja de `VentaScreen`. La conversión a venta sigue exigiendo caja.

**Contexto actual:** `QuotePanel` se renderiza como un tab dentro de `VentaScreen`,
que hace `if (!openSession) return <AbrirCajaGate/>` (`VentaScreen.tsx`), obligando
a abrir caja para cotizar. `crear_cotizacion` no toca caja ni stock;
`convertir_cotizacion` sí requiere `session`.

**Cambios de frontend (sin migración):**
- Nueva ruta `/cotizaciones` en `src/App.tsx`, accesible a `admin`, `kromi` y
  `cajero`, **sin** gate de caja.
- Nueva entrada "Cotizaciones" en el sidebar (`src/session/nav.ts`), visible para
  esos roles.
- Nuevo módulo `src/modules/cotizaciones/CotizacionesScreen.tsx` que reutiliza
  `QuotePanel`/`useQuotes`. Como fuera de venta no hay carrito en curso, la
  creación de cotización se hace con su propio selector de productos/líneas (o se
  parte del panel existente adaptado a no depender de `cartLines`).
- Quitar el tab "Cotizaciones" de `VentaScreen` (queda sólo la venta).
- **Conversión a venta** desde la lista de cotizaciones: botón "Convertir a venta"
  que exige caja abierta; si no hay sesión abierta, avisa que debe abrir caja
  (no la abre automáticamente). Usa `convertir_cotizacion` con la sesión vigente.

**Consideración de diseño:** hoy `QuotePanel` recibe `cartLines`/`totals` desde
`VentaScreen`. Al independizarse, el módulo de cotizaciones necesita su propia
forma de armar líneas (buscar productos y elegir cantidades) sin depender del
carrito de venta. El plan de este sub-proyecto detallará si se generaliza
`QuotePanel` o se crea un armador de líneas propio.

**Verificación:** un cajero sin caja abierta puede entrar a `/cotizaciones`, crear
y ver cotizaciones; al convertir sin caja se le pide abrir caja; con caja abierta
la conversión genera la venta correctamente.

## Sub-proyecto 8 — Subida de imágenes (aprobado)

**Objetivo:** que las imágenes de producto y el logo del negocio se suban como
archivo (no URL), quedando siempre livianas.

**Almacenamiento:** bucket **público** nuevo `media` (patrón del bucket
`purchase-invoices`): lectura pública (`getPublicUrl`, para mostrar directo y en
boletas), escritura restringida por negocio (carpeta = `business_id`) vía policies
en `storage.objects`. Rutas: `{business_id}/products/{uuid}.webp`,
`{business_id}/logo-{uuid}.webp`. Migración aplicada al remoto.

**Procesamiento en cliente:** helper `processImage(file, maxSize)` que carga la
imagen en un `<canvas>`, la redimensiona al lado mayor (**200px** producto, **400px**
logo) y exporta **WebP** (~0.8 de calidad). Función pura de cálculo de dimensiones
con test. Acepta `image/png,image/jpeg,image/webp`; rechaza lo que no sea imagen.

**Componente `ImageUploader`:** input de archivo + preview + "Quitar". Al elegir →
procesa → sube → guarda la URL pública en `img_url`/`logo_url`. Reemplaza los inputs
de URL en `ProductForm` y `BusinessSettings`.

**Popup de producto más amplio:** ensanchar el modal (~560px, 2 columnas donde
aplique) y eliminar el scroll interno (`maxHeight`) para que quepan todos los campos.

**Fuera de alcance del 8:** borrar del storage la imagen anterior al reemplazarla
(quedan huérfanas); recorte/encuadre manual.

## Sub-proyecto 9 — Experiencia de caja / modos de venta

**Objetivo:** enfocar la pantalla de Venta en la operación de caja y ofrecer un modo
de lectura por pistola tipo supermercado.

**Requisitos:**
- Al entrar a **Venta**, ocultar el menú lateral (sidebar) para maximizar el foco;
  restaurarlo al salir del módulo.
- Iconos (lucide) en los botones "Guardadas", "Nota de crédito" y "Cerrar caja".
- **Dos modos de venta**:
  - **Catálogo** (actual): grid de productos por categoría, uso manual.
  - **Lectura (pistola)**: vista a pantalla completa tipo caja de supermercado,
    **lista de ítems sin imágenes**, orientada al lector de código de barras.
    Control **"Cantidad: N → Marcar"** para agregar varias unidades de una vez
    (ej. 30 unidades de un producto). Uso intuitivo.
- El modo lectura se apoya en el código de barras ya implementado (sub-proyecto 3).

**Nota:** las decisiones finas de diseño del modo lectura (layout exacto, dónde va
el control de cantidad, cómo se alterna entre modos) se detallan en el plan de este
sub-proyecto cuando se aborde.

## Fuera de alcance (YAGNI)

- Pago mixto (varios métodos por venta).
- Precio libre / producto genérico.
- Notas por ítem.
- Atajos de teclado.
- Nuevos métodos de pago más allá de efectivo/tarjeta.
- Borrado de imágenes huérfanas del storage; recorte manual de imágenes.
