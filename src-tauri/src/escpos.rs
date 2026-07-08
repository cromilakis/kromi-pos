use serde::Deserialize;

#[derive(Deserialize, Clone)]
pub struct Social { #[allow(dead_code)] pub red: String, pub url: String, pub etiqueta: String }

#[derive(Deserialize, Clone)]
pub struct Negocio {
    #[serde(default)] pub nombre_comercial: String,
    pub razon_social: String,
    pub rut: String,
    pub giro: String,
    pub direccion: String,
    pub footer: String,
    pub printer_name: String,
    pub social: Option<Social>,
}

#[derive(Deserialize, Clone)]
pub struct Item { pub nombre: String, pub qty: u32, pub precio: i64, #[serde(default)] pub descuento: i64 }

#[derive(Deserialize, Clone)]
pub struct ReceiptPayload {
    pub negocio: Negocio,
    #[allow(dead_code)] pub folio: u32,
    pub fecha: String,
    pub hora: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
    pub descuento: i64,
    #[serde(default)] pub dte_folio: Option<u32>,
    #[serde(default)] pub timbre_png: Option<String>,
    #[serde(default)] pub reimpresion: bool,
    pub metodo: String,
    pub open_drawer: bool,
}

#[derive(Deserialize, Clone)]
pub struct QuotePayload {
    pub negocio: Negocio,
    pub folio: u32,
    pub fecha: String,
    pub valido_hasta: String,
    pub cliente: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
}

#[derive(Deserialize, Clone)]
pub struct CreditNotePayload {
    pub negocio: Negocio,
    pub folio: u32,
    pub fecha: String,
    pub hora: String,
    pub sale_folio: Option<u32>,
    pub metodo: String,
    pub motivo: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
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
    if n < 0 { format!("-${}", out) } else { format!("${}", out) }
}

/** Etiqueta de la forma de pago con mayúscula inicial (Efectivo / Tarjeta). */
fn metodo_label(m: &str) -> String {
    match m {
        "efectivo" => "Efectivo".to_string(),
        "tarjeta" => "Tarjeta".to_string(),
        other => {
            let mut c = other.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        }
    }
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

#[allow(dead_code)]
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
        // patron de inicio
        for px in 0..3 { set_bit(&mut bits, bpr, px, r*row_h, row_h, width); let _ = px; }
        let mut x = 6usize;
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

/// Imprime un PNG (base64) como raster monocromo ESC/POS (GS v 0), por bandas de
/// hasta 255 filas. Devuelve false si el base64/PNG es inválido.
fn timbre_png(buf: &mut Vec<u8>, b64: &str) -> bool {
    use base64::Engine;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(b64.trim()) { Ok(b) => b, Err(_) => return false };
    let img = match image::load_from_memory(&bytes) { Ok(i) => i.to_luma8(), Err(_) => return false };
    let (w, h) = img.dimensions();
    let bpr = ((w + 7) / 8) as usize;
    let mut bits = vec![0u8; bpr * h as usize];
    for y in 0..h {
        for x in 0..w {
            if img.get_pixel(x, y).0[0] < 128 {
                bits[y as usize * bpr + (x / 8) as usize] |= 0x80 >> (x % 8);
            }
        }
    }
    let mut y0 = 0u32;
    while y0 < h {
        let band = (h - y0).min(255);
        buf.extend_from_slice(&[0x1D, 0x76, 0x30, 0x00]);
        buf.push((bpr & 0xFF) as u8); buf.push((bpr >> 8) as u8);
        buf.push((band & 0xFF) as u8); buf.push((band >> 8) as u8);
        let start = y0 as usize * bpr;
        let end = start + band as usize * bpr;
        buf.extend_from_slice(&bits[start..end]);
        y0 += band;
    }
    nl(buf);
    true
}

#[allow(dead_code)]
fn set_bit(bits: &mut [u8], bpr: usize, x: usize, y0: usize, row_h: usize, width: usize) {
    if x >= width { return; }
    for dy in 0..row_h {
        let idx = (y0 + dy) * bpr + (x / 8);
        if idx < bits.len() { bits[idx] |= 0x80 >> (x % 8); }
    }
}

pub fn build(p: &ReceiptPayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]); // init

