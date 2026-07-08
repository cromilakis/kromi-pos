/** Paleta de colores para categorías. Cada color base (dot) deriva sus tonos suaves
 *  (tile de fondo, pill_bg y pill_fg de la etiqueta) de forma consistente, para que
 *  toda la paleta combine con el diseño sin ajustar tono por tono a mano. */

export interface CategoryColor {
  dot: string;
  tile: string;
  pill_bg: string;
  pill_fg: string;
}

/** Colores base curados (18), distinguibles entre sí. */
const DOTS = [
  "#22C463", "#3B82C4", "#DD5771", "#DEA35D", "#7764E0", "#159A8C",
  "#E0862F", "#9C4F86", "#5a8f3c", "#2FA8C7", "#C2693C", "#5B6AD0",
  "#C9A227", "#D65DB1", "#6B8BA4", "#7BAF3A", "#E0574C", "#8a7a4a",
];

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Mezcla el color con blanco. `w` = fracción de blanco (0 = color puro, 1 = blanco). */
function mixWhite(hex: string, w: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * w, g + (255 - g) * w, b + (255 - b) * w);
}

/** Oscurece el color hacia negro. `k` = fracción de negro (0 = color puro, 1 = negro). */
function darken(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - k), g * (1 - k), b * (1 - k));
}

export const PALETTE: CategoryColor[] = DOTS.map((dot) => ({
  dot: dot.toLowerCase(),
  tile: mixWhite(dot, 0.88),
  pill_bg: mixWhite(dot, 0.8),
  pill_fg: darken(dot, 0.45),
}));
