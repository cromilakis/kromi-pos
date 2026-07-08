# Carga de stock unificada + pantalla de facturas con filtros — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar la carga de stock (CSV + factura PDF) en una sola pantalla con arrastrar y soltar que despacha por formato, y convertir el listado de facturas en una pantalla interna con filtros.

**Architecture:** Se extrae la lógica pura de CSV y de filtrado a `src/lib` (testeable). Se crean dos vistas internas nuevas en `StockScreen` (`StockLoad` y `PurchaseInvoicesScreen`), se ajusta el data layer de facturas, y se reconecta `StockScreen` con un `view` de 3 estados, eliminando el flujo CSV inline, el modal de facturas y el `InvoiceUpload`.

**Tech Stack:** React + TypeScript + Vite, TanStack Query, Tailwind v4, Vitest, Supabase.

## Global Constraints

- Identidad de commits: autor y committer **solo** `Cromilakis <ipcromilakis@gmail.com>`. PROHIBIDO `Co-Authored-By` y atribución a Claude/Anthropic. Commitea con `git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "..."`.
- Nunca `git add -A` (rutas explícitas). No tocar `src-tauri/*` (tiene cambios preexistentes ajenos). Marca vía `var(--brand)`.
- Rama `feature/recepcion-facturas` (no crear otra).
- CSV empareja por **código interno** (`product.internal_code`). Solo suma a productos existentes.
- `OPENAI_API_KEY`/secretos nunca en cliente. Escritura crítica solo por RPC (recepción por `recepcionar_factura`; CSV usa `upsertInventory`, ya existente).
- Verificación de cada tarea: `pnpm typecheck && pnpm test && pnpm build` verdes (salvo tareas de solo-lógica que pueden usar `pnpm test`). NO ejecutar `pnpm tauri dev`.

---

### Task 1: Lógica CSV pura (`stockCsv.ts`)

**Files:**
- Create: `src/lib/stockCsv.ts`
- Create: `src/lib/stockCsv.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `parseStockCsv(text: string): { codigo: string; cantidad: number }[]`
  - `interface StockMatchRow { id: string; name: string; internal_code: string; current: number; add: number; next: number; }`
  - `interface StockMatchResult { rows: StockMatchRow[]; unknown: string[]; }`
  - `matchStockRows(entries: { codigo: string; cantidad: number }[], products: { id: string; name: string; internal_code: string | null; stock: number }[]): StockMatchResult`

- [ ] **Step 1: Escribir los tests (fallan: módulo no existe)**

Crear `src/lib/stockCsv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseStockCsv, matchStockRows } from "./stockCsv";

const products = [
  { id: "p1", name: "Ficus", internal_code: "001-ABC", stock: 5 },
  { id: "p2", name: "Cactus", internal_code: "001-XYZ", stock: 0 },
  { id: "p3", name: "Sin código", internal_code: null, stock: 3 },
];

describe("parseStockCsv", () => {
  it("ignora encabezado y parsea codigo,cantidad", () => {
    const out = parseStockCsv("codigo,cantidad\n001-ABC,3\n001-XYZ,2");
    expect(out).toEqual([{ codigo: "001-ABC", cantidad: 3 }, { codigo: "001-XYZ", cantidad: 2 }]);
  });
  it("acepta separador ; y comillas", () => {
    const out = parseStockCsv('"001-ABC";"4"');
    expect(out).toEqual([{ codigo: "001-ABC", cantidad: 4 }]);
  });
});

