// Vista previa en texto del ticket (layout de totales). Corre con CWD=src-tauri/.
// cargo run --example preview_receipt
use _kromi_tauri_scaffold_lib::escpos::{build, Item, Negocio, ReceiptPayload, Social};

fn main() {
    let p = ReceiptPayload {
        negocio: Negocio {
            nombre_comercial: "Planta con Mati".into(),
            razon_social: "San Jose SpA".into(),
            rut: "78.444.692-1".into(),
            giro: "Venta al por menor de plantas".into(),
            direccion: "General Urrutia 630 local 104".into(),
            footer: "Gracias por tu compra!".into(),
            printer_name: "preview".into(),
            social: Some(Social { red: "Instagram".into(), url: "https://instagram.com/plantaconmati".into(), etiqueta: "@plantaconmati".into() }),
        },
        folio: 5012,
        fecha: "18/07/2026".into(), hora: "16:05".into(),
        items: vec![
            Item { nombre: "Suculenta grande".into(), qty: 2, precio: 5000, descuento: 1000 },
            Item { nombre: "Marantha".into(), qty: 1, precio: 8990, descuento: 0 },
        ],
        neto: 13606, iva: 2585, total: 16191, descuento: 1799,
        canje_pts: 0, canje_monto: 0,
        dte_folio: Some(5012), timbre_png: None, reimpresion: false,
        metodo: "tarjeta".into(), open_drawer: false,
        doc_type: "boleta".into(),
        recep_rut: None, recep_razon: None, recep_giro: None, recep_dir: None,
    };
    let bytes = build(&p);
    // Volcar solo texto imprimible + saltos de línea.
    for &c in &bytes {
        if c == 0x0A { println!(); }
        else if (0x20..0x7F).contains(&c) { print!("{}", c as char); }
    }
    println!();
}
