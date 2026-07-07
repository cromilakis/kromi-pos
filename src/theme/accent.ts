/** Inyecta el color de marca del negocio como CSS var --brand en :root. */
export function applyAccent(hex: string | null | undefined): void {
  if (!hex) return;
  document.documentElement.style.setProperty("--brand", hex);
}
