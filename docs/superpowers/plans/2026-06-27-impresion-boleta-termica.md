# Impresión de boleta térmica + gaveta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al confirmar un cobro en el POS, imprimir la boleta real en la térmica 80mm (ESC/POS) con contenido configurable del negocio, y abrir la gaveta en pagos en efectivo.

**Architecture:** Comando Tauri `print_receipt` en Rust que arma los bytes ESC/POS (validados en hardware) y los envía RAW por `winspool`. El frontend (prototipo React en `src/index.html`) llama al comando al confirmar el cobro, con los datos de la venta + la configuración del negocio (en memoria).

**Tech Stack:** Tauri 2 (Rust), crate `windows` (winspool, solo Windows), `serde`; frontend React 18 vendoreado con motor de plantillas propio (`{{ }}` + `sc-if`).

## Global Constraints

- **FASE PROTOTIPO**: sin base de datos, sin backend, sin lógica de negocio nueva. Toda la configuración vive en el **estado en memoria** de la app (igual que el resto del prototipo). La impresión sí es real (es lo que se valida con el cliente).
- **Plataforma**: la app corre en **Windows y macOS**, y la impresión es **real en ambos**. Windows: `winspool` (RAW). macOS/Linux: CUPS vía `lp -d <printer> -o raw`. Los bytes ESC/POS son idénticos; solo cambia el transporte (`#[cfg(windows)]` vs `#[cfg(not(windows))]`). En mac la impresora debe tener una **cola CUPS "raw"** (Generic/Raw); su nombre es el `printer_name` configurado.
- **Contenido configurable vs fijo**: todo lo descriptivo/marca sale de la config del negocio (tagline, razón social, RUT, giro, dirección, pie, red social+URL). Lo fijo es transaccional/legal (folio, fecha/hora, ítems, neto/IVA/total, método, leyenda timbre SII).
- **Texto nativo**: solo **fuente A**, **48 columnas**, **ASCII** (sin acentos; la impresora usa tabla china). Acentos = fuera de alcance v1.
- **Constantes de hardware validadas**: QR nativo `GS ( k` módulo **6**; corte `GS V B 0` (`1D 56 42 00`); gaveta `ESC p 0 25 250` (`1B 70 00 19 FA`); centrado raster nudge **8px**; evitar negro sólido grande.
- **Idioma**: prosa en español, identificadores en inglés.
- **gpg/commits**: cada tarea termina en commit. No hacer push salvo que el usuario lo pida.

---

## File Structure

- `src-tauri/Cargo.toml` — agregar dependencia `windows` (solo target Windows).
- `src-tauri/src/escpos.rs` (nuevo) — structs `ReceiptPayload` + `escpos::build(&ReceiptPayload) -> Vec<u8>` y helpers de texto/QR. Sin I/O.
- `src-tauri/src/printing.rs` (nuevo) — `send_raw(printer, &[u8]) -> Result<(),String>` vía winspool (`#[cfg(windows)]`) + stub no-Windows.
- `src-tauri/assets/logo.escpos` (nuevo) — bytes ESC/POS del logo (raster pre-generado), embebidos con `include_bytes!`.
- `src-tauri/src/lib.rs` (modificar) — declarar módulos, comando `print_receipt`, registrarlo.
- `src/index.html` (modificar) — estado `cfgRecibo`, inputs funcionales en Config→Recibo, helper `printReceipt`, auto-impresión en `confirmPay`, reimpresión en `printTicket`, bindings.

---

### Task 1: Rust — `escpos::build` con structs y test

**Files:**
- Create: `src-tauri/src/escpos.rs`
- Modify: `src-tauri/src/lib.rs` (declarar `mod escpos;`)

**Interfaces:**
- Produces:
  - `pub struct ReceiptPayload { pub negocio: Negocio, pub folio: u32, pub fecha: String, pub hora: String, pub items: Vec<Item>, pub neto: i64, pub iva: i64, pub total: i64, pub metodo: String, pub open_drawer: bool }`
  - `pub struct Negocio { pub tagline: String, pub razon_social: String, pub rut: String, pub giro: String, pub direccion: String, pub footer: String, pub printer_name: String, pub social: Option<Social> }`
  - `pub struct Social { pub red: String, pub url: String, pub etiqueta: String }`
  - `pub struct Item { pub nombre: String, pub qty: u32, pub precio: i64 }`
  - `pub fn build(p: &ReceiptPayload) -> Vec<u8>`

