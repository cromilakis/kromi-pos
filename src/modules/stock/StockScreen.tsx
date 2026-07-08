import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useCategories, useProductsWithStock, useSuppliers, softDeleteProduct, upsertInventory } from "@/data/stock";
import type { ProductRow } from "@/data/stock";
import { fmtCLP } from "@/lib/money";
import { ProductForm } from "./ProductForm";
import { CategoryManager } from "./CategoryManager";
import { InvoiceUpload } from "./InvoiceUpload";

/** Bajo mínimo: mismo criterio que la alerta de Inicio (min_stock configurado y stock en o bajo el mínimo). */
function isLowStock(p: ProductRow): boolean {
  return p.min_stock > 0 && p.stock <= p.min_stock;
}

interface ImportRow { id: string; name: string; current: number; add: number; next: number; }
interface ImportPreview { rows: ImportRow[]; unknown: string[]; fileName: string; error: string | null; }

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseStockCsv(text: string): { codigo: string; cantidad: number }[] {
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

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(","));
  const blob = new Blob(["﻿" + [header.join(",")].concat(body).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StockScreen() {
  const { profile } = useAuth();
  const { branch } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const canManage = profile?.role === "admin" || profile?.role === "kromi";

  const qc = useQueryClient();
  const { data: products, isLoading: loadingProducts } = useProductsWithStock(businessId, branchId);
  const { data: categories } = useCategories(businessId);
  const { data: suppliers } = useSuppliers(businessId);

  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [criticalOpen, setCriticalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const allProducts = products ?? [];
  const allCategories = categories ?? [];

  const catById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);

  const productCountByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of allProducts) {
      if (!p.category_id) continue;
      m[p.category_id] = (m[p.category_id] ?? 0) + 1;
    }
    return m;
  }, [allProducts]);

  const lowStockList = useMemo(() => allProducts.filter(isLowStock), [allProducts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (catFilter === "sin-categoria") return !p.category_id;
      if (catFilter !== "todas" && p.category_id !== catFilter) return false;
      return true;
    });
  }, [allProducts, query, catFilter]);

  const groups = useMemo(() => {
    const byCat = new Map<string, ProductRow[]>();
    for (const p of filtered) {
      const key = p.category_id ?? "__none__";
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(p);
    }
    const sortedCatIds = [...allCategories].sort((a, b) => a.sort - b.sort).map((c) => c.id);
    const out: { key: string; label: string; dot: string; items: ProductRow[] }[] = [];
    for (const id of sortedCatIds) {
      const items = byCat.get(id);
      if (items && items.length) out.push({ key: id, label: catById.get(id)?.label ?? "—", dot: catById.get(id)?.dot ?? "#7C95A8", items });
    }
    const none = byCat.get("__none__");
    if (none && none.length) out.push({ key: "__none__", label: "Sin categoría", dot: "#9aa8bd", items: none });
    return out;
  }, [filtered, allCategories, catById]);

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["products-with-stock", businessId, branchId] });
  }
  function refetchCategories() {
    qc.invalidateQueries({ queryKey: ["categories", businessId] });
  }

  async function adjustStock(p: ProductRow, delta: number) {
    if (!branchId) return;
    const next = Math.max(0, p.stock + delta);
    try {
      await upsertInventory(p.id, branchId, next);
      refetchAll();
    } catch (e) {
      toast.error(`No se pudo actualizar el stock: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function handleDelete(id: string) {
    try {
      await softDeleteProduct(id);
      toast.success("Producto eliminado.");
      setConfirmDeleteId(null);
      refetchAll();
    } catch (e) {
      toast.error(`No se pudo eliminar el producto: ${e instanceof Error ? e.message : e}`);
    }
  }

  function exportCriticalCsv() {
    if (!lowStockList.length) return;
    const header = ["codigo", "nombre", "categoria", "stock_actual", "minimo", "faltante"];
    const rows = lowStockList.map((p) => [
      p.id,
      p.name,
      p.category_id ? catById.get(p.category_id)?.label ?? "" : "Sin categoría",
      p.stock,
      p.min_stock,
      Math.max(0, p.min_stock - p.stock),
    ]);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    downloadCsv(`stock-critico-${stamp}.csv`, header, rows);
  }

  function pickFile() {
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const entries = parseStockCsv(String(reader.result ?? ""));
        const byId = new Map(allProducts.map((p) => [p.id, p]));
        const adds = new Map<string, number>();
        const unknown: string[] = [];
        for (const en of entries) {
          if (!en.codigo || !(en.cantidad > 0)) continue;
          const p = byId.get(en.codigo);
          if (!p) {
            unknown.push(en.codigo);
            continue;
          }
          adds.set(p.id, (adds.get(p.id) ?? 0) + en.cantidad);
        }
        const rows: ImportRow[] = [...adds.entries()].map(([id, add]) => {
          const p = byId.get(id)!;
          return { id, name: p.name, current: p.stock, add, next: p.stock + add };
        });
        setImportPreview({ rows, unknown, fileName: file.name, error: null });
      } catch (err) {
        setImportPreview({ rows: [], unknown: [], fileName: file.name, error: `No se pudo leer el archivo: ${err instanceof Error ? err.message : "formato inválido"}` });
      }
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (!importPreview || !importPreview.rows.length || !branchId) {
      setImportPreview(null);
      return;
    }
    try {
      await Promise.all(importPreview.rows.map((r) => upsertInventory(r.id, branchId, r.next)));
      toast.success(`Stock actualizado para ${importPreview.rows.length} producto(s).`);
      setImportPreview(null);
      refetchAll();
    } catch (e) {
      toast.error(`No se pudo aplicar la carga de stock: ${e instanceof Error ? e.message : e}`);
    }
  }

  const showCriticalBanner = canManage && lowStockList.length > 0;

  return (
    <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>
            Mantención
          </div>
          <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Stock e inventario</h2>
        </div>
        {canManage ? (
          <div className="flex gap-2.5">
            <button
              onClick={() => setCategoriesOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Categorías
            </button>
            <button
              onClick={pickFile}
              title="Sumar stock desde un archivo CSV"
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Cargar stock
            </button>
            <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
            <button
              onClick={() => setInvoiceOpen(true)}
              title="Recepcionar una compra a partir del PDF de la factura"
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Cargar desde factura
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="flex items-center gap-2 rounded-xl border border-[#A7E3C0] bg-[#E6F7EE] px-[18px] py-3 text-sm font-bold text-[#0a6e36]"
            >
              + Agregar producto
            </button>
          </div>
        ) : (
          <span className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-[13px] font-bold text-[#7C95A8]">
            Solo lectura
          </span>
        )}
      </div>

      {showCriticalBanner && (
        <div className="mb-[18px]">
          <button
            onClick={() => setCriticalOpen((o) => !o)}
            className="flex w-full items-center gap-[13px] rounded-2xl border border-[#F5C2C2] bg-[#FDECEC] px-4 py-[13px] text-left"
          >
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#F8D2D2] text-[18px] font-black text-[#B3261E]">!</span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-extrabold text-[#9a2533]">
                {lowStockList.length} {lowStockList.length === 1 ? "producto" : "productos"} con stock crítico
              </div>
              <div className="mt-px text-[12.5px] text-[#b1607a]">Toca para ver el detalle y exportar la solicitud de reposición.</div>
            </div>
            <span className="text-[#9a2533]">{criticalOpen ? "︿" : "⌄"}</span>
          </button>
          {criticalOpen && (
            <div className="mt-2.5 rounded-2xl border border-[#E1E5EE] bg-white p-4">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="text-[15px] font-black text-[#0F2A1B]">Productos críticos para reponer</div>
                <button
                  onClick={exportCriticalCsv}
                  className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#A7E3C0] bg-[#E6F7EE] px-3.5 py-2 text-[13px] font-bold text-[#0a6e36]"
                >
                  Exportar CSV
                </button>
              </div>
              {lowStockList.map((p) => (
                <div key={p.id} className="flex items-center gap-[13px] border-b border-[#F0F2F7] py-[10px] last:border-0">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.category_id ? catById.get(p.category_id)?.dot ?? "#7C95A8" : "#9aa8bd" }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-[#0F2A1B]">{p.name}</div>
                    <div className="text-xs text-[#9aa8bd]">{p.category_id ? catById.get(p.category_id)?.label : "Sin categoría"}</div>
                  </div>
                  <span className="whitespace-nowrap text-[12.5px] font-bold text-[#9a2533]">Faltan {Math.max(0, p.min_stock - p.stock)}</span>
                  <span className="min-w-[74px] whitespace-nowrap text-right text-[14px] font-black text-[#0F2A1B]">
                    {p.stock}/{p.min_stock}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-3.5 flex items-center gap-3">
        <div className="flex max-w-[440px] flex-1 items-center gap-2.5 rounded-xl border border-[#E1E5EE] bg-white px-[15px] py-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto en el inventario…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#0F2A1B] outline-none"
          />
        </div>
      </div>

      <div className="mb-[18px] flex flex-wrap items-center gap-2">
        {[{ id: "todas", label: "Todas" }, ...allCategories.map((c) => ({ id: c.id, label: c.label })), { id: "sin-categoria", label: "Sin categoría" }].map((c) => (
          <button
            key={c.id}
            onClick={() => setCatFilter(c.id)}
            className="rounded-full border px-[13px] py-[7px] text-[12.5px] font-bold"
            style={
              catFilter === c.id
                ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {loadingProducts && <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">Cargando inventario…</div>}

      {!loadingProducts && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-[60px] text-center text-[#9aa8bd]">
          <div className="text-[16px] font-bold text-[#7C95A8]">Sin resultados</div>
          <div className="mt-[3px] text-[13.5px] text-[#9aa8bd]">Ningún producto coincide con la búsqueda o el filtro.</div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="mb-[26px]">
          <div className="mb-[13px] flex items-center gap-2.5">
            <span className="size-[9px] rounded-full" style={{ background: g.dot }} />
            <span className="text-[17px] font-black tracking-[-.01em] text-[#0F2A1B]">{g.label}</span>
            <span className="rounded-full bg-[#E7EFE8] px-2.5 py-0.5 text-xs font-bold text-[#0F2A1B]">{g.items.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
            {g.items.map((p) => {
              const low = isLowStock(p);
              return (
                <div key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-[#E1E5EE] bg-white">
                  <div className="flex flex-col px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1 truncate text-[15px] font-bold text-[#0F2A1B]">{p.name}</div>
                      {p.critical && (
                        <span className="whitespace-nowrap rounded-full bg-[#FBF1E0] px-2 py-0.5 text-[11px] font-bold text-[#9A6F12]">★ Crítico</span>
                      )}
                    </div>
                    <div className="mt-[3px] flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-bold text-[#7C95A8]">{fmtCLP(p.price)}</span>
                      <span className="text-[11.5px] font-bold" style={{ color: low ? "#D02E2E" : "#9aa8bd" }}>
                        {p.min_stock > 0 ? `mín. ${p.min_stock}` : "sin mínimo"}
                      </span>
                    </div>
                    {canManage ? (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setEditing(p);
                              setFormOpen(true);
                            }}
                            title="Editar producto"
                            className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[#7C95A8]"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(p.id)}
                            title="Eliminar producto"
                            className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#F5C2C2] bg-white text-[#D02E2E]"
                          >
                            🗑
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => adjustStock(p, -1)}
                            className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[18px] text-[#7C95A8]"
                          >
                            –
                          </button>
                          <span className="min-w-[24px] text-center text-[15px] font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                            {p.stock}
                          </span>
                          <button
                            onClick={() => adjustStock(p, 1)}
                            className="flex size-[30px] items-center justify-center rounded-[9px] bg-[#D3F4E0] text-[18px]"
                            style={{ color: "var(--brand)" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-[11.5px] font-bold" style={{ color: low ? "#D02E2E" : "#9aa8bd" }}>
                          {low ? "Stock bajo" : "Stock"}
                        </span>
                        <span className="flex items-baseline gap-1">
                          <span className="text-[15px] font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                            {p.stock}
                          </span>
                          <span className="text-xs font-semibold text-[#9aa8bd]">u.</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {formOpen && (
        <ProductForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          product={editing}
          categories={allCategories}
          suppliers={suppliers ?? []}
          businessId={businessId ?? ""}
          branchId={branchId ?? ""}
          onSaved={refetchAll}
        />
      )}

      {invoiceOpen && (
        <InvoiceUpload
          onClose={() => setInvoiceOpen(false)}
          onDone={() => {
            setInvoiceOpen(false);
            refetchAll();
          }}
        />
      )}

      {categoriesOpen && (
        <CategoryManager
          open={categoriesOpen}
          onClose={() => setCategoriesOpen(false)}
          categories={allCategories}
          productCountByCategory={productCountByCategory}
          businessId={businessId ?? ""}
          onChanged={refetchCategories}
        />
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-[380px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-[15px] font-extrabold text-[#0F2A1B]">¿Eliminar este producto?</div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]"
              >
                Cancelar
              </button>
              <button onClick={() => handleDelete(confirmDeleteId)} className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setImportPreview(null)}>
          <div className="max-h-[80vh] w-[480px] max-w-full overflow-auto rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Cargar stock</div>
            <div className="mb-3 text-[12.5px] text-[#7C95A8]">{importPreview.fileName}</div>
            {importPreview.error && (
              <div className="mb-3 rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-[13.5px] font-semibold text-[#9a2533]">{importPreview.error}</div>
            )}
            {importPreview.rows.length > 0 && (
              <>
                <div className="mb-2.5 text-[13px] text-[#7C95A8]">
                  Se sumarán al stock actual <b className="text-[#0F2A1B]">{importPreview.rows.length}</b> productos:
                </div>
                {importPreview.rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 border-b border-[#F0F2F7] py-2 text-[13.5px] last:border-0">
                    <span className="truncate font-semibold text-[#0F2A1B]">{r.name}</span>
                    <span className="whitespace-nowrap text-[#7C95A8]">
                      {r.current} + {r.add} → <b className="text-[#0F2A1B]">{r.next}</b>
                    </span>
                  </div>
                ))}
              </>
            )}
            {!importPreview.error && importPreview.rows.length === 0 && (
              <div className="text-[13.5px] text-[#9aa8bd]">No se encontraron filas válidas en el archivo.</div>
            )}
            {importPreview.unknown.length > 0 && (
              <div className="mt-3.5 rounded-xl bg-[#FBF1E0] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#9a6a1e]">
                <b>{importPreview.unknown.length}</b> código(s) no reconocido(s) (se ignoran): {importPreview.unknown.join(", ")}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2.5">
              <button
                onClick={() => setImportPreview(null)}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmImport}
                disabled={!importPreview.rows.length}
                className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: "var(--brand)" }}
              >
                Confirmar carga
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
