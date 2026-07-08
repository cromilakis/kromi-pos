/**
 * Nombre de la impresora de boletas, configurable por el usuario y persistido localmente.
 * Se envía como `printer_name` a los comandos de impresión (Rust). Vacío = impresora
 * predeterminada del sistema. (Provisional hasta que exista el módulo de Configuración.)
 */
const KEY = "kromi.printerName";

export function getPrinterName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPrinterName(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    /* no-op: entorno sin localStorage */
  }
}