- [ ] **Step 1: Write the failing test**

En `src-tauri/src/escpos.rs` (al final del archivo):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn sample(metodo: &str, drawer: bool) -> ReceiptPayload {
        ReceiptPayload {
            negocio: Negocio {
                tagline: "Vivero & Jardineria".into(),
                razon_social: "Planta con Mati SpA".into(),
                rut: "78.123.456-7".into(),
                giro: "Venta de plantas".into(),
                direccion: "Av. Las Camelias 1234".into(),
                footer: "Gracias por tu compra!".into(),
                printer_name: "TermalTest".into(),
                social: Some(Social { red: "Instagram".into(), url: "https://instagram.com/x".into(), etiqueta: "@x".into() }),
            },
            folio: 1234,
            fecha: "27/06/2026".into(), hora: "14:32".into(),
            items: vec![Item { nombre: "Echeveria".into(), qty: 1, precio: 3990 }],
            neto: 3353, iva: 637, total: 3990,
            metodo: metodo.into(), open_drawer: drawer,
        }
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn empieza_con_init_y_termina_con_corte() {
        let b = build(&sample("efectivo", true));
        assert_eq!(&b[0..2], &[0x1B, 0x40]);                 // ESC @
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x00]));    // corte
    }

    #[test]
    fn gaveta_solo_si_open_drawer() {
        let kick = [0x1Bu8, 0x70, 0x00, 0x19, 0xFA];
        assert!(contains(&build(&sample("efectivo", true)), &kick));
        assert!(!contains(&build(&sample("tarjeta", false)), &kick));
    }

    #[test]
    fn incluye_textos_y_qr() {
        let b = build(&sample("efectivo", true));
        assert!(contains(&b, b"Planta con Mati SpA"));
        assert!(contains(&b, b"Echeveria"));
        assert!(contains(&b, b"TOTAL"));
        assert!(contains(&b, &[0x1D, 0x28, 0x6B]));          // comando QR nativo (GS ( k)
        assert!(contains(&b, b"https://instagram.com/x"));   // dato del QR
    }

    #[test]
    fn sin_social_no_incluye_qr() {
        let mut p = sample("efectivo", true);
        p.negocio.social = None;
        let b = build(&p);
        assert!(!contains(&b, &[0x1D, 0x28, 0x6B]));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test escpos`
Expected: FAIL de compilación (`build`, `ReceiptPayload`, etc. no existen).

- [ ] **Step 3: Write minimal implementation**

Al inicio de `src-tauri/src/escpos.rs`:

```rust
use serde::Deserialize;

#[derive(Deserialize, Clone)]
pub struct Social { pub red: String, pub url: String, pub etiqueta: String }

#[derive(Deserialize, Clone)]
pub struct Negocio {
    pub tagline: String,
    pub razon_social: String,
    pub rut: String,
    pub giro: String,
    pub direccion: String,
    pub footer: String,
    pub printer_name: String,
    pub social: Option<Social>,
}

#[derive(Deserialize, Clone)]
pub struct Item { pub nombre: String, pub qty: u32, pub precio: i64 }

#[derive(Deserialize, Clone)]
pub struct ReceiptPayload {
    pub negocio: Negocio,
    pub folio: u32,
    pub fecha: String,
    pub hora: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
    pub metodo: String,
    pub open_drawer: bool,
}

const COL: usize = 48;

fn money(n: i64) -> String {
    // separador de miles con punto, estilo CLP: 13770 -> 13.770
    let s = n.abs().to_string();
    let bytes = s.as_bytes();
    let mut out = String::new();
    for (i, c) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i) % 3 == 0 { out.push('.'); }
        out.push(*c as char);
    }
    if n < 0 { format!("-{}", out) } else { out }
}

fn push_text(buf: &mut Vec<u8>, s: &str) {
    // ASCII puro: cualquier no-ASCII se reemplaza por '?'
    for ch in s.chars() { buf.push(if ch.is_ascii() { ch as u8 } else { b'?' }); }
}
fn nl(buf: &mut Vec<u8>) { buf.push(0x0A); }

