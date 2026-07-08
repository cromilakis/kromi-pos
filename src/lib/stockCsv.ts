export interface StockMatchRow {
  id: string;
  name: string;
  internal_code: string;
  current: number;
  add: number;
  next: number;
}
export interface StockMatchResult {
  rows: StockMatchRow[];
  unknown: string[];
}

/** Parsea un CSV simple `codigo,cantidad` (separador , o ;). Ignora un encabezado
 *  cuya segunda celda no sea numérica. Cantidad se parsea como entero. */
export function parseStockCsv(text: string): { codigo: string; cantidad: number }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: { codigo: string; cantidad: number }[] = [];
  lines.forEach((line, i) => {
    const cells = line.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && Number.isNaN(parseInt(cells[1], 10))) return; // encabezado
    if (cells.length < 2) return;
    out.push({ codigo: cells[0], cantidad: parseInt(cells[1], 10) });
  });
  return out;
}

/** Empareja las filas del CSV a productos por `internal_code`, sumando cantidades
 *  del mismo código. Ignora cantidades <= 0 y códigos vacíos. Los códigos sin
 *  producto (o que solo matchean internal_code null) van a `unknown` sin duplicar. */
export function matchStockRows(
  entries: { codigo: string; cantidad: number }[],
  products: { id: string; name: string; internal_code: string | null; stock: number }[],
): StockMatchResult {
  const byCode = new Map<string, { id: string; name: string; internal_code: string; stock: number }>();
  for (const p of products) {
    if (p.internal_code) byCode.set(p.internal_code, { id: p.id, name: p.name, internal_code: p.internal_code, stock: p.stock });
  }
  const adds = new Map<string, number>();
  const unknownSet = new Set<string>();
  for (const en of entries) {
    if (!en.codigo || !(en.cantidad > 0)) continue;
    if (!byCode.has(en.codigo)) {
      unknownSet.add(en.codigo);
      continue;
    }
    adds.set(en.codigo, (adds.get(en.codigo) ?? 0) + en.cantidad);
  }
  const rows: StockMatchRow[] = [...adds.entries()].map(([code, add]) => {
    const p = byCode.get(code)!;
    return { id: p.id, name: p.name, internal_code: p.internal_code, current: p.stock, add, next: p.stock + add };
  });
  return { rows, unknown: [...unknownSet] };
}