describe("matchStockRows", () => {
  it("empareja por internal_code y calcula next = current + add", () => {
    const r = matchStockRows([{ codigo: "001-ABC", cantidad: 3 }], products);
    expect(r.rows).toEqual([{ id: "p1", name: "Ficus", internal_code: "001-ABC", current: 5, add: 3, next: 8 }]);
    expect(r.unknown).toEqual([]);
  });
  it("suma cantidades de filas con el mismo código", () => {
    const r = matchStockRows([{ codigo: "001-ABC", cantidad: 3 }, { codigo: "001-ABC", cantidad: 2 }], products);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].add).toBe(5);
    expect(r.rows[0].next).toBe(10);
  });
  it("ignora cantidades <= 0 y códigos vacíos", () => {
    const r = matchStockRows([{ codigo: "001-ABC", cantidad: 0 }, { codigo: "", cantidad: 5 }], products);
    expect(r.rows).toEqual([]);
    expect(r.unknown).toEqual([]);
  });
  it("reporta códigos desconocidos sin duplicar y no matchea internal_code null", () => {
    const r = matchStockRows([{ codigo: "NOPE", cantidad: 1 }, { codigo: "NOPE", cantidad: 2 }], products);
    expect(r.rows).toEqual([]);
    expect(r.unknown).toEqual(["NOPE"]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd C:/Kromi/kromi-pos && pnpm test -- stockCsv`
Expected: FAIL (no existe `./stockCsv`).

- [ ] **Step 3: Implementar `src/lib/stockCsv.ts`**

```ts
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
```

- [ ] **Step 4: Correr y ver pasar**

Run: `cd C:/Kromi/kromi-pos && pnpm test -- stockCsv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stockCsv.ts src/lib/stockCsv.test.ts
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(stock): lógica pura de CSV (parseStockCsv + matchStockRows por código interno)"
```

---

### Task 2: Lógica de filtros de facturas (`invoiceFilters.ts`) + data layer

**Files:**
- Create: `src/lib/invoiceFilters.ts`
- Create: `src/lib/invoiceFilters.test.ts`
- Modify: `src/data/purchases.ts` (función `usePurchaseInvoices`)

**Interfaces:**
- Consumes: nada (la lógica es pura).
- Produces:
  - `interface InvoiceFilters { supplierId: string; from: string; to: string; min: string; max: string; text: string; }`
  - `interface FilterableInvoice { supplier_id: string | null; folio: string | null; issued_at: string | null; total: number | null; supplierName: string; }`
  - `filterInvoices<T extends FilterableInvoice>(invoices: T[], f: InvoiceFilters): T[]`
  - `usePurchaseInvoices` ahora incluye `supplier_id` en cada fila y trae hasta 500.

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `src/lib/invoiceFilters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterInvoices, type InvoiceFilters } from "./invoiceFilters";

const EMPTY: InvoiceFilters = { supplierId: "", from: "", to: "", min: "", max: "", text: "" };
const inv = [
  { supplier_id: "s1", folio: "100", issued_at: "2026-07-01", total: 1000, supplierName: "Floriterra" },
  { supplier_id: "s2", folio: "205", issued_at: "2026-07-10", total: 5000, supplierName: "Vivero Sur" },
  { supplier_id: "s1", folio: "300", issued_at: null, total: 3000, supplierName: "Floriterra" },
];

describe("filterInvoices", () => {
  it("sin filtros devuelve todo", () => {
    expect(filterInvoices(inv, EMPTY)).toHaveLength(3);
  });
  it("filtra por proveedor", () => {
    expect(filterInvoices(inv, { ...EMPTY, supplierId: "s2" }).map((i) => i.folio)).toEqual(["205"]);
  });
  it("filtra por rango de fechas (excluye sin fecha si hay límite)", () => {
    const r = filterInvoices(inv, { ...EMPTY, from: "2026-07-05", to: "2026-07-31" });
    expect(r.map((i) => i.folio)).toEqual(["205"]);
  });
  it("filtra por rango de monto", () => {
    expect(filterInvoices(inv, { ...EMPTY, min: "2000", max: "4000" }).map((i) => i.folio)).toEqual(["300"]);
  });
  it("busca por folio o razón social (case-insensitive)", () => {
    expect(filterInvoices(inv, { ...EMPTY, text: "vivero" }).map((i) => i.folio)).toEqual(["205"]);
    expect(filterInvoices(inv, { ...EMPTY, text: "300" }).map((i) => i.folio)).toEqual(["300"]);
  });
  it("combina filtros", () => {
    expect(filterInvoices(inv, { ...EMPTY, supplierId: "s1", max: "1500" }).map((i) => i.folio)).toEqual(["100"]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd C:/Kromi/kromi-pos && pnpm test -- invoiceFilters`
Expected: FAIL (no existe el módulo).

- [ ] **Step 3: Implementar `src/lib/invoiceFilters.ts`**

```ts
export interface InvoiceFilters {
  supplierId: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  min: string; // monto
  max: string; // monto
  text: string;
}
export interface FilterableInvoice {
  supplier_id: string | null;
  folio: string | null;
  issued_at: string | null;
  total: number | null;
  supplierName: string;
}

/** Filtra facturas en memoria. Campos de filtro vacíos no restringen. Las facturas
 *  sin fecha se excluyen solo cuando hay algún límite de fecha (from o to). */
export function filterInvoices<T extends FilterableInvoice>(invoices: T[], f: InvoiceFilters): T[] {
  const text = f.text.trim().toLowerCase();
  const min = f.min.trim() === "" ? null : Number(f.min);
  const max = f.max.trim() === "" ? null : Number(f.max);
  const hasDateLimit = !!f.from || !!f.to;
  return invoices.filter((i) => {
    if (f.supplierId && i.supplier_id !== f.supplierId) return false;
    if (hasDateLimit) {
      if (!i.issued_at) return false;
      if (f.from && i.issued_at < f.from) return false;
      if (f.to && i.issued_at > f.to) return false;
    }
    if (min != null && !Number.isNaN(min) && (i.total ?? 0) < min) return false;
    if (max != null && !Number.isNaN(max) && (i.total ?? 0) > max) return false;
    if (text) {
      const hay = `${i.folio ?? ""} ${i.supplierName}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `cd C:/Kromi/kromi-pos && pnpm test -- invoiceFilters`
Expected: PASS.

- [ ] **Step 5: Ampliar `usePurchaseInvoices` (límite + supplier_id)**

En `src/data/purchases.ts`, reemplazar el cuerpo de `usePurchaseInvoices` para incluir `supplier_id` y subir el límite a 500:

```ts
export function usePurchaseInvoices(businessId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-invoices", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_invoice")
        .select("id,folio,issued_at,total,pdf_path,supplier_id,supplier:supplier_id(razon_social)")
        .eq("business_id", businessId!).order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data ?? [];
    },
  });
}
```

- [ ] **Step 6: Verificar typecheck + tests**

Run: `cd C:/Kromi/kromi-pos && pnpm typecheck && pnpm test -- invoiceFilters`
Expected: sin errores de tipos; tests verdes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invoiceFilters.ts src/lib/invoiceFilters.test.ts src/data/purchases.ts
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(compras): filtro puro de facturas + usePurchaseInvoices con supplier_id y límite 500"
```

---

### Task 3: Pantalla unificada de carga (`StockLoad.tsx`)

**Files:**
- Create: `src/modules/stock/StockLoad.tsx`

**Interfaces:**
- Consumes: `parseStockCsv`, `matchStockRows`, `StockMatchResult` (Task 1); `extractInvoice` y tipos de `@/data/purchases`; `useProductsWithStock`, `upsertInventory` de `@/data/stock`; `InvoiceConfirm` de `./InvoiceConfirm`; `Extraction` de `@/lib/invoice`; `fmtCLP` de `@/lib/money`.
- Produces: `export function StockLoad({ onClose, onDone }: { onClose: () => void; onDone: () => void })`.

- [ ] **Step 1: Crear el componente**

Crear `src/modules/stock/StockLoad.tsx`:

```tsx
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { extractInvoice } from "@/data/purchases";
import { useProductsWithStock, upsertInventory } from "@/data/stock";
import { parseStockCsv, matchStockRows, type StockMatchResult } from "@/lib/stockCsv";
import type { Extraction } from "@/lib/invoice";
import { fmtCLP } from "@/lib/money";
import { InvoiceConfirm } from "./InvoiceConfirm";

interface StockLoadProps {
  onClose: () => void;
  onDone: () => void;
}

/**
 * Pantalla unificada de carga de stock: una zona de arrastrar y soltar que acepta
 * CSV (suma stock por código interno) y PDF (recepción de factura vía OpenAI).
 */
export function StockLoad({ onClose, onDone }: StockLoadProps) {
  const { profile } = useAuth();
  const { branch } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const qc = useQueryClient();
  const { data: products } = useProductsWithStock(businessId, branchId);

  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pdf, setPdf] = useState<{ pdf_path: string; extraction: Extraction } | null>(null);
  const [csv, setCsv] = useState<{ fileName: string; result: StockMatchResult; error: string | null } | null>(null);

  function backToDrop() {
    setPdf(null);
    setCsv(null);
  }

  function handleFile(file: File) {
    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const isCsv = file.type === "text/csv" || name.endsWith(".csv");
    if (isPdf) return void analyzePdf(file);
    if (isCsv) return readCsv(file);
    toast.error("Solo se aceptan archivos CSV o PDF.");
  }

  async function analyzePdf(file: File) {
    cancelledRef.current = false;
    setBusy(true);
    try {
      const data = await extractInvoice(file);
      if (cancelledRef.current) return;
      setPdf(data);
    } catch (err) {
      if (cancelledRef.current) return;
      toast.error(`No se pudo analizar la factura: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  function readCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const entries = parseStockCsv(String(reader.result ?? ""));
        setCsv({ fileName: file.name, result: matchStockRows(entries, products ?? []), error: null });
      } catch (err) {
        setCsv({ fileName: file.name, result: { rows: [], unknown: [] }, error: `No se pudo leer el archivo: ${err instanceof Error ? err.message : "formato inválido"}` });
      }
    };
    reader.readAsText(file);
  }

  async function confirmCsv() {
    if (!csv || !csv.result.rows.length || !branchId) return;
    setApplying(true);
    try {
      await Promise.all(csv.result.rows.map((r) => upsertInventory(r.id, branchId, r.next)));
      toast.success(`Stock actualizado para ${csv.result.rows.length} producto(s).`);
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      onDone();
    } catch (e) {
      toast.error(`No se pudo actualizar el stock: ${e instanceof Error ? e.message : e}`);
    } finally {
      setApplying(false);
    }
  }

  function pick() {
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  // PDF: pasa el control a la pantalla de confirmación de factura
  if (pdf) {
    return <InvoiceConfirm pdfPath={pdf.pdf_path} extraction={pdf.extraction} onCancel={backToDrop} onDone={onDone} />;
  }

  // CSV: preview antes de aplicar
  if (csv) {
    return (
      <div className="w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6">
        <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Confirmar carga de stock</div>
        <div className="mb-4 text-[13px] text-[#7C95A8]">{csv.fileName}</div>
        {csv.error && <div className="mb-3 rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-[13.5px] font-semibold text-[#9a2533]">{csv.error}</div>}
        {csv.result.rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#F7FAF8] text-left text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">
                  <th className="px-3 py-2">Código interno</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Suma</th>
                  <th className="px-3 py-2 text-right">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {csv.result.rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#EEF1F6]">
                    <td className="px-3 py-1.5 font-semibold text-[#7C95A8]">{r.internal_code}</td>
                    <td className="px-3 py-1.5 font-bold text-[#0F2A1B]">{r.name}</td>
                    <td className="px-3 py-1.5 text-right text-[#7C95A8]">{r.current}</td>
                    <td className="px-3 py-1.5 text-right font-bold" style={{ color: "var(--brand)" }}>+{r.add}</td>
                    <td className="px-3 py-1.5 text-right font-black text-[#0F2A1B]">{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!csv.error && csv.result.rows.length === 0 && (
          <div className="rounded-xl bg-[#FBF1E0] px-3.5 py-2.5 text-[13px] font-semibold text-[#9a6a1e]">
            No se encontró ningún producto para los códigos del archivo.
          </div>
        )}
        {csv.result.unknown.length > 0 && (
          <div className="mt-3 text-[12.5px] text-[#9a6a1e]">
            <b>{csv.result.unknown.length}</b> código(s) no reconocido(s) (se ignoran): {csv.result.unknown.join(", ")}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={backToDrop} disabled={applying}
            className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-50">
            Elegir otro archivo
          </button>
          <button onClick={confirmCsv} disabled={applying || !csv.result.rows.length}
            className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--brand)" }}>
            {applying ? "Guardando…" : "Confirmar carga"}
          </button>
        </div>
      </div>
    );
  }

  // Estado de análisis de PDF
  if (busy) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-[420px] max-w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6 text-center">
          <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Cargar stock</div>
          <div className="flex flex-col items-center gap-3 py-7">
            <span className="inline-block h-9 w-9 animate-spin rounded-full" style={{ border: "3px solid #E7EFE8", borderTopColor: "var(--brand)" }} />
            <div className="text-[14px] font-bold text-[#0F2A1B]">Procesando Factura</div>
            <div className="text-[12px] font-normal text-[#9aa8bd]">Puede tardar unos segundos. Puedes cancelar.</div>
          </div>
          <button onClick={() => { cancelledRef.current = true; setBusy(false); }}
            className="mt-1 w-full rounded-[13px] border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // Dropzone
  return (
    <div className="flex justify-center py-4">
      <div className="w-[560px] max-w-full">
        <div
          onClick={pick}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed bg-white px-6 py-14 text-center transition-colors"
          style={{ borderColor: dragOver ? "var(--brand)" : "#CBD5E1", background: dragOver ? "color-mix(in srgb, var(--brand) 6%, #fff)" : "#fff" }}
        >
          <div className="text-[17px] font-black text-[#0F2A1B]">Arrastra un archivo aquí</div>
          <div className="text-[13px] text-[#7C95A8]">o haz clic para seleccionar. Acepta <b>CSV</b> (suma stock por código interno) o <b>PDF</b> de factura (extrae con IA).</div>
          <div className="mt-2 inline-flex rounded-[12px] px-[18px] py-2.5 text-sm font-bold text-white" style={{ background: "var(--brand)" }}>
            Seleccionar archivo
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="hidden" />
        <button onClick={onClose} className="mt-3 w-full rounded-[13px] border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">
          Volver a stock
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck + build**

Run: `cd C:/Kromi/kromi-pos && pnpm typecheck && pnpm build`
Expected: sin errores. (El componente aún no se usa; se conecta en Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/stock/StockLoad.tsx
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(stock): pantalla unificada de carga (dropzone CSV/PDF con dispatch por formato)"
```

---

### Task 4: Pantalla de facturas con filtros (`PurchaseInvoicesScreen.tsx`)

**Files:**
- Create: `src/modules/compras/PurchaseInvoicesScreen.tsx`

**Interfaces:**
- Consumes: `usePurchaseInvoices`, `invoiceDownloadUrl` de `@/data/purchases`; `useSuppliers` de `@/data/stock`; `filterInvoices`, `InvoiceFilters` de `@/lib/invoiceFilters`; `fmtCLP` de `@/lib/money`.
- Produces: `export function PurchaseInvoicesScreen({ businessId }: { businessId: string | undefined })`.

- [ ] **Step 1: Crear el componente**

Crear `src/modules/compras/PurchaseInvoicesScreen.tsx`:

```tsx
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { usePurchaseInvoices, invoiceDownloadUrl } from "@/data/purchases";
import { useSuppliers } from "@/data/stock";
import { filterInvoices, type InvoiceFilters } from "@/lib/invoiceFilters";
import { fmtCLP } from "@/lib/money";

interface Props {
  businessId: string | undefined;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** El join `supplier:supplier_id(razon_social)` se tipa como arreglo; tomamos el primero. */
function supplierName(supplier: { razon_social: string }[] | { razon_social: string } | null | undefined): string {
  if (!supplier) return "—";
  const row = Array.isArray(supplier) ? supplier[0] : supplier;
  return row?.razon_social ?? "—";
}

const EMPTY_FILTERS: InvoiceFilters = { supplierId: "", from: "", to: "", min: "", max: "", text: "" };

/** Listado de facturas de compra con filtros (proveedor, fechas, monto, texto) y descarga del PDF. */
export function PurchaseInvoicesScreen({ businessId }: Props) {
  const { data: invoices, isLoading } = usePurchaseInvoices(businessId);
  const { data: suppliers } = useSuppliers(businessId);
  const [f, setF] = useState<InvoiceFilters>(EMPTY_FILTERS);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const mapped = (invoices ?? []).map((inv) => ({ ...inv, supplierName: supplierName(inv.supplier) }));
    return filterInvoices(mapped, f);
  }, [invoices, f]);

  const anyFilter = f.supplierId || f.from || f.to || f.min || f.max || f.text;

  async function handleDownload(id: string, pdfPath: string | null) {
    if (!pdfPath) {
      toast.error("Esta factura no tiene un PDF archivado.");
      return;
    }
    setDownloadingId(id);
    try {
      const url = await invoiceDownloadUrl(pdfPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(`No se pudo generar el enlace de descarga: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDownloadingId(null);
    }
  }

  const inputCls = "rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--brand)]";

  return (
    <div className="w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6">
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
        <input value={f.text} onChange={(e) => setF((s) => ({ ...s, text: e.target.value }))} placeholder="Buscar folio o proveedor…" className={`${inputCls} lg:col-span-2`} />
        <select value={f.supplierId} onChange={(e) => setF((s) => ({ ...s, supplierId: e.target.value }))} className={inputCls}>
          <option value="">Todos los proveedores</option>
          {(suppliers ?? []).map((s) => (<option key={s.id} value={s.id}>{s.razon_social}</option>))}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} title="Desde" className={inputCls} />
        <input type="date" value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} title="Hasta" className={inputCls} />
        <div className="flex gap-2">
          <input type="number" value={f.min} onChange={(e) => setF((s) => ({ ...s, min: e.target.value }))} placeholder="Monto mín" className={`${inputCls} w-full`} />
          <input type="number" value={f.max} onChange={(e) => setF((s) => ({ ...s, max: e.target.value }))} placeholder="máx" className={`${inputCls} w-full`} />
        </div>
      </div>
      {anyFilter && (
        <button onClick={() => setF(EMPTY_FILTERS)} className="mb-3 text-[12.5px] font-bold text-[#7C95A8] underline">Limpiar filtros</button>
      )}

      {isLoading && <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">Cargando facturas…</div>}

      {!isLoading && (invoices ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center py-[50px] text-center text-[#9aa8bd]">
          <div className="text-[16px] font-bold text-[#7C95A8]">Sin facturas archivadas</div>
          <div className="mt-[3px] text-[13.5px] text-[#9aa8bd]">Las facturas recepcionadas desde Stock aparecerán aquí.</div>
        </div>
      )}

      {!isLoading && (invoices ?? []).length > 0 && rows.length === 0 && (
        <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">Sin resultados para los filtros aplicados.</div>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">
                <th className="px-4 py-2.5">Proveedor</th>
                <th className="px-4 py-2.5">Folio</th>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-right">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t border-[#EEF1F6]">
                  <td className="px-4 py-2.5 font-bold text-[#0F2A1B]">{inv.supplierName}</td>
                  <td className="px-4 py-2.5 text-[#2A3A2E]">{inv.folio ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[#2A3A2E]">{fmtDate(inv.issued_at)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-[#0F2A1B]">{fmtCLP(inv.total ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleDownload(inv.id, inv.pdf_path)} disabled={downloadingId === inv.id || !inv.pdf_path}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#2A3A2E] disabled:opacity-50"
                      title={inv.pdf_path ? "Descargar PDF de la factura" : "Sin PDF archivado"}>
                      {downloadingId === inv.id ? "Generando…" : "Descargar PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck + build**

Run: `cd C:/Kromi/kromi-pos && pnpm typecheck && pnpm build`
Expected: sin errores. (Se conecta en Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/compras/PurchaseInvoicesScreen.tsx
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(compras): pantalla de facturas con filtros (proveedor, fechas, monto, texto)"
```

---

### Task 5: Reconexión de `StockScreen` + limpieza

**Files:**
- Modify: `src/modules/stock/StockScreen.tsx`
- Delete: `src/modules/compras/PurchaseInvoicesList.tsx`
- Delete: `src/modules/stock/InvoiceUpload.tsx`

**Interfaces:**
- Consumes: `StockLoad` (Task 3), `PurchaseInvoicesScreen` (Task 4).
- Produces: nada nuevo (integración final).

- [ ] **Step 1: Actualizar imports y estado de vista**

En `src/modules/stock/StockScreen.tsx`:

- Reemplazar el import `import { InvoiceUpload } from "./InvoiceUpload";` por `import { StockLoad } from "./StockLoad";`.
- Reemplazar el import de `PurchaseInvoicesList` por `import { PurchaseInvoicesScreen } from "@/modules/compras/PurchaseInvoicesScreen";`.
- Cambiar el estado de vista: `const [view, setView] = useState<"list" | "cargar" | "facturas">("list");` (antes `"list" | "recepcion"`).
- Eliminar los estados y helpers del flujo CSV inline y del modal de facturas: `importPreview`/`setImportPreview` (interfaces `ImportRow`, `ImportPreview`), `parseStockCsv` (movido a `@/lib/stockCsv`), `pickFile`, `onFile`, `confirmImport`, `fileRef` (el usado para CSV), `invoiceListOpen`/`setInvoiceListOpen`. Conservar todo lo demás (búsqueda, categorías, filtros, tabla/bloques, ProductForm, CategoryManager, stock crítico, `upsertInventory` ya no se usa aquí — se puede quitar del import si queda sin uso).

- [ ] **Step 2: Reemplazar la vista `recepcion` por `cargar` y agregar `facturas`**

Reemplazar el bloque `if (view === "recepcion") { ... }` por dos bloques (encabezado idéntico salvo título/subtítulo):

```tsx
  if (view === "cargar") {
    return (
      <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Mantención</div>
            <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Cargar stock</h2>
          </div>
          <button onClick={() => setView("list")} className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">← Volver a stock</button>
        </div>
        <StockLoad onClose={() => setView("list")} onDone={() => { setView("list"); refetchAll(); }} />
      </div>
    );
  }

  if (view === "facturas") {
    return (
      <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Compras</div>
            <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Facturas de compra</h2>
          </div>
          <button onClick={() => setView("list")} className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">← Volver a stock</button>
        </div>
        <PurchaseInvoicesScreen businessId={businessId} />
      </div>
    );
  }
```

- [ ] **Step 3: Unificar la barra de acciones a dos botones**

En la barra de acciones de la vista `list` (bloque `canManage ? (...)`), dejar los botones así: **Categorías** (igual), **Cargar stock** (`onClick={() => setView("cargar")}`), **Facturas de compra** (`onClick={() => setView("facturas")}`), **+ Agregar producto** (igual). Eliminar el botón antiguo "Cargar stock" que abría el file input CSV, el botón "Cargar desde factura", el `<input type="file" accept=".csv" .../>`, y el botón que abría el modal `PurchaseInvoicesList`. Resultado:

```tsx
          <div className="flex gap-2.5">
            <button onClick={() => setCategoriesOpen(true)} className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">Categorías</button>
            <button onClick={() => setView("cargar")} title="Cargar stock desde CSV o factura PDF" className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">Cargar stock</button>
            <button onClick={() => setView("facturas")} title="Ver y filtrar las facturas de compra archivadas" className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">Facturas de compra</button>
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="flex items-center gap-2 rounded-xl border border-[#A7E3C0] bg-[#E6F7EE] px-[18px] py-3 text-sm font-bold text-[#0a6e36]">+ Agregar producto</button>
          </div>
```

- [ ] **Step 4: Eliminar el modal de preview CSV y el modal de facturas del cuerpo**

Quitar del JSX de la vista `list` el bloque `{importPreview && ( ... )}` (el modal de preview CSV) y el bloque `{invoiceListOpen && <PurchaseInvoicesList ... />}`. (El `csvCell`/`downloadCsv`/`exportCriticalCsv` del stock crítico se conservan.)

- [ ] **Step 5: Borrar los archivos ya sin uso**

```bash
git rm src/modules/compras/PurchaseInvoicesList.tsx src/modules/stock/InvoiceUpload.tsx
```

Verificar que nada más los importa: `rg "PurchaseInvoicesList|InvoiceUpload" src` no debe devolver referencias (salvo, si acaso, comentarios). Si `parseStockCsv` quedó importado desde `@/lib/stockCsv` úsalo; si no se usa en StockScreen, no lo importes.

- [ ] **Step 6: Verificar typecheck + tests + build**

Run: `cd C:/Kromi/kromi-pos && pnpm typecheck && pnpm test && pnpm build`
Expected: typecheck sin errores (sin variables/imports sin uso), todos los tests verdes, build OK.

- [ ] **Step 7: Commit**

```bash
git add src/modules/stock/StockScreen.tsx
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(stock): unificar carga (CSV/PDF) y facturas como pantallas internas; retirar modales e InvoiceUpload"
```

---

## Verificación en vivo (con el usuario, tras las tareas)

- `pnpm tauri dev` → Stock: dos botones "Cargar stock" y "Facturas de compra".
- "Cargar stock" → arrastrar un PDF (Floriterra) → "Procesando Factura" → confirmación; arrastrar un CSV `codigo,cantidad` con códigos internos → preview → confirmar → stock sumado.
- "Facturas de compra" → filtros por proveedor / fechas / monto / texto; descargar PDF.
- No requiere cambios de BD ni redeploy de edge functions.

## Notas de decomposición

- Tasks 1 y 2 son lógica pura + tests (verificables con `pnpm test`). Task 2 incluye un cambio menor de data layer.
- Tasks 3 y 4 crean componentes aislados (verificables con typecheck+build; aún no montados).
- Task 5 integra y limpia; es la única que toca `StockScreen` y borra archivos, verificable con typecheck+test+build.