fn line_lr(buf: &mut Vec<u8>, l: &str, r: &str, col: usize) {
    let used = l.chars().count() + r.chars().count();
    let sp = if used >= col { 1 } else { col - used };
    push_text(buf, l);
    for _ in 0..sp { buf.push(b' '); }
    push_text(buf, r);
    nl(buf);
}
fn line_center(buf: &mut Vec<u8>, s: &str) {
    let len = s.chars().count();
    let lead = if len >= COL { 0 } else { (COL - len) / 2 };
    for _ in 0..lead { buf.push(b' '); }
    push_text(buf, s);
    nl(buf);
}
fn rule(buf: &mut Vec<u8>, ch: u8) { for _ in 0..COL { buf.push(ch); } nl(buf); }

fn box_ascii(buf: &mut Vec<u8>, lines: &[&str], inner: usize) {
    let lead = if COL >= inner + 2 { (COL - (inner + 2)) / 2 } else { 0 };
    let pad = |buf: &mut Vec<u8>, n: usize| { for _ in 0..n { buf.push(b' '); } };
    pad(buf, lead); buf.push(b'+'); for _ in 0..inner { buf.push(b'-'); } buf.push(b'+'); nl(buf);
    for ln in lines {
        let l = ln.chars().count().min(inner);
        let total_pad = inner - l;
        let lf = total_pad / 2; let rg = total_pad - lf;
        pad(buf, lead); buf.push(b'|'); pad(buf, lf); push_text(buf, ln); pad(buf, rg); buf.push(b'|'); nl(buf);
    }
    pad(buf, lead); buf.push(b'+'); for _ in 0..inner { buf.push(b'-'); } buf.push(b'+'); nl(buf);
}

fn qr_native(buf: &mut Vec<u8>, url: &str) {
    let data = url.as_bytes();
    let len = data.len() + 3;
    let pl = (len & 0xFF) as u8;
    let ph = (len >> 8) as u8;
    buf.extend_from_slice(&[0x1D,0x28,0x6B,0x04,0x00,0x31,0x41,0x32,0x00]); // modelo 2
    buf.extend_from_slice(&[0x1D,0x28,0x6B,0x03,0x00,0x31,0x43,0x06]);      // modulo 6
    buf.extend_from_slice(&[0x1D,0x28,0x6B,0x03,0x00,0x31,0x45,0x31]);      // ECC M
    buf.extend_from_slice(&[0x1D,0x28,0x6B,pl,ph,0x31,0x50,0x30]);          // store
    buf.extend_from_slice(data);
    buf.extend_from_slice(&[0x1D,0x28,0x6B,0x03,0x00,0x31,0x51,0x30]);      // print
}

pub fn build(p: &ReceiptPayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]); // init

    // (logo va aquí en Task 3)

    // tagline + emisor (centrado)
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    line_center(&mut b, &format!("* {} *", p.negocio.tagline));
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    line_center(&mut b, &p.negocio.razon_social);
    line_center(&mut b, &p.negocio.giro);
    line_center(&mut b, &p.negocio.direccion);
    nl(&mut b);

    // recuadro de folio
    box_ascii(&mut b, &[
        &format!("R.U.T.: {}", p.negocio.rut),
        "BOLETA ELECTRONICA",
        &format!("No {}", p.folio),
    ], 32);
    nl(&mut b);

    // fecha
    push_text(&mut b, &format!("Fecha: {} {}", p.fecha, p.hora)); nl(&mut b);
    rule(&mut b, b'-');

    // encabezado de columnas (negrita)
    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    line_lr(&mut b, "Item", "Subtotal", COL);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    rule(&mut b, b'=');

    // items
    for it in &p.items {
        line_lr(&mut b, &it.nombre, &money(it.precio * it.qty as i64), COL);
        push_text(&mut b, &format!("   {} x {}", it.qty, money(it.precio))); nl(&mut b);
    }
    rule(&mut b, b'=');

    // totales
    line_lr(&mut b, "Neto", &money(p.neto), COL);
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    nl(&mut b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]); // doble tamano
    line_lr(&mut b, "TOTAL", &money(p.total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(&mut b);
    rule(&mut b, b'-');

    // red social (QR) — solo si esta configurada
    if let Some(s) = &p.negocio.social {
        b.extend_from_slice(&[0x1B, 0x61, 0x01]);
        line_center(&mut b, &format!("Siguenos en {}", s.red));
        qr_native(&mut b, &s.url);
        nl(&mut b);
        push_text(&mut b, &s.etiqueta); nl(&mut b);
        b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    }
    nl(&mut b);

    // pie
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    line_center(&mut b, &p.negocio.footer);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    // (timbre SII dummy va aquí en Task 3)

    // feed + corte
    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]);

    // gaveta solo en efectivo
    if p.open_drawer {
        b.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
    }
    b
}
```

Y en `src-tauri/src/lib.rs`, agregar al inicio: `mod escpos;`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test escpos`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/escpos.rs src-tauri/src/lib.rs
git commit -m "feat(escpos): build ESC/POS receipt bytes from sale payload"
```

---

### Task 2: Rust — envío RAW por winspool (`printing.rs`)

**Files:**
- Create: `src-tauri/src/printing.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (declarar `mod printing;`)

