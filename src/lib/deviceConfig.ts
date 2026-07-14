/** Ajuste local del equipo: si está activo, este dispositivo NO imprime comprobantes
 *  automáticamente (solo cobra y emite). Patrón idéntico a printerConfig.ts. */
const KEY = "kromi.skipPrint";

export function getSkipPrint(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setSkipPrint(v: boolean): void {
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* noop */ }
}
