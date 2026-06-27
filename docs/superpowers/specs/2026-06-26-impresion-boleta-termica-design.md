# Diseño — Impresión de boleta térmica + apertura de gaveta (kromi-pos)

Fecha: 2026-06-26
Estado: propuesta para revisión

## 1. Objetivo

Conectar el cierre de venta del POS con la **impresión real** en la impresora térmica
80mm (ESC/POS) y la **apertura automática de la gaveta**, reemplazando el actual
`window.print()` (diálogo del navegador) por impresión nativa vía un comando Rust de Tauri.

Marca real del negocio: **Planta con Mati** (Instagram @plantaconmati).

## 2. Decisiones (confirmadas con el usuario)

- **Disparo**: la boleta se imprime **automáticamente al "Confirmar cobro"**. El botón
  "Imprimir" del modal de ticket queda como **reimpresión**.
- **Gaveta**: se abre **solo en pagos en efectivo**.
- **Datos del emisor + impresora**: se toman de la pantalla **Configuración → "Recibo y
  datos fiscales"** (hoy campos estáticos; se vuelven funcionales y se amplían).
- **Plataforma**: la app corre en **Windows y macOS**, con impresión **real en ambos**.
  Windows usa `winspool` (RAW); macOS/Linux usa CUPS (`lp -d <printer> -o raw`). Los bytes
  ESC/POS son idénticos; solo cambia el transporte. En mac la impresora necesita una **cola
  CUPS "raw"** y su nombre es el `printer_name` configurado.

## 3. Arquitectura

```
confirmPay(sale)  ──auto──>  printReceipt(sale)
                                  │  invoke('print_receipt', { payload })   (Tauri core)
                                  ▼
                   src-tauri/src/escpos.rs : build(payload) -> Vec<u8>
                                  ▼
                   src-tauri/src/printing.rs : send_raw(printer, bytes)  (winspool, cfg(windows))
                                  ▼
                            Impresora (cola RAW)
                                  ▼
                   si efectivo: append ESC p 0 25 250 -> abre gaveta
```

### 3.1 Backend Rust (`src-tauri/`)
- **`Cargo.toml`**: agregar `windows` (features Graphics_Printing / Foundation) solo en
  target Windows. `serde` ya está.
- **`src/escpos.rs`** (nuevo): arma el byte stream ESC/POS replicando el prototipo validado.
  - `pub fn build(p: &ReceiptPayload) -> Vec<u8>`
  - Bloques: logo raster (embebido), encabezado nativo, recuadro ASCII de folio,
    detalle de ítems, totales, TOTAL doble tamaño, QR nativo (Instagram), timbre dummy,
    pie, corte `GS V B 0`, y `ESC p 0 25 250` si `open_drawer`.
  - El **logo** se embebe como bytes ESC/POS pre-generados (`include_bytes!("logo.escpos")`)
    para no depender de un decodificador de imágenes en runtime. Generados desde
    `logo_positive.png` (versión "positivo C", ~272px, nudge=8).
  - El **timbre SII** es dummy por ahora (barras raster generadas o embebidas). Marcado
    como TODO para PDF417 real cuando se integre facturación electrónica.
  - **QR**: nativo `GS ( k` con **módulo 6** (validado; módulo 8 cuelga el firmware).
- **`src/printing.rs`** (nuevo): `send_raw(printer: &str, data: &[u8])` con dos
  implementaciones — Windows (`#[cfg(windows)]`) vía `OpenPrinter`/`StartDocPrinter`(RAW)/
  `WritePrinter`/`EndDocPrinter`; macOS/Linux (`#[cfg(not(windows))]`) vía `lp -d <printer>
  -o raw` (CUPS).
  - **Watchdog/reintento**: tras enviar, si el trabajo queda zombie (no drena), reintentar
    1 vez. (v1: reintento simple; el diagnóstico de zombie por API queda como mejora.)
- **`src/lib.rs`**: comando `#[tauri::command] fn print_receipt(payload: ReceiptPayload)
  -> Result<(), String>` registrado en `invoke_handler![greet, print_receipt]`.

### 3.2 Contenido configurable vs. fijo (principio rector)

**Todo el contenido descriptivo/marketing de la boleta nace de la configuración del
negocio** — no hay textos hardcodeados de marca. Lo único fijo es lo legal/transaccional.

| Configurable (negocio)                          | Fijo (transacción / legal)              |
|-------------------------------------------------|-----------------------------------------|
| Logo                                            | Folio                                   |
| Tagline bajo el logo ("Vivero & Jardineria")    | Fecha y hora de la venta                |
| Razón social (nombre legal)                     | Ítems, cantidades, precios              |
| Giro                                            | Neto / IVA / Total                      |
| Dirección                                       | Método de pago                          |
| Pie de página ("Gracias por tu compra!")        | Leyenda del **timbre SII** (Res./texto) |
| RUT (dato del negocio, editable una vez)        | Timbre electrónico (PDF417, futuro)     |
| Red social: **tipo + URL** → genera QR          |                                         |
| Nombre de la impresora                          |                                         |

