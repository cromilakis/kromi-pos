/** Inyecta el color de acento del negocio como CSS var --accent en :root. */
export function applyAccent(hex: string | null | undefined): void {
  if (!hex) return;
  document.documentElement.style.setProperty("--accent", hex);
}
