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

pub fn build(p: &ReceiptPayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]); // init

    // logo (raster pre-generado: incluye ESC a 1 ... ESC a 0)
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);

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

    // timbre SII (DUMMY v1: barras raster generadas + leyenda fija)
    nl(&mut b);
    rule(&mut b, b'-');
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    line_center(&mut b, "Timbre Electronico SII");
    timbre_dummy(&mut b);
    line_center(&mut b, "Res. 80 de 2014 - www.sii.cl");
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    // feed + corte
    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]);

    // gaveta solo en efectivo
    if p.open_drawer {
        b.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
    }
    b
}

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
