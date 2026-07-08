mod escpos;
mod printing;

use escpos::{CierrePayload, CreditNotePayload, QuotePayload, ReceiptPayload};

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

#[tauri::command]
fn print_cierre(payload: CierrePayload) -> Result<(), String> {
    let bytes = escpos::build_cierre(&payload);
    let printer = payload.negocio.printer_name.clone();
    // reintento simple ante fallo de envío
    match printing::send_raw(&printer, &bytes) {
        Ok(()) => Ok(()),
        Err(_) => printing::send_raw(&printer, &bytes),
    }
}

#[tauri::command]
fn print_quote(payload: QuotePayload) -> Result<(), String> {
    let bytes = escpos::build_quote(&payload);
    let printer = payload.negocio.printer_name.clone();
    match printing::send_raw(&printer, &bytes) {
        Ok(()) => Ok(()),
        Err(_) => printing::send_raw(&printer, &bytes),
    }
}

#[tauri::command]
fn print_credit_note(payload: CreditNotePayload) -> Result<(), String> {
    let bytes = escpos::build_credit_note(&payload);
    let printer = payload.negocio.printer_name.clone();
    match printing::send_raw(&printer, &bytes) {
        Ok(()) => Ok(()),
        Err(_) => printing::send_raw(&printer, &bytes),
    }
}

/// Escribe bytes en la ruta elegida por el usuario en el diálogo "Guardar como".
/// Usar un comando propio evita configurar el scope de tauri-plugin-fs para rutas arbitrarias.
#[tauri::command]
fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, print_receipt, print_cierre, print_quote, print_credit_note, save_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