    // logo (raster pre-generado: incluye ESC a 1 ... ESC a 0)
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);

    // tagline + emisor (centrado)
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    if !p.negocio.nombre_comercial.is_empty() { line_center(&mut b, &format!("* {} *", p.negocio.nombre_comercial)); }
    line_center(&mut b, &p.negocio.razon_social);
    line_center(&mut b, &p.negocio.giro);
    line_center(&mut b, &p.negocio.direccion);
    nl(&mut b);

    // recuadro de folio — número del SII si la boleta ya fue emitida; si no, PENDIENTE.
    let folio_txt = match p.dte_folio {
        Some(f) => format!("No {}", f),
        None => "PENDIENTE DE EMISION".to_string(),
    };
    box_ascii(&mut b, &[
        &format!("R.U.T.: {}", p.negocio.rut),
        "BOLETA ELECTRONICA",
        &folio_txt,
    ], 32);
    nl(&mut b);
    if p.reimpresion {
        b.extend_from_slice(&[0x1B, 0x61, 0x01]);
        push_text(&mut b, "** REIMPRESION **"); nl(&mut b);
        b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    }

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
        if it.descuento > 0 {
            let base = it.precio * it.qty as i64;
            let pct = if base > 0 { ((it.descuento as f64 * 100.0) / base as f64).round() as i64 } else { 0 };
            line_lr(&mut b, &format!("   Descuento {}%", pct), &format!("-{}", money(it.descuento)), COL);
        }
    }
    rule(&mut b, b'=');

    // totales — orden: Neto, Descuento (si aplica) y luego IVA, para que se lea Total → Descuento → IVA.
    line_lr(&mut b, "Neto", &money(p.neto), COL);
    if p.descuento > 0 {
        line_lr(&mut b, "Descuento", &format!("-{}", money(p.descuento)), COL);
    }
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    nl(&mut b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]); // doble tamano
    line_lr(&mut b, "TOTAL", &money(p.total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(&mut b);
    line_lr(&mut b, "Forma de pago", &metodo_label(&p.metodo), COL);
    rule(&mut b, b'-');

    // red social (QR) — solo si esta configurada
    if let Some(s) = &p.negocio.social {
        b.extend_from_slice(&[0x1B, 0x61, 0x01]);
        push_text(&mut b, "Siguenos en redes sociales"); nl(&mut b);
        qr_native(&mut b, &s.url);
        nl(&mut b);
        push_text(&mut b, &s.etiqueta); nl(&mut b);
        b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    }
    nl(&mut b);

    // pie
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    // timbre SII: si hay timbre real (PNG de SimpleFactura) se imprime como raster;
    // si no, la boleta está pendiente de emisión.
    nl(&mut b);
    rule(&mut b, b'-');
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    match &p.timbre_png {
        Some(png) if timbre_png(&mut b, png) => {
            push_text(&mut b, "Timbre Electronico SII"); nl(&mut b);
            push_text(&mut b, "Res. 80 de 2014 - www.sii.cl"); nl(&mut b);
        }
        _ => { push_text(&mut b, "BOLETA PENDIENTE DE EMISION"); nl(&mut b); }
    }
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    // gaveta solo en efectivo — ANTES del corte, para que el pulso salga con el
    // documento actual y no quede retenido en el buffer hasta el siguiente ticket.
    if p.open_drawer {
        b.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
    }

    // feed + corte con avance integrado (GS V 66 n): alimenta n puntos y corta.
    // El avance empuja el buffer de línea de la impresora para que imprima y corte
    // este ticket en el acto (evita que el corte quede pendiente al siguiente job).
    b.extend_from_slice(&[0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x60]);
    b
}

#[derive(Deserialize, Clone)]
pub struct CierrePayload {
    pub negocio: Negocio,
    pub fecha: String,
    pub cajero: String,
    pub apertura: String,
    pub cierre: String,
    pub ventas: u32,
    pub cash: i64,
    pub card: i64,
    pub fondo: i64,
    pub contado: i64,
    pub nc_cash: i64,
    pub nc_card: i64,
}

pub fn build_cierre(p: &CierrePayload) -> Vec<u8> {
    let total = p.cash + p.card;
    let esperado = p.fondo + p.cash - p.nc_cash;
    let diff = p.contado - esperado;
    let pct = if esperado != 0 { (diff as f64) / (esperado as f64) * 100.0 } else { 0.0 };
    let estado = if diff == 0 {
        "CUADRADO (exacto)".to_string()
    } else if diff > 0 {
        format!("SOBRANTE +{:.1}%", pct.abs()).replace('.', ",")
    } else {
        format!("FALTANTE -{:.1}%", pct.abs()).replace('.', ",")
    };

    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]); // init

    // logo (mismo raster pre-generado que la boleta)
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);

    // tagline + emisor (centrado)
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    if !p.negocio.nombre_comercial.is_empty() { line_center(&mut b, &format!("* {} *", p.negocio.nombre_comercial)); }
    line_center(&mut b, &p.negocio.razon_social);
    nl(&mut b);

    // recuadro de titulo
    box_ascii(&mut b, &[
        "COMPROBANTE DE CIERRE",
        "Arqueo de caja",
    ], 32);
    nl(&mut b);

    // datos del turno
    push_text(&mut b, &format!("Fecha:    {}", p.fecha)); nl(&mut b);
    push_text(&mut b, &format!("Cajero:   {}", p.cajero)); nl(&mut b);
    line_lr(&mut b, &format!("Apertura: {}", p.apertura), &format!("Cierre: {}", p.cierre), COL);
    rule(&mut b, b'-');

    // ventas del turno
    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    push_text(&mut b, "VENTAS DEL TURNO"); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    line_lr(&mut b, "Numero de ventas", &p.ventas.to_string(), COL);
    line_lr(&mut b, "Total vendido", &money(total), COL);
    line_lr(&mut b, "  Efectivo", &money(p.cash), COL);
    line_lr(&mut b, "  Tarjeta", &money(p.card), COL);
    rule(&mut b, b'=');

    // arqueo de efectivo
    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    push_text(&mut b, "ARQUEO DE EFECTIVO"); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    line_lr(&mut b, "Fondo de apertura", &money(p.fondo), COL);
    line_lr(&mut b, "Ventas en efectivo", &money(p.cash), COL);
    if p.nc_cash != 0 { line_lr(&mut b, "Notas de credito (efectivo)", &format!("-{}", money(p.nc_cash)), COL); }
    if p.nc_card != 0 { line_lr(&mut b, "Reversos tarjeta", &format!("-{}", money(p.nc_card)), COL); }
    line_lr(&mut b, "Esperado en caja", &money(esperado), COL);
    line_lr(&mut b, "Efectivo contado", &money(p.contado), COL);
    rule(&mut b, b'-');

    // diferencia (resaltada)
    b.extend_from_slice(&[0x1D, 0x21, 0x01]); // doble alto
    line_lr(&mut b, "DIFERENCIA", &format!("{}{}", if diff > 0 { "+" } else { "" }, money(diff)), COL);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    push_text(&mut b, &format!("Estado: {}", estado)); nl(&mut b);
    rule(&mut b, b'=');
    nl(&mut b);

    // firma
    push_text(&mut b, "Firma cajero:"); nl(&mut b); nl(&mut b);
    push_text(&mut b, "________________________________"); nl(&mut b);
    nl(&mut b);

    // pie
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    // feed + corte (sin gaveta, sin timbre SII: no es documento tributario)
    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x60]);
    b
}

