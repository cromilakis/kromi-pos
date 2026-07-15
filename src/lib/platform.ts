/** Detección de plataforma para la webview de Tauri.
 *  En Android (Tauri móvil) el userAgent contiene "Android". */
export const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
