/// Envía bytes RAW a una impresora por nombre.
/// Windows: vía winspool (OpenPrinterW / StartDocPrinterW / WritePrinter …).
/// macOS/Linux: vía CUPS `lp -d <printer> -o raw`.

#[cfg(windows)]
fn default_printer() -> Result<String, String> {
    use windows::core::PWSTR;
    use windows::Win32::Graphics::Printing::GetDefaultPrinterW;

    unsafe {
        // Primera llamada con buffer nulo: devuelve el tamaño requerido (en chars).
        let mut needed: u32 = 0;
        let _ = GetDefaultPrinterW(None, &mut needed);
        if needed == 0 {
            return Err("No hay impresora predeterminada configurada en el sistema.".into());
        }
        let mut buf = vec![0u16; needed as usize];
        if !GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut needed).as_bool() {
            return Err("No se pudo obtener la impresora predeterminada.".into());
        }
        // `needed` incluye el terminador null.
        let end = needed.saturating_sub(1) as usize;
        Ok(String::from_utf16_lossy(&buf[..end]))
    }
}

#[cfg(windows)]
pub fn send_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, DOC_INFO_1W, EndDocPrinter, EndPagePrinter, OpenPrinterW,
        StartDocPrinterW, StartPagePrinter, WritePrinter, PRINTER_HANDLE,
    };

    // Convierte &str a Vec<u16> terminado en null (requerido por las APIs W).
    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    // Sin nombre configurado: usa la impresora predeterminada del sistema.
    let printer = if printer.trim().is_empty() {
        default_printer()?
    } else {
        printer.to_string()
    };

    unsafe {
        // Abre el handle de la impresora.
        let mut hprinter = PRINTER_HANDLE::default();
        let name_wide = to_wide(&printer);
        OpenPrinterW(PCWSTR(name_wide.as_ptr()), &mut hprinter, None)
            .map_err(|e| format!("OpenPrinter: {e}"))?;

        // Prepara el descriptor del documento RAW.
        let mut doc_name = to_wide("Boleta");
        let mut datatype = to_wide("RAW");
        let di = DOC_INFO_1W {
            pDocName: windows::core::PWSTR(doc_name.as_mut_ptr()),
            pOutputFile: windows::core::PWSTR::null(),
            pDatatype: windows::core::PWSTR(datatype.as_mut_ptr()),
        };

        // Inicia el trabajo de impresión (nivel 1 = DOC_INFO_1W).
        let job = StartDocPrinterW(hprinter, 1, &di as *const DOC_INFO_1W);
        if job == 0 {
            let _ = ClosePrinter(hprinter);
            return Err("StartDocPrinter fallo".into());
        }

        let mut result = Ok(());

        if StartPagePrinter(hprinter).as_bool() {
            let mut written: u32 = 0;
            let ok = WritePrinter(
                hprinter,
                data.as_ptr() as *const core::ffi::c_void,
                data.len() as u32,
                &mut written,
            )
            .as_bool();

            if !ok || (written as usize) != data.len() {
                result = Err(format!(
                    "WritePrinter: escritos {written}/{}",
                    data.len()
                ));
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

    let mut cmd = Command::new("lp");
    // Sin nombre configurado: usa el destino predeterminado de CUPS (sin `-d`).
    if printer.trim().is_empty() {
        cmd.args(["-o", "raw"]);
    } else {
        cmd.args(["-d", printer, "-o", "raw"]);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("lp spawn: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or("lp: sin stdin")?
        .write_all(data)
        .map_err(|e| format!("lp write: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("lp wait: {e}"))?;

    if out.status.success() {
        Ok(())
    } else {
        Err(format!("lp: {}", String::from_utf8_lossy(&out.stderr)))
    }
}
