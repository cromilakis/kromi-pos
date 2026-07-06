mod escpos;
mod printing;

use escpos::{CierrePayload, QuotePayload, ReceiptPayload};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, print_receipt, print_cierre, print_quote])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
