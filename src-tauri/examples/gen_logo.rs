use std::fs::File;
use std::io::Write;

fn main() {
    // public/logo.png es en realidad JPEG; with_guessed_format() lo detecta por magic bytes.
    let reader = image::ImageReader::open("../public/logo.png")
        .expect("abrir ../public/logo.png")
        .with_guessed_format()
        .expect("detectar formato");
    let src = reader.decode().expect("decodificar").to_luma8();
    let (w, h) = src.dimensions();

    let target_w: u32 = 160;
    let target_h: u32 = (h as f32 * target_w as f32 / w as f32).round() as u32;
    let small = image::imageops::resize(&src, target_w, target_h, image::imageops::FilterType::Lanczos3);

    let bpr = ((target_w + 7) / 8) as usize;
    let mut bits = vec![0u8; bpr * target_h as usize];
    for y in 0..target_h {
        for x in 0..target_w {
            if small.get_pixel(x, y).0[0] < 128 {
                bits[y as usize * bpr + (x / 8) as usize] |= 0x80 >> (x % 8);
            }
        }
    }

    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(&[0x1B, 0x61, 0x01]); // ESC a 1 (centrar)
    let mut y0 = 0u32;
    while y0 < target_h {
        let band = (target_h - y0).min(255);
        out.extend_from_slice(&[0x1D, 0x76, 0x30, 0x00]);
        out.push((bpr & 0xFF) as u8);
        out.push((bpr >> 8) as u8);
        out.push((band & 0xFF) as u8);
        out.push((band >> 8) as u8);
        let start = y0 as usize * bpr;
        let end = start + band as usize * bpr;
        out.extend_from_slice(&bits[start..end]);
        y0 += band;
    }
    out.extend_from_slice(&[0x1B, 0x61, 0x00]); // ESC a 0

    File::create("assets/logo.escpos").expect("crear logo.escpos").write_all(&out).expect("escribir");
    small.save("assets/logo_preview.png").expect("guardar preview");
    eprintln!("logo.escpos: {}x{} px, {} bytes (antes ~12.5KB)", target_w, target_h, out.len());
}
