# Diseño — Cotizaciones, Proveedores y Notas de crédito

**Fecha**: 2026-07-06
**Estado**: Aprobado (diseño)
**Alcance**: un solo spec, tres módulos core (siempre activos).

## Contexto

kromi-pos es una app de escritorio Tauri 2. El frontend es un único `src/index.html`
con un componente React de clase, estado en memoria (datos mock) y un sistema de
plantillas propio (`sc-if`/`sc-for`, `{{ }}`). La impresión térmica (ESC/POS) es real,
vía comandos Tauri en Rust (`print_receipt` para boleta, `print_cierre` para el cierre).

Navegación actual:
- Tabs principales (ambos roles): Inicio · Venta · Stock · Clientes · Cierre de caja.
- Menú admin (`adminScreens`): Historial · Métricas · Personal · Configuración · Respaldo.
- Roles: `admin`/`kromi` (isAdmin) y `cajero`. `setScreen(id)` cambia de pantalla.

Modelos existentes relevantes:
- `sales: [{ folio, time, method, total, neto, iva, recv, change, points, customerId,
  cashierId, date, dateIso, lines:[{name, qty, price, cat}], cajaSessionId }]`
- `cierres: [{ id, dateIso, dateLabel, cashierId, cashierName, openTime, closeTime,
  salesCount, cash, card, float, counted, sales:[...] }]`
- Cierre: `mine = sales.filter(cajaSessionId === cajaSessionId)`; Esperado en caja =
  `float + ventas en efectivo`.

> ⚠️ Hay cambios sin commitear en `escpos.rs`, `printing.rs`, `tauri.conf.json`,
> `index.html`. Reconciliar con el usuario antes de implementar para no pisar trabajo
> de impresión en curso.

## Principios de integración

- Respetar el patrón actual: estado en memoria en el componente, plantillas, helpers
  `fmt`/`normRut`/`fmtRut`, gating por rol, impresión vía Tauri.
- Prosa en español; identificadores en inglés.
- Validar entradas en la capa que corresponda; datos mock por ahora.

---

## 1. Notas de crédito — solo admin

### Modelo
```
creditNotes: [{
  id,                 // 'nc' + timestamp
  folio,              // secuencia propia de NC
  dateIso, time,
  cajaSessionId,      // turno en que se ejecuta -> afecta la caja de ese día
  cashierId,
  saleFolio | null,   // boleta origen si aplica
  method,             // 'efectivo' | 'tarjeta' (medio de devolución)
  reason,             // motivo (texto)
  lines: [{ name, qty, price, restock:bool }],
  total, neto, iva
}]
```

### Comportamiento
- **Origen (ambas fuentes)**:
  - Desde el detalle de una boleta en Historial: precarga las líneas del folio; el
    usuario elige qué líneas y cantidades devolver. `saleFolio` = folio origen.
  - Manual: form desde cero (líneas libres, monto, método, motivo). `saleFolio = null`.
- **Método de devolución** = método original de la venta cuando nace de boleta;
  elegible cuando es manual.
- **Requiere caja abierta**: la NC se ata al `cajaSessionId` actual. Si no hay caja
  abierta, se bloquea con aviso.
- **Efecto en caja / cierre** (la NC afecta la caja del día en que se ejecuta):
  - `efectivo` → **reduce** el "Esperado en caja" del cierre. Se muestra como línea
    propia **"Notas de crédito (efectivo) −$X"**.
  - `tarjeta` → línea informativa **"Reversos tarjeta −$X"** (no altera el efectivo
    contado ni el descuadre).
  - **No es pérdida**: siempre aparece como línea de devolución, nunca como descuadre
    ni faltante.
- **Stock**: por cada línea con `restock:true`, sumar `qty` al stock del producto
  correspondiente (match por nombre de producto). Líneas con `restock:false` no tocan
  stock (p.ej. producto dañado).
- **Impresión**: comprobante térmico ESC/POS vía nuevo comando `print_credit_note`
  (espejo de `print_receipt`).
- **Visibilidad**:
  - En Cierre de caja: resumen del turno (líneas de NC) y en el comprobante de cierre.
  - En Historial: nueva pestaña "Notas de crédito" junto a Ventas / Cierres, con
    filtros equivalentes (cajero/fecha) y detalle imprimible.

### Integración con el cierre
- `doCierre` y el render del cierre calculan, para el `cajaSessionId` del turno:
  - `ncCash = creditNotes(turno, efectivo).total`
  - `ncCard = creditNotes(turno, tarjeta).total`
- Esperado en caja = `float + ventasEfectivo − ncCash`.
- El snapshot del cierre (`rec`) incluye `ncCash`, `ncCard` y las NC del turno para el
  comprobante y el detalle histórico.