**Interfaces:**
- Produces: `pub fn send_raw(printer: &str, data: &[u8]) -> Result<(), String>`

- [ ] **Step 1: Agregar dependencia windows (solo Windows)**

En `src-tauri/Cargo.toml`, después de la sección `[dependencies]`, agregar:

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
  "Win32_Foundation",
  "Win32_Graphics_Printing",
] }
```

- [ ] **Step 2: Implementar `send_raw` (Windows) + stub**

Crear `src-tauri/src/printing.rs`:

```rust
#[cfg(windows)]
pub fn send_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Printing::{
        OpenPrinterW, ClosePrinter, StartDocPrinterW, EndDocPrinter,
        StartPagePrinter, EndPagePrinter, WritePrinter, DOC_INFO_1W,
    };
    use windows::Win32::Foundation::HANDLE;

    // a UTF-16 terminado en null
    fn w(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

    unsafe {
        let mut hprinter = HANDLE::default();
        let name = w(printer);
        OpenPrinterW(PCWSTR(name.as_ptr()), &mut hprinter, None)
            .map_err(|e| format!("OpenPrinter: {e}"))?;

        let mut doc_name = w("Boleta");
        let mut datatype = w("RAW");
        let mut di = DOC_INFO_1W {
            pDocName: windows::core::PWSTR(doc_name.as_mut_ptr()),
            pOutputFile: windows::core::PWSTR::null(),
            pDatatype: windows::core::PWSTR(datatype.as_mut_ptr()),
        };

        let job = StartDocPrinterW(hprinter, 1, &mut di);
        if job == 0 { let _ = ClosePrinter(hprinter); return Err("StartDocPrinter fallo".into()); }

        let mut result = Ok(());
        if StartPagePrinter(hprinter).as_bool() {
            let mut written = 0u32;
            let ok = WritePrinter(hprinter, data.as_ptr() as *const _, data.len() as u32, &mut written).as_bool();
            if !ok || (written as usize) != data.len() {
                result = Err(format!("WritePrinter: escritos {written}/{}", data.len()));
            }
            let _ = EndPagePrinter(hprinter);
        } else {
            result = Err("StartPagePrinter fallo".into());
        }
        let _ = EndDocPrinter(hprinter);
        let _ = ClosePrinter(hprinter);
        result
    }
}

#[cfg(not(windows))]
pub fn send_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    // macOS/Linux: imprimir RAW por CUPS con `lp -d <printer> -o raw`.
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("lp")
        .args(["-d", printer, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("lp spawn: {e}"))?;
    child.stdin.as_mut().ok_or("lp: sin stdin")?
        .write_all(data).map_err(|e| format!("lp write: {e}"))?;
    let out = child.wait_with_output().map_err(|e| format!("lp wait: {e}"))?;
    if out.status.success() { Ok(()) }
    else { Err(format!("lp: {}", String::from_utf8_lossy(&out.stderr))) }
}
```

En `src-tauri/src/lib.rs`, agregar: `mod printing;`

- [ ] **Step 3: Verificar que compila en ambos targets disponibles**

Run: `cd src-tauri && cargo build`
Expected: compila sin errores (en Windows usa winspool; en macOS/Linux usa `lp`/CUPS).

> Nota: `send_raw` hace I/O de hardware; se valida manualmente en Task 7 (no hay test unitario).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/printing.rs src-tauri/src/lib.rs
git commit -m "feat(printing): send raw bytes to Windows printer via winspool"
```

---

### Task 3: Logo embebido + timbre dummy en el stream

**Files:**
- Create: `src-tauri/assets/logo.escpos`
- Modify: `src-tauri/src/escpos.rs`

**Interfaces:**
- Consumes: `escpos::build` (Task 1)
- Produces: logo y timbre integrados dentro de `build`.