pub fn build_quote(p: &QuotePayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]); // init
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);

    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    if !p.negocio.nombre_comercial.is_empty() { line_center(&mut b, &format!("* {} *", p.negocio.nombre_comercial)); }
    line_center(&mut b, &p.negocio.razon_social);
    line_center(&mut b, &p.negocio.giro);
    nl(&mut b);

    box_ascii(&mut b, &[
        &format!("R.U.T.: {}", p.negocio.rut),
        "COTIZACION",
        &format!("No {}", p.folio),
    ], 32);
    nl(&mut b);

    push_text(&mut b, &format!("Fecha: {}", p.fecha)); nl(&mut b);
    push_text(&mut b, &format!("Valido hasta: {}", p.valido_hasta)); nl(&mut b);
    push_text(&mut b, &format!("Cliente: {}", p.cliente)); nl(&mut b);
    rule(&mut b, b'-');

    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    line_lr(&mut b, "Item", "Subtotal", COL);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    rule(&mut b, b'=');
    for it in &p.items {
        line_lr(&mut b, &it.nombre, &money(it.precio * it.qty as i64), COL);
        push_text(&mut b, &format!("   {} x {}", it.qty, money(it.precio))); nl(&mut b);
    }
    rule(&mut b, b'=');

    line_lr(&mut b, "Neto", &money(p.neto), COL);
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    nl(&mut b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]);
    line_lr(&mut b, "TOTAL", &money(p.total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(&mut b);
    rule(&mut b, b'-');
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, "Documento no tributario"); nl(&mut b);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x60]); // corte, sin gaveta
    b
}

