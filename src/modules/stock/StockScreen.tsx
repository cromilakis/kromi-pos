import { useEffect, useMemo, useState } from "react";
import { notifyError } from "@/lib/errors";
import { saveTextAs } from "@/lib/fileSave";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useCategories, useProductsWithStock, useSuppliers, softDeleteProduct, upsertInventory, updateProductsCategory } from "@/data/stock";
import type { ProductRow } from "@/data/stock";
import { fmtCLP } from "@/lib/money";
import { ProductForm } from "./ProductForm";
import { CategoryManager } from "./CategoryManager";
import { StockLoad } from "./StockLoad";
import { PurchaseInvoicesScreen } from "@/modules/compras/PurchaseInvoicesScreen";

/** Bajo mínimo: mismo criterio que la alerta de Inicio (min_stock configurado y stock en o bajo el mínimo). */
function isLowStock(p: ProductRow): boolean {
  if (p.is_service) return false;
  return p.min_stock > 0 && p.stock <= p.min_stock;
}

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(","));
  const text = "﻿" + [header.join(",")].concat(body).join("\r\n");
  void saveTextAs(text, filename);
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
  const [onlyDiscount, setOnlyDiscount] = useState(false);
  const [criticalOpen, setCriticalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "cargar" | "facturas" | "categorias">("list");
  const [stockView, setStockViewState] = useState<"table" | "blocks">(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("kromi.stockView") === "blocks" ? "blocks" : "table"),
  );
  const setStockView = (v: "table" | "blocks") => {
    setStockViewState(v);
    try { localStorage.setItem("kromi.stockView", v); } catch { /* no-op */ }
  };

  // Selección múltiple (solo vista Tabla) para recategorización masiva.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxSubmenuOpen, setCtxSubmenuOpen] = useState(false);

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
      if (onlyDiscount && !(p.discount_pct > 0)) return false;
      if (catFilter === "sin-categoria") { if (p.category_id) return false; }
      else if (catFilter !== "todas" && p.category_id !== catFilter) return false;
      return true;
    });
  }, [allProducts, query, catFilter, onlyDiscount]);

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
      if (items && items.length) out.push({ key: id, label: catById.get(id)?.label ?? "—", dot: catById.get(id)?.dot ?? "#556A7C", items });
    }
    const none = byCat.get("__none__");
    if (none && none.length) out.push({ key: "__none__", label: "Sin categoría", dot: "#5E6E7E", items: none });
    return out;
  }, [filtered, allCategories, catById]);

  // Limpia la selección cuando cambia lo visible (evita rangos sobre filas ya no listadas).
  useEffect(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
    setCtxMenu(null);
  }, [query, catFilter, onlyDiscount, stockView, view]);

  // Cierra el menú contextual con Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu]);

  function handleRowClick(e: React.MouseEvent, product: ProductRow, index: number) {
    if (!canManage) return;
    if (e.shiftKey && anchorId) {
      const anchorIdx = filtered.findIndex((p) => p.id === anchorId);
      if (anchorIdx !== -1) {
        const [a, b] = anchorIdx <= index ? [anchorIdx, index] : [index, anchorIdx];
        setSelectedIds(new Set(filtered.slice(a, b + 1).map((p) => p.id)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(product.id)) next.delete(product.id);
        else next.add(product.id);
        return next;
      });
      setAnchorId(product.id);
      return;
    }
    setSelectedIds(new Set([product.id]));
    setAnchorId(product.id);
  }

  function handleRowContextMenu(e: React.MouseEvent, product: ProductRow) {
    if (!canManage) return;
    e.preventDefault();
    // Si la fila no está en la selección, el menú actúa sobre ella sola.
    if (!selectedIds.has(product.id)) {
      setSelectedIds(new Set([product.id]));
      setAnchorId(product.id);
    }
    setCtxSubmenuOpen(false);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  async function applyCategoryToSelection(categoryId: string | null) {
    const ids = [...selectedIds];
    setCtxMenu(null);
    if (ids.length === 0) return;
    try {
      await updateProductsCategory(ids, categoryId);
      const label = categoryId ? catById.get(categoryId)?.label ?? "la categoría" : "Sin categoría";
      toast.success(`${ids.length} ${ids.length === 1 ? "producto movido" : "productos movidos"} a “${label}”.`);
      setSelectedIds(new Set());
      setAnchorId(null);
      refetchAll();
    } catch (err) {
      notifyError(`No se pudo cambiar la categoría.`, err instanceof Error ? err.message : err);
    }
  }

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
      notifyError(`No se pudo actualizar el stock.`, e instanceof Error ? e.message : e);
    }
  }

  async function handleDelete(id: string) {
    try {
      await softDeleteProduct(id);
      toast.success("Producto eliminado.");
      setConfirmDeleteId(null);
      refetchAll();
    } catch (e) {
      notifyError(`No se pudo eliminar el producto.`, e instanceof Error ? e.message : e);
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

  function exportStockCsv() {
    const list = products ?? [];
    if (!list.length) return;
    const header = ["nombre", "cantidad", "precio"];
    const rows = list.map((p) => [p.name, p.stock, p.price]);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    downloadCsv(`stock-${stamp}.csv`, header, rows);
  }

  const showCriticalBanner = canManage && lowStockList.length > 0;

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

  if (view === "categorias") {
    return (
      <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Mantención</div>
            <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Categorías</h2>
          </div>
          <button onClick={() => setView("list")} className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">← Volver a stock</button>
        </div>
        <CategoryManager
          categories={allCategories}
          productCountByCategory={productCountByCategory}
          businessId={businessId ?? ""}
          onChanged={refetchCategories}
        />
      </div>
    );
  }

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
              onClick={exportStockCsv}
              title="Exportar todo el inventario a CSV (nombre, cantidad, precio)"
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Exportar stock (CSV)
            </button>
            <button
              onClick={() => setView("categorias")}
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Categorías
            </button>
            <button
              onClick={() => setView("cargar")}
              title="Cargar stock desde CSV o factura PDF"
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Cargar stock
            </button>
            <button
              onClick={() => setView("facturas")}
              title="Ver y filtrar las facturas de compra archivadas"
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Facturas de compra
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
          <span className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-[13px] font-bold text-[#556A7C]">
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
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.category_id ? catById.get(p.category_id)?.dot ?? "#556A7C" : "#5E6E7E" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center">
                      <span className="truncate text-[14px] font-bold text-[#0F2A1B]">{p.name}</span>
                      {p.critical && <span className="ml-1.5 rounded-full bg-[#FBF1E0] px-1.5 py-0.5 text-[10px] font-black text-[#9A6F12]">★ Crítico</span>}
                    </div>
                    <div className="text-xs text-[#5E6E7E]">{p.category_id ? catById.get(p.category_id)?.label : "Sin categoría"}</div>
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
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-[#E1E5EE] bg-white p-1">
          {(["table", "blocks"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setStockView(v)}
              className="rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors"
              style={stockView === v ? { background: "var(--brand)", color: "#fff" } : { color: "#556A7C" }}
            >
              {v === "table" ? "Tabla" : "Bloques"}
            </button>
          ))}
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
        <span className="mx-1 h-5 w-px bg-[#E1E5EE]" />
        <button
          onClick={() => setOnlyDiscount((v) => !v)}
          title="Mostrar solo productos con descuento"
          className="rounded-full border px-[13px] py-[7px] text-[12.5px] font-bold"
          style={
            onlyDiscount
              ? { background: "#0a6e36", borderColor: "#0a6e36", color: "#fff" }
              : { background: "#fff", borderColor: "#A7E3C0", color: "#0a6e36" }
          }
        >
          Con descuento
        </button>
      </div>

      {loadingProducts && <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Cargando inventario…</div>}

      {!loadingProducts && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-[60px] text-center text-[#5E6E7E]">
          <div className="text-[16px] font-bold text-[#556A7C]">Sin resultados</div>
          <div className="mt-[3px] text-[13.5px] text-[#5E6E7E]">Ningún producto coincide con la búsqueda o el filtro.</div>
        </div>
      )}

      {stockView === "table" && canManage && !loadingProducts && filtered.length > 0 && (
        <div className="mb-2.5 flex items-center gap-3 text-[12.5px] text-[#556A7C]">
          {selectedIds.size > 0 ? (
            <>
              <span className="font-bold text-[#0F2A1B]">
                {selectedIds.size} {selectedIds.size === 1 ? "seleccionado" : "seleccionados"}
              </span>
              <span>· clic derecho para cambiar la categoría</span>
              <button onClick={() => { setSelectedIds(new Set()); setAnchorId(null); }} className="ml-auto font-bold text-[#556A7C] hover:text-[#0F2A1B]">
                Limpiar selección
              </button>
            </>
          ) : (
            <span>Clic para seleccionar · Shift para rango · Ctrl/Cmd para sumar · clic derecho para cambiar categoría</span>
          )}
        </div>
      )}

      {stockView === "table" && !loadingProducts && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE] bg-white">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#F7FAF8] text-left text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                <th className="px-4 py-2.5">Producto</th>
                <th className="px-4 py-2.5">Categoría</th>
                <th className="px-4 py-2.5 text-right">Precio</th>
                <th className="px-4 py-2.5 text-right">Mínimo</th>
                <th className="px-4 py-2.5 text-right">Stock</th>
                {canManage && <th className="px-4 py-2.5 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, index) => {
                const low = isLowStock(p);
                const selected = selectedIds.has(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={canManage ? (e) => handleRowClick(e, p, index) : undefined}
                    onContextMenu={canManage ? (e) => handleRowContextMenu(e, p) : undefined}
                    onDoubleClick={canManage ? () => { setEditing(p); setFormOpen(true); } : undefined}
                    className="border-t border-[#EEF1F6]"
                    style={{
                      cursor: canManage ? "pointer" : undefined,
                      background: selected ? "#E6F7EE" : undefined,
                      userSelect: canManage ? "none" : undefined,
                    }}
                  >
                    <td className="px-4 py-2 font-bold text-[#0F2A1B]">
                      <span className="flex items-center gap-2">
                        <span className="truncate">{p.name}</span>
                        {p.critical && <span className="whitespace-nowrap rounded-full bg-[#FBF1E0] px-2 py-0.5 text-[11px] font-bold text-[#9A6F12]">★ Crítico</span>}
                        {p.discount_pct > 0 && <span className="whitespace-nowrap rounded-full bg-[#E6F7EE] px-2 py-0.5 text-[11px] font-bold text-[#0a6e36]">-{p.discount_pct}%</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[#556A7C]">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: p.category_id ? catById.get(p.category_id)?.dot ?? "#556A7C" : "#5E6E7E" }} />
                        {p.category_id ? catById.get(p.category_id)?.label ?? "—" : "Sin categoría"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-[#556A7C]">{fmtCLP(p.price)}</td>
                    <td className="px-4 py-2 text-right text-[#5E6E7E]">{p.min_stock > 0 ? p.min_stock : "—"}</td>
                    <td className="px-4 py-2 text-right font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                      {p.is_service ? <span className="text-[12px] font-bold text-[#556A7C]">Servicio</span> : p.stock}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {!p.is_service && (
                            <>
                              <button onClick={() => adjustStock(p, -1)} title="Restar 1" className="flex size-[28px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[17px] text-[#556A7C]">–</button>
                              <button onClick={() => adjustStock(p, 1)} title="Sumar 1" className="flex size-[28px] items-center justify-center rounded-[9px] bg-[#D3F4E0] text-[17px]" style={{ color: "var(--brand)" }}>+</button>
                            </>
                          )}
                          <button onClick={() => { setEditing(p); setFormOpen(true); }} title="Editar producto" className="flex size-[28px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[#556A7C]">✎</button>
                          <button onClick={() => setConfirmDeleteId(p.id)} title="Eliminar producto" className="flex size-[28px] items-center justify-center rounded-[9px] border border-[#F5C2C2] bg-white text-[#D02E2E]">🗑</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {stockView === "blocks" && groups.map((g) => (
        <div key={g.key} className="mb-[26px]">
          <div className="mb-[13px] flex items-center gap-2.5">
            <span className="size-[9px] rounded-full" style={{ background: g.dot }} />
            <span className="text-[17px] font-black tracking-[-.01em] text-[#0F2A1B]">{g.label}</span>
            <span className="rounded-full bg-[#E7EFE8] px-2.5 py-0.5 text-xs font-bold text-[#0F2A1B]">{g.items.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,196px)] justify-start gap-3.5">
            {g.items.map((p) => {
              const low = isLowStock(p);
              return (
                <div key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-[#E1E5EE] bg-white" onDoubleClick={canManage ? () => { setEditing(p); setFormOpen(true); } : undefined}>
                  <div className="flex h-[140px] w-full items-center justify-center bg-[#EEF1F6]">
                    {p.img_url ? (
                      <img src={p.img_url} alt={p.name} className="size-full object-cover" />
                    ) : (
                      <span className="size-3 rounded-full" style={{ background: g.dot }} />
                    )}
                  </div>
                  <div className="flex flex-col px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1 truncate text-[15px] font-bold text-[#0F2A1B]">{p.name}</div>
                      {p.critical && (
                        <span className="whitespace-nowrap rounded-full bg-[#FBF1E0] px-2 py-0.5 text-[11px] font-bold text-[#9A6F12]">★ Crítico</span>
                      )}
                      {p.discount_pct > 0 && (
                        <span className="whitespace-nowrap rounded-full bg-[#E6F7EE] px-2 py-0.5 text-[11px] font-bold text-[#0a6e36]">-{p.discount_pct}%</span>
                      )}
                    </div>
                    <div className="mt-[3px] flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-bold text-[#556A7C]">{fmtCLP(p.price)}</span>
                      <span className="text-[11.5px] font-bold" style={{ color: low ? "#D02E2E" : "#5E6E7E" }}>
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
                            className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[#556A7C]"
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
                        {p.is_service ? (
                          <span className="rounded-full bg-[#EEF1F6] px-2.5 py-1 text-[12px] font-bold text-[#556A7C]">Servicio</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => adjustStock(p, -1)}
                              className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[18px] text-[#556A7C]"
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
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {p.is_service ? (
                          <span className="text-[11.5px] font-bold text-[#556A7C]">Servicio</span>
                        ) : (
                          <>
                            <span className="text-[11.5px] font-bold" style={{ color: low ? "#D02E2E" : "#5E6E7E" }}>
                              {low ? "Stock bajo" : "Stock"}
                            </span>
                            <span className="flex items-baseline gap-1">
                              <span className="text-[15px] font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                                {p.stock}
                              </span>
                              <span className="text-xs font-semibold text-[#5E6E7E]">u.</span>
                            </span>
                          </>
                        )}
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

      {ctxMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
          <div
            className="absolute min-w-[210px] rounded-xl border border-[#E1E5EE] bg-white py-1.5 shadow-[0_12px_40px_rgba(15,42,27,.18)]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-[#5E6E7E]">
              {selectedIds.size} {selectedIds.size === 1 ? "producto" : "productos"}
            </div>
            <div
              className="relative"
              onMouseEnter={() => setCtxSubmenuOpen(true)}
              onMouseLeave={() => setCtxSubmenuOpen(false)}
            >
              <button className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13.5px] font-bold text-[#2A3A2E] hover:bg-[#F2F7F4]">
                <span>Categoría</span>
                <span className="text-[#5E6E7E]">▸</span>
              </button>
              {ctxSubmenuOpen && (
                <div className="absolute left-full top-0 ml-0.5 max-h-[320px] min-w-[190px] overflow-auto rounded-xl border border-[#E1E5EE] bg-white py-1.5 shadow-[0_12px_40px_rgba(15,42,27,.18)]">
                  {allCategories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => applyCategoryToSelection(c.id)}
                      className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13.5px] font-bold text-[#2A3A2E] hover:bg-[#F2F7F4]"
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.dot ?? "#556A7C" }} />
                      <span className="truncate">{c.label}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => applyCategoryToSelection(null)}
                    className="mt-1 flex w-full items-center gap-2 border-t border-[#F0F2F7] px-3.5 py-2 text-left text-[13.5px] font-bold text-[#556A7C] hover:bg-[#F2F7F4]"
                  >
                    <span className="size-2.5 shrink-0 rounded-full bg-[#5E6E7E]" />
                    <span>Sin categoría</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDeleteId(null); }}>
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

    </div>
  );
}