- [ ] **Step 1: Generar el asset del logo (bytes ESC/POS del logo raster)**

Ejecutar este PowerShell una vez para volcar el cuerpo raster del logo a `src-tauri/assets/logo.escpos`. Usa la misma técnica validada (logo "positivo", nudge=8) y escribe el bloque `ESC a 1` + raster + `ESC a 0`:

```powershell
# (ejecutar desde la raíz del repo kromi-pos)
New-Item -ItemType Directory -Force src-tauri/assets | Out-Null
$ps = "C:\Users\Cromi\AppData\Local\Temp\claude\C--Kromi\d29c822d-ca00-4cff-a9e0-f3e0cd16d02c\scratchpad"
Add-Type -AssemblyName System.Drawing
Add-Type -Path "$ps\LogoProc.cs" -ReferencedAssemblies 'System.Drawing'
Add-Type -Path "$ps\QrCode.cs" -ReferencedAssemblies 'System.Drawing'  # no usado aquí, ignora si falla
# raster helper inline:
$src=[System.Drawing.Bitmap]::FromFile("$ps\logo_positive.png")
$minx=$src.Width;$maxx=0;$miny=$src.Height;$maxy=0
for($y=0;$y -lt $src.Height;$y+=2){for($x=0;$x -lt $src.Width;$x+=2){ $p=$src.GetPixel($x,$y); if((($p.R+$p.G+$p.B)/3) -lt 128){ if($x -lt $minx){$minx=$x};if($x -gt $maxx){$maxx=$x};if($y -lt $miny){$miny=$y};if($y -gt $maxy){$maxy=$y} }}}
$cw=$maxx-$minx+1;$ch=$maxy-$miny+1;$nudge=8
$cwTot=[int]([math]::Ceiling(($cw+2*$nudge)/8.0))*8; $Hc=[int]([math]::Ceiling(($ch+8)/8.0))*8
$c=New-Object System.Drawing.Bitmap($cwTot,$Hc,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g=[System.Drawing.Graphics]::FromImage($c); $g.Clear([System.Drawing.Color]::White)
$g.DrawImage($src,(New-Object System.Drawing.Rectangle(0,2,$cw,$ch)),(New-Object System.Drawing.Rectangle($minx,$miny,$cw,$ch)),[System.Drawing.GraphicsUnit]::Pixel); $g.Flush()
$W=$cwTot;$H=$Hc;$bpr=[int][math]::Floor(($W+7)/8)
$out=New-Object System.Collections.Generic.List[byte]
foreach($z in @(0x1B,0x61,0x01)){ $out.Add([byte]$z) }   # centrar
$band=128
for($y0=0;$y0 -lt $H;$y0+=$band){ $rows=[math]::Min($band,$H-$y0)
  foreach($z in @(0x1D,0x76,0x30,0x00)){ $out.Add([byte]$z) }
  $out.Add([byte]($bpr -band 0xFF)); $out.Add([byte]([math]::Floor($bpr/256)))
  $out.Add([byte]($rows -band 0xFF)); $out.Add([byte]([math]::Floor($rows/256)))
  for($yy=0;$yy -lt $rows;$yy++){ $row=$y0+$yy
    for($b=0;$b -lt $bpr;$b++){ $v=0
      for($bit=0;$bit -lt 8;$bit++){ $x=$b*8+$bit; if($x -lt $W){ $px=$c.GetPixel($x,$row); if(((($px.R+$px.G+$px.B)/3)) -lt 160){ $v=$v -bor (0x80 -shr $bit) } } }
      $out.Add([byte]$v) } } }
foreach($z in @(0x1B,0x61,0x00)){ $out.Add([byte]$z) } # reset alineacion
[IO.File]::WriteAllBytes("src-tauri/assets/logo.escpos",$out.ToArray())
"logo.escpos: $($out.Count) bytes"
```

Expected: crea `src-tauri/assets/logo.escpos` (~13 KB) y reporta el tamaño.

- [ ] **Step 2: Embeber el logo y agregar timbre dummy en `build`**

En `src-tauri/src/escpos.rs`, dentro de `build`, reemplazar el comentario `// (logo va aquí en Task 3)` por:

```rust
    // logo (raster pre-generado: incluye ESC a 1 ... ESC a 0)
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);
```