pub fn build_credit_note(p: &CreditNotePayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]);
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    if !p.negocio.nombre_comercial.is_empty() { line_center(&mut b, &format!("* {} *", p.negocio.nombre_comercial)); }
    line_center(&mut b, &p.negocio.razon_social);
    nl(&mut b);

    box_ascii(&mut b, &[
        &format!("R.U.T.: {}", p.negocio.rut),
        "NOTA DE CREDITO",
        &format!("No {}", p.folio),
    ], 32);
    nl(&mut b);

    push_text(&mut b, &format!("Fecha: {} {}", p.fecha, p.hora)); nl(&mut b);
    if let Some(sf) = p.sale_folio {
        push_text(&mut b, &format!("Ref. boleta: {}", sf)); nl(&mut b);
    }
    push_text(&mut b, &format!("Motivo: {}", p.motivo)); nl(&mut b);
    rule(&mut b, b'-');

    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    line_lr(&mut b, "Item", "Subtotal", COL);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    rule(&mut b, b'=');
    for it in &p.items {
        line_lr(&mut b, &it.nombre, &money(it.precio * it.qty as i64), COL);
        push_text(&mut b, &format!("   {} x {}", it.qty, money(it.precio))); nl(&mut b);
    }
    rule(&mut b, b'=');

    line_lr(&mut b, "Neto", &money(p.neto), COL);
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    nl(&mut b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]);
    line_lr(&mut b, "DEVOLUCION", &money(p.total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(&mut b);
    line_lr(&mut b, "Medio de devolucion", &metodo_label(&p.metodo), COL);
    rule(&mut b, b'-');

    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, "Documento no tributario"); nl(&mut b);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x60]);
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(metodo: &str, drawer: bool) -> ReceiptPayload {
        ReceiptPayload {
            negocio: Negocio {
                nombre_comercial: "Planta con Mati".into(),
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
            items: vec![Item { nombre: "Echeveria".into(), qty: 1, precio: 3990, descuento: 0 }],
            neto: 3353, iva: 637, total: 3990, descuento: 0,
            dte_folio: None, timbre_png: None, reimpresion: false,
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
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x60]));    // corte
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

    fn sample_cierre(contado: i64) -> CierrePayload {
        let s = sample("efectivo", true);
        CierrePayload {
            negocio: s.negocio,
            fecha: "28/06/2026".into(),
            cajero: "M. Jara".into(),
            apertura: "09:00".into(),
            cierre: "20:10".into(),
            ventas: 16,
            cash: 142300,
            card: 98000,
            fondo: 50000,
            contado,
            nc_cash: 0,
            nc_card: 0,
        }
    }

    #[test]
    fn cierre_init_corte_y_sin_gaveta() {
        let b = build_cierre(&sample_cierre(192300));
        assert_eq!(&b[0..2], &[0x1B, 0x40]);              // ESC @
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x60])); // corte
        // un cierre NO debe abrir la gaveta
        assert!(!contains(&b, &[0x1B, 0x70, 0x00, 0x19, 0xFA]));
    }

    #[test]
    fn cierre_incluye_textos_y_arqueo() {
        let b = build_cierre(&sample_cierre(192300));
        assert!(contains(&b, b"COMPROBANTE DE CIERRE"));
        assert!(contains(&b, b"M. Jara"));
        assert!(contains(&b, b"ARQUEO DE EFECTIVO"));
        assert!(contains(&b, b"DIFERENCIA"));
        // esperado = 50000 + 142300 = 192300; contado igual => CUADRADO
        assert!(contains(&b, b"CUADRADO (exacto)"));
    }

    #[test]
    fn cierre_estado_segun_diferencia() {
        // contado > esperado => SOBRANTE
        assert!(contains(&build_cierre(&sample_cierre(200000)), b"SOBRANTE"));
        // contado < esperado => FALTANTE
        assert!(contains(&build_cierre(&sample_cierre(180000)), b"FALTANTE"));
    }

    #[test]
    fn cierre_no_incluye_timbre_ni_qr() {
        let b = build_cierre(&sample_cierre(192300));
        assert!(!contains(&b, &[0x1D, 0x28, 0x6B])); // sin QR
    }

    #[test]
    fn cierre_incluye_notas_credito_y_ajusta_esperado() {
        let mut p = sample_cierre(0);
        p.nc_cash = 10000;
        p.nc_card = 0;
        // esperado = fondo(50000) + cash(142300) - nc_cash(10000) = 182300
        p.contado = 182300;
        let b = build_cierre(&p);
        assert!(contains(&b, b"Notas de credito"));
        assert!(contains(&b, b"CUADRADO (exacto)"));
    }

    fn sample_quote() -> QuotePayload {
        let s = sample("efectivo", true);
        QuotePayload {
            negocio: s.negocio,
            folio: 1001,
            fecha: "06/07/2026".into(),
            valido_hasta: "13/07/2026".into(),
            cliente: "Juan Pérez".into(),
            items: vec![Item { nombre: "Monstera".into(), qty: 2, precio: 14990, descuento: 0 }],
            neto: 25193, iva: 4787, total: 29980,
        }
    }

    #[test]
    fn quote_init_corte_sin_gaveta_sin_timbre() {
        let b = build_quote(&sample_quote());
        assert_eq!(&b[0..2], &[0x1B, 0x40]);
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x60]));                 // corte
        assert!(!contains(&b, &[0x1B, 0x70, 0x00, 0x19, 0xFA]));         // sin gaveta
        assert!(!contains(&b, &[0x1D, 0x28, 0x6B]));                     // sin QR/timbre
    }

    #[test]
    fn quote_incluye_textos() {
        let b = build_quote(&sample_quote());
        assert!(contains(&b, b"COTIZACION"));
        assert!(contains(&b, b"No 1001"));
        assert!(contains(&b, b"Valido hasta: 13/07/2026"));
        assert!(contains(&b, b"Monstera"));
        assert!(contains(&b, b"TOTAL"));
    }

    fn sample_nc() -> CreditNotePayload {
        let s = sample("efectivo", true);
        CreditNotePayload {
            negocio: s.negocio,
            folio: 501,
            fecha: "06/07/2026".into(), hora: "16:20".into(),
            sale_folio: Some(438),
            metodo: "efectivo".into(),
            motivo: "Producto defectuoso".into(),
            items: vec![Item { nombre: "Sansevieria".into(), qty: 1, precio: 9990, descuento: 0 }],
            neto: 8395, iva: 1595, total: 9990,
        }
    }

    #[test]
    fn nc_init_corte_sin_gaveta() {
        let b = build_credit_note(&sample_nc());
        assert_eq!(&b[0..2], &[0x1B, 0x40]);
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x60]));
        assert!(!contains(&b, &[0x1B, 0x70, 0x00, 0x19, 0xFA])); // sin gaveta
    }

    #[test]
    fn nc_incluye_textos() {
        let b = build_credit_note(&sample_nc());
        assert!(contains(&b, b"NOTA DE CREDITO"));
        assert!(contains(&b, b"No 501"));
        assert!(contains(&b, b"Ref. boleta: 438"));
        assert!(contains(&b, b"Sansevieria"));
        assert!(contains(&b, b"Producto defectuoso"));
    }
}