---

## 2. Cotizaciones — cajero + admin, dentro de Venta

### Modelo
```
quotes: [{
  id,                 // 'qt' + timestamp
  folio,              // secuencia propia de cotización
  dateIso,
  validUntilIso,      // dateIso + 7 días (default)
  customerId | null,
  lines: [{ name, qty, price }],
  total, neto, iva,
  converted: bool,
  saleFolio | null    // folio de la venta si se convirtió
}]
```

### Comportamiento
- **Crear**: en la pantalla Venta, con el carrito armado, botón **"Cotizar"** junto a
  "Cobrar". Pide vigencia en días (**default 7**) y cliente opcional.
- **Vigencia**: `validUntilIso`. Badge calculado por fecha: **Vigente** / **Vencida**
  (sin gestión de estados adicional).
- **Acciones sobre una cotización**:
  - **Imprimir**: térmica ESC/POS vía nuevo comando `print_quote`.
  - **Enviar / Exportar (PDF)**: **Opción A** — vista A4 en HTML dedicada +
    `window.print()` → el usuario elige "Guardar como PDF" del sistema. Cero backend,
    cero dependencias nuevas.
  - **Convertir a venta**: carga las líneas de la cotización al carrito de Venta. Al
    cobrarse, la cotización queda `converted:true` con su `saleFolio`.
- **Listado**: sub-vista "Cotizaciones" accesible desde Venta (ambos roles), con
  búsqueda y el badge de vigencia.

---

## 3. Proveedores — solo admin, nuevo ítem en menú admin

### Modelo
```
suppliers: [{
  id,                 // 'sup' + n
  razonSocial, rut, giro,
  contactName, phone, email,
  address, website,
  payTerms,           // 'contado' | '30' | '60' | '90'
  category,           // rubro/categoría que provee
  bank, account,      // datos bancarios para transferencias
  notes,
  active
}]
```

### Comportamiento
- **CRUD**: lista con búsqueda + activar/desactivar; form crear/editar con la ficha
  completa (incluye datos bancarios y sitio web).
- **Asociación opcional a productos**: campo `supplierId` opcional en cada `product`.
  - En la ficha del producto (Stock): selector de proveedor opcional.
  - En la ficha del proveedor: lista de productos asociados.
- **Ubicación**: nuevo ítem "Proveedores" en el menú admin (junto a Personal /
  Configuración). Nueva entrada en `adminScreens` y `adminMenuDefs`.

---

## 4. Impresión (Rust)

- Nuevos comandos en `src-tauri/src/lib.rs`, espejo de `print_receipt`:
  - `print_quote(payload: QuotePayload)` — cotización térmica 80mm.
  - `print_credit_note(payload: CreditNotePayload)` — comprobante de NC.
- Structs de payload correspondientes; registrar ambos en `invoke_handler`.
- Fallback JS: si `window.__TAURI__` no está, usar `window.print()` (igual que hoy).
- El "Enviar/Exportar PDF" de cotización **no** usa Rust: es print-to-PDF del navegador
  sobre la vista A4.

## 5. Navegación y permisos (resumen)

| Módulo            | Ubicación                                  | Roles          |
|-------------------|--------------------------------------------|----------------|
| Cotizaciones      | Dentro de Venta (crear + listado)          | cajero + admin |
| Notas de crédito  | Historial (desde boleta) + creación manual | solo admin     |
| Proveedores       | Nuevo ítem en menú admin                   | solo admin     |

## 6. Textos

Mantener el patrón actual (strings inline en español). No introducir un sistema i18n
nuevo; ser consistente con lo existente.

## 7. Verificación

No hay tests automatizados; datos mock. Verificación manual end-to-end:
- Cotización: crear desde carrito → imprimir térmica → exportar PDF (A4) → convertir a
  venta y confirmar `converted`/`saleFolio`.
- NC desde boleta: seleccionar líneas, restock por línea, método efectivo → verificar
  que reduce "Esperado en caja" en el cierre y aparece como línea propia (no descuadre);
  método tarjeta → verificar línea informativa. Confirmar impresión y aparición en la
  pestaña de Historial.
- NC manual: crear con caja abierta; bloqueo si caja cerrada.
- Proveedores: CRUD + activar/desactivar + asociar producto y verlo en ambas fichas.

## Fuera de alcance (YAGNI)

- Envío real por correo/WhatsApp (solo PDF para compartir manualmente).
- Órdenes de compra / recepción de mercadería desde proveedores.
- Estados de cotización más allá de Vigente/Vencida/Convertida.
- Persistencia en disco / backend (sigue todo en memoria mock).