Y reemplazar `// (timbre SII dummy va aquí en Task 3)` por:

```rust
    // timbre SII (DUMMY v1: barras raster generadas + leyenda fija)
    nl(&mut b);
    rule(&mut b, b'-');
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    line_center(&mut b, "Timbre Electronico SII");
    timbre_dummy(&mut b);
    line_center(&mut b, "Res. 80 de 2014 - www.sii.cl");
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
```

Agregar la función `timbre_dummy` (genera un raster de barras determinista, sin libs):

```rust
fn timbre_dummy(buf: &mut Vec<u8>) {
    // raster pseudo-PDF417: 384px de ancho, 12 filas de 5px. Patron deterministico.
    let width = 384usize;
    let bpr = (width + 7) / 8;
    let row_h = 5usize;
    let rows = 12usize;
    let h = rows * row_h;
    // genera 1 bit por pixel: barras segun una secuencia deterministica
    let mut bits = vec![0u8; bpr * h];
    let mut seed: u32 = 0x1234_5;
    let mut next = || { seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345); (seed >> 16) & 0x7FFF };
    for r in 0..rows {
        let mut x = 0usize;
        // patron de inicio
        for px in 0..3 { set_bit(&mut bits, bpr, px, r*row_h, row_h, width); let _ = px; }
        x = 6;
        while x < width - 8 {
            let wd = (next() % 5 + 2) as usize;
            if next() % 2 == 1 { for k in 0..wd { if x+k < width { set_bit(&mut bits, bpr, x+k, r*row_h, row_h, width); } } }
            x += wd;
        }
        for px in (width-4)..(width-1) { set_bit(&mut bits, bpr, px, r*row_h, row_h, width); }
    }
    // emitir GS v 0 en una sola banda (h<256)
    buf.extend_from_slice(&[0x1D,0x76,0x30,0x00]);
    buf.push((bpr & 0xFF) as u8); buf.push((bpr >> 8) as u8);
    buf.push((h & 0xFF) as u8); buf.push((h >> 8) as u8);
    buf.extend_from_slice(&bits);
    nl(buf);
}

fn set_bit(bits: &mut [u8], bpr: usize, x: usize, y0: usize, row_h: usize, width: usize) {
    if x >= width { return; }
    for dy in 0..row_h {
        let idx = (y0 + dy) * bpr + (x / 8);
        if idx < bits.len() { bits[idx] |= 0x80 >> (x % 8); }
    }
}
```

- [ ] **Step 3: Correr tests (siguen pasando) y compilar**

Run: `cd src-tauri && cargo test escpos && cargo build`
Expected: PASS + compila (el `include_bytes!` encuentra el asset).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/assets/logo.escpos src-tauri/src/escpos.rs
git commit -m "feat(escpos): embed logo raster and dummy SII timbre"
```

---

### Task 4: Comando Tauri `print_receipt`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `escpos::build` (Task 1/3), `printing::send_raw` (Task 2)
- Produces: comando invocable `print_receipt(payload: ReceiptPayload) -> Result<(), String>`

- [ ] **Step 1: Implementar y registrar el comando**

En `src-tauri/src/lib.rs`, dejar el archivo así (manteniendo `greet`):

```rust
mod escpos;
mod printing;