**Red social dinámica**: el negocio elige la red (Instagram / Facebook / TikTok / Web /
WhatsApp / …) y su **URL**. La boleta muestra la leyenda según la red ("Síguenos en
Instagram", "Visítanos en Facebook", etc.), un `@handle`/etiqueta derivada, y el **QR se
genera a partir de la URL configurada**. Si no hay red social configurada, se omite el
bloque QR completo.

### 3.3 Modelo de datos (JS → Rust)
```
ReceiptPayload {
  negocio: {
    tagline: String,           // bajo el logo: "Vivero & Jardineria"
    razon_social: String,      // "Planta con Mati SpA"
    rut: String,               // "78.123.456-7"
    giro: String,              // "Venta de plantas y jardineria"
    direccion: String,         // "Av. Las Camelias 1234, Nunoa"
    footer: String,            // "Gracias por tu compra!"
    printer_name: String,
    social: Option<{ red: String, url: String, etiqueta: String }>,  // None => sin QR
  },
  folio: u32,
  fecha: String, hora: String,
  items: [ { nombre: String, qty: u32, precio: i64 } ],
  neto: i64, iva: i64, total: i64,
  metodo: String,            // "efectivo" | "tarjeta"
  open_drawer: bool,         // = (metodo == "efectivo")
  // timbre SII: dummy en v1 (leyenda fija); estructura TED real en futuro
}
```
Mapeo en frontend: `sale.lines[].{name,qty,price}` → `items`, más `neto/iva/total/folio/
time/date/method`, y `negocio` desde el estado de configuración del POS.

### 3.3 Frontend (`src/index.html` + `support.js`)
- **`printReceipt(sale)`** (helper nuevo): construye el payload y llama
  `window.__TAURI__.core.invoke('print_receipt', { payload })`. Si no hay Tauri
  (navegador), cae a `window.print()` (comportamiento actual) para no romper el preview.
- **`confirmPay`**: tras crear la venta, llamar `printReceipt(sale)` (auto-impresión).
- **`printTicket`**: pasa a llamar `printReceipt(this.state.ticket)` (reimpresión) en vez de
  `window.print()`.
- **Pantalla Configuración → Recibo**: los inputs (hoy estáticos) se conectan a estado
  nuevo `cfgRecibo` con **todos los campos configurables** (tagline, razón social, RUT,
  giro, dirección, pie, nombre de impresora, y red social: tipo + URL). Persistido en el
  estado de la app (en memoria, coherente con el alcance del prototipo). La "Vista previa
  en vivo" debería reflejar estos valores. El **QR del preview/boleta** se arma desde la
  URL de la red social configurada; la leyenda cambia según el tipo de red.

## 4. Constantes de hardware (validadas, ver memoria del proyecto)
- Cola/impresora destino: configurable (default el nombre que tenga el equipo; en pruebas
  fue `TermalTest`, driver "Generic / Text Only" sobre `USB001`).
- Ancho **48 columnas**, **solo fuente A** (la B se imprime cortada).
- Centrado de raster: **nudge = 8 px** a la izquierda (canvas = contenido + 2·nudge, `ESC a 1`).
- QR nativo: `GS ( k` **módulo 6**.
- Corte automático: `GS V B 0` (`1D 56 42 00`).
- Gaveta: `ESC p 0 25 250` (`1B 70 00 19 FA`, pin 2).
- Evitar **negro sólido grande** (cuelga el cabezal): logo en versión "positivo" liviana.
- Confiabilidad: depende de **USB de datos** (la impresora tiene fuente propia). Recomendado
  puerto directo (no hub) + reintento en software.

## 5. Fuera de alcance (v1)
- Timbre SII **real** (PDF417 con TED) y folios/CAF del SII — se deja dummy.
- **Acentos** (ñ, tildes) en texto nativo: la impresora usa tabla china; v1 usa ASCII.
  Mejora futura: configurar code page (`ESC t`) o render raster del texto.
- Persistencia de configuración entre sesiones (el prototipo es en memoria).
- Selección/descubrimiento de impresoras desde la UI (se ingresa el nombre a mano).

## 6. Pruebas
- **Manual (hardware)**: cobro en efectivo → imprime boleta completa + abre gaveta; cobro
  en tarjeta → imprime, no abre gaveta; botón "Imprimir" reimprime. Verificar contra los
  prototipos ya validados en papel.
- **Rust**: test unitario de `escpos::build` que verifica que el stream contiene los
  comandos clave (init `1B 40`, corte `1D 56 42 00`, drawer `1B 70` solo si efectivo, y
  que los textos de ítems/total están presentes).
- **Fallback navegador**: en `pnpm` sin Tauri, `printReceipt` no rompe (usa `window.print`).

## 7. Riesgos
- El binding de la UI del prototipo usa un sistema de plantillas propio (`{{ }}` + `sc-if`
  en `support.js`); conectar los inputs de Configuración requiere seguir ese patrón.
- Generar los bytes del logo embebido: se hace una vez con el script PowerShell ya
  existente y se guarda como asset (`src-tauri/assets/logo.escpos`).