use escpos::ReceiptPayload;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn print_receipt(payload: ReceiptPayload) -> Result<(), String> {
    let bytes = escpos::build(&payload);
    let printer = payload.negocio.printer_name.clone();
    // reintento simple ante fallo de envío
    match printing::send_raw(&printer, &bytes) {
        Ok(()) => Ok(()),
        Err(_) => printing::send_raw(&printer, &bytes),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, print_receipt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Compilar**

Run: `cd src-tauri && cargo build`
Expected: compila; el comando queda registrado.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): add print_receipt command with retry"
```

---

### Task 5: Frontend — configuración del negocio funcional (en memoria)

**Files:**
- Modify: `src/index.html`

**Interfaces:**
- Produces: estado `cfgRecibo` y bindings `{{ cr* }}` + handlers `{{ onCr* }}` usados por los inputs de Config→Recibo.

- [ ] **Step 1: Agregar estado por defecto**

En `src/index.html`, en el objeto de estado inicial (junto a `folioSeq: 443,` ~línea 1496), agregar:

```javascript
      cfgRecibo: {
        tagline: 'Vivero & Jardineria',
        razonSocial: 'Planta con Mati SpA',
        rut: '78.123.456-7',
        giro: 'Venta de plantas y jardineria',
        direccion: 'Av. Las Camelias 1234, Nunoa',
        footer: 'Gracias por tu compra!',
        printerName: 'TermalTest',
        socialRed: 'Instagram',
        socialUrl: 'https://www.instagram.com/plantaconmati',
      },
```

- [ ] **Step 2: Agregar un setter genérico**

Junto a los demás handlers (p.ej. después de `closeTicket` ~línea 1773), agregar:

```javascript
  setCfgRecibo = (field, value) => this.setState(s => ({ cfgRecibo: { ...s.cfgRecibo, [field]: value } }));
```

- [ ] **Step 3: Exponer bindings**

En el objeto que retorna el render (cerca de los demás `cfg*`, p.ej. tras `cfgModuleRows` ~línea 2133), agregar:

```javascript
      crTagline: S.cfgRecibo.tagline, onCrTagline: (e) => this.setCfgRecibo('tagline', e.target.value),
      crRazon: S.cfgRecibo.razonSocial, onCrRazon: (e) => this.setCfgRecibo('razonSocial', e.target.value),
      crRut: S.cfgRecibo.rut, onCrRut: (e) => this.setCfgRecibo('rut', e.target.value),
      crGiro: S.cfgRecibo.giro, onCrGiro: (e) => this.setCfgRecibo('giro', e.target.value),
      crDireccion: S.cfgRecibo.direccion, onCrDireccion: (e) => this.setCfgRecibo('direccion', e.target.value),
      crFooter: S.cfgRecibo.footer, onCrFooter: (e) => this.setCfgRecibo('footer', e.target.value),
      crPrinter: S.cfgRecibo.printerName, onCrPrinter: (e) => this.setCfgRecibo('printerName', e.target.value),
      crSocialRed: S.cfgRecibo.socialRed, onCrSocialRed: (e) => this.setCfgRecibo('socialRed', e.target.value),
      crSocialUrl: S.cfgRecibo.socialUrl, onCrSocialUrl: (e) => this.setCfgRecibo('socialUrl', e.target.value),
```

- [ ] **Step 4: Reemplazar los inputs estáticos de Config→Recibo**

En `src/index.html`, reemplazar el bloque `isCfgRecibo` (líneas ~903-912) por inputs ligados al estado:

```html
        <sc-if value="{{ isCfgRecibo }}" hint-placeholder-val="{{ false }}">
          <div style="background:#fff;border:1px solid #E1E5EE;border-radius:16px;padding:20px 22px;display:flex;flex-direction:column;gap:16px;">
            <div><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Bajada (bajo el logo)</label><input value="{{ crTagline }}" onInput="{{ onCrTagline }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
            <div><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Razon social</label><input value="{{ crRazon }}" onInput="{{ onCrRazon }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
            <div style="display:flex;gap:14px;">
              <div style="flex:1;"><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">RUT</label><input value="{{ crRut }}" onInput="{{ onCrRut }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
              <div style="flex:1;"><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Giro</label><input value="{{ crGiro }}" onInput="{{ onCrGiro }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
            </div>
            <div><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Direccion</label><input value="{{ crDireccion }}" onInput="{{ onCrDireccion }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
            <div><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Pie de pagina</label><input value="{{ crFooter }}" onInput="{{ onCrFooter }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
            <div style="display:flex;gap:14px;">
              <div style="flex:1;"><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Red social</label><input value="{{ crSocialRed }}" onInput="{{ onCrSocialRed }}" placeholder="Instagram" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
              <div style="flex:1;"><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">Nombre de impresora</label><input value="{{ crPrinter }}" onInput="{{ onCrPrinter }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
            </div>
            <div><label style="display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px;">URL de la red social (para el QR)</label><input value="{{ crSocialUrl }}" onInput="{{ onCrSocialUrl }}" placeholder="https://..." style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
          </div>
        </sc-if>
```

- [ ] **Step 5: Verificar en dev**

Run: `pnpm tauri dev`
Expected: la pantalla Configuración → "Recibo y datos fiscales" muestra los campos y se pueden editar (el valor se mantiene al tipear).

- [ ] **Step 6: Commit**

```bash
git add src/index.html
git commit -m "feat(config): editable business receipt settings (in-memory)"
```

---

### Task 6: Frontend — helper `printReceipt` (invoke + fallback)

**Files:**
- Modify: `src/index.html`

**Interfaces:**
- Consumes: comando Tauri `print_receipt` (Task 4), estado `cfgRecibo` (Task 5), objeto `sale` (de `confirmPay`).
- Produces: método `this.printReceipt(sale)`.

- [ ] **Step 1: Implementar el helper**

En `src/index.html`, junto a los handlers de ticket (después de `printTicket` ~línea 1774), agregar:

```javascript
  buildReceiptPayload = (sale) => {
    const cr = this.state.cfgRecibo;
    const social = (cr.socialUrl && cr.socialUrl.trim())
      ? { red: cr.socialRed || 'Redes', url: cr.socialUrl.trim(), etiqueta: cr.socialUrl.replace(/^https?:\/\/(www\.)?/, '') }
      : null;
    return {
      negocio: {
        tagline: cr.tagline, razon_social: cr.razonSocial, rut: cr.rut,
        giro: cr.giro, direccion: cr.direccion, footer: cr.footer,
        printer_name: cr.printerName, social,
      },
      folio: sale.folio,
      fecha: sale.date, hora: sale.time,
      items: sale.lines.map(l => ({ nombre: l.name, qty: l.qty, precio: l.price })),
      neto: sale.neto, iva: sale.iva, total: sale.total,
      metodo: sale.method,
      open_drawer: sale.method === 'efectivo',
    };
  };

  printReceipt = (sale) => {
    const tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.invoke === 'function') {
      tauri.core.invoke('print_receipt', { payload: this.buildReceiptPayload(sale) })
        .catch(err => console.error('print_receipt:', err));
    } else {
      try { window.print(); } catch (e) {}   // fallback navegador (preview)
    }
  };
```

- [ ] **Step 2: Verificar que compila/corre**

Run: `pnpm tauri dev`
Expected: arranca sin errores de JS (revisar consola devtools). Aún no se llama a `printReceipt`.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(print): printReceipt helper (Tauri invoke + browser fallback)"
```

---

### Task 7: Frontend — cablear auto-impresión y reimpresión + verificación en hardware

**Files:**
- Modify: `src/index.html`

**Interfaces:**
- Consumes: `this.printReceipt` (Task 6), `confirmPay`/`printTicket` (existentes).

- [ ] **Step 1: Auto-imprimir al confirmar el cobro**

En `confirmPay` (~línea 1769), reemplazar la línea final `this.setState({ ... });` por una versión que imprime tras fijar el estado:

```javascript
    this.setState({ products, customers, sales: [sale, ...this.state.sales], folioSeq: folio + 1, cart: [], payOpen: false, ticket: sale, customerId: null },
      () => this.printReceipt(sale));
```

- [ ] **Step 2: El botón "Imprimir" reimprime vía térmica**

Reemplazar `printTicket` (~línea 1774):

```javascript
  printTicket = () => { if (this.state.ticket) this.printReceipt(this.state.ticket); };
```

- [ ] **Step 3: Verificación manual en hardware (Windows)**

Run: `pnpm tauri dev`
Pasos y resultado esperado:
1. Hacer una venta, "Cobrar" → método **efectivo** → "Confirmar cobro".
   → Sale la boleta completa (logo, recuadro, ítems, TOTAL, QR, timbre, corte) **y abre la gaveta**.
2. Otra venta con método **tarjeta** → "Confirmar cobro".
   → Imprime la boleta, **NO abre la gaveta**.
3. En el modal de ticket, botón **"Imprimir"** → reimprime la misma boleta.
4. Editar en Configuración→Recibo la "Bajada", la URL de la red social, etc., hacer otra venta → los cambios se reflejan en la boleta y el **QR apunta a la nueva URL**.
5. Escanear el QR → abre la URL configurada.

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat(pos): auto-print receipt on checkout, reprint from ticket, drawer on cash"
```

---

## Notas de cierre

- **Reimpresión / atascos**: si en producción aparece el atasco USB intermitente, la causa es de datos USB (ver memoria del proyecto): puerto directo + el reintento ya incluido en `print_receipt`.
- **Siguientes pasos (post-aprobación del cliente, fuera de este plan)**: timbre SII real (PDF417 + TED + CAF), acentos (code page o texto raster), persistencia de configuración, selector de impresoras en la UI, y traslado del estado en memoria a backend/DB cuando se construya la lógica de negocio.
