import { useMemo, useState } from "react";
import { FileText, Grid3x3, Rows3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession } from "@/data/work";
import { useProductsWithStock, useCategories } from "@/data/stock";
import type { ProductRow } from "@/data/stock";
import { useCustomers } from "@/data/customers";
import { useBusiness, businessToNegocio } from "@/data/business";
import { createQuote, convertQuote, deleteQuote, useQuotes, isQuoteVigente, type QuoteRow } from "@/data/sales";
import { issueReceipt } from "@/data/sii";
import { computeTotals, resolveDiscount, fmtCLP } from "@/lib/money";
import { printQuote, printReceipt } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { getSkipPrint } from "@/lib/deviceConfig";
import { errMsg, notifyError } from "@/lib/errors";
import { PayDialog, type PayMethod } from "@/modules/venta/PayDialog";

interface QuoteItem { id: string; qty: number; disc: number; }

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function fmtDate(d: Date): string { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
function fmtIsoDate(iso: string): string { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

export function CotizacionesScreen() {
  const { profile } = useAuth();
  const { branch, register } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const qc = useQueryClient();

  const { data: openSession } = useOpenSession(register?.id);
  const { data: products } = useProductsWithStock(businessId, branchId);
  const { data: categories } = useCategories(businessId);
  const { data: customers } = useCustomers(businessId);
  const { data: business } = useBusiness(businessId);
  const { data: quotes, isLoading } = useQuotes(branchId);

  const [tab, setTab] = useState<"lista" | "nueva">("lista");
  const [catView, setCatView] = useState<"paneles" | "tabla">("paneles");
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [lines, setLines] = useState<QuoteItem[]>([]);
  const [globalDisc, setGlobalDisc] = useState(0);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [validDays, setValidDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<QuoteRow | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<QuoteRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const allProducts = products ?? [];
  const allCategories = categories ?? [];
  const allCustomers = customers ?? [];
  const catById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);
  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
  const negocio = useMemo(() => businessToNegocio(business, getPrinterName()), [business]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (catFilter !== "todas" && p.category_id !== catFilter) return false;
      return true;
    });
  }, [allProducts, query, catFilter]);

  const quoteLines = useMemo(
    () => lines.map((l) => ({ product: productById.get(l.id)!, qty: l.qty, disc: l.disc })).filter((l) => l.product),
    [lines, productById],
  );

  // Subtotal después del descuento de línea (base para el descuento global), igual que el servidor.
  const subAfterLine = useMemo(
    () => quoteLines.reduce((s, l) => s + (l.qty * l.product.price - resolveDiscount(l.qty * l.product.price, "pct", l.disc)), 0),
    [quoteLines],
  );
  const globalDiscAmount = useMemo(() => resolveDiscount(subAfterLine, "pct", globalDisc), [subAfterLine, globalDisc]);
  const totals = useMemo(
    () => computeTotals(
      quoteLines.map((l) => ({ qty: l.qty, price: l.product.price, discount: resolveDiscount(l.qty * l.product.price, "pct", l.disc) })),
      globalDiscAmount,
    ),
    [quoteLines, globalDiscAmount],
  );

  function addLine(p: ProductRow) {
    setLines((ls) => {
      const i = ls.findIndex((x) => x.id === p.id);
      if (i >= 0) { const n = ls.slice(); n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
      return [...ls, { id: p.id, qty: 1, disc: 0 }];
    });
  }
  function setQty(id: string, qty: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  }
  function setLineDisc(id: string, disc: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, disc: clampPct(disc) } : l)));
  }
  function removeLine(id: string) { setLines((ls) => ls.filter((l) => l.id !== id)); }

  function resetForm() {
    setLines([]);
    setGlobalDisc(0);
    setCustomerId(null);
    setValidDays(7);
    setQuery("");
    setCatFilter("todas");
  }

  async function handleCrear() {
    if (!branchId || lines.length === 0) return;
    setCreating(true);
    try {
      const quote = await createQuote({
        branch_id: branchId,
        customer_id: customerId,
        valid_until: isoPlusDays(validDays),
        lines: lines.map((l) => ({ product_id: l.id, qty: l.qty, discount_pct: l.disc })),
        discount_pct: globalDisc,
      });
      toast.success(`Cotización #${quote.folio} generada.`);
      const itemsSnap = quoteLines.map((l) => ({
        nombre: l.product.name, qty: l.qty, precio: l.product.price,
        descuento: resolveDiscount(l.qty * l.product.price, "pct", l.disc),
      }));
      const globalSnap = globalDiscAmount;
      const clienteSnap = customerId ? (allCustomers.find((c) => c.id === customerId)?.name ?? "Sin cliente") : "Sin cliente";
      resetForm();
      setTab("lista");
      qc.invalidateQueries({ queryKey: ["quotes"] });
      if (!getSkipPrint()) {
        try {
          await printQuote({
            negocio,
            folio: quote.folio,
            fecha: fmtDate(new Date()),
            valido_hasta: fmtIsoDate(quote.valid_until),
            cliente: clienteSnap,
            items: itemsSnap,
            neto: quote.neto,
            iva: quote.iva,
            total: quote.total,
            descuento: globalSnap,
          });
        } catch (e) {
          notifyError(`La cotización se generó, pero no se pudo imprimir.`, errMsg(e));
        }
      }
    } catch (e) {
      notifyError(`No se pudo generar la cotización.`, errMsg(e));
    } finally {
      setCreating(false);
    }
  }

  async function handlePrint(q: QuoteRow) {
    try {
      await printQuote({
        negocio,
        folio: q.folio,
        fecha: fmtIsoDate(q.created_at.slice(0, 10)),
        valido_hasta: fmtIsoDate(q.valid_until),
        cliente: q.customer_name ?? "Sin cliente",
        items: q.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot, descuento: l.discount_amount })),
        neto: q.neto,
        iva: q.iva,
        total: q.total,
        descuento: q.discount_amount,
      });
    } catch (e) {
      notifyError(`No se pudo imprimir la cotización.`, errMsg(e));
    }
  }

  function tryCobrar(q: QuoteRow) {
    if (!openSession) {
      toast.error("Abre la caja para cobrar la cotización.");
      return;
    }
    setConverting(q);
  }

  async function handleConfirmCobro(method: PayMethod, recv: number, _discountId: string | null) {
    if (!converting || !openSession) return;
    setPayBusy(true);
    try {
      // Cobra la cotización: crea la venta (descuenta stock) igual que una venta normal.
      const sale = await convertQuote(converting.id, openSession.id, method, recv);
      const soldAt = new Date(sale.sold_at);
      const quoteSnap = converting;
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["sales-today"] });
      qc.invalidateQueries({ queryKey: ["recent-sales"] });
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["customers", businessId] });

      // Emite la boleta electrónica; si falla, NO se imprime nada: la venta queda en
      // «Boletas del día» del módulo de ventas para reintentar.
      let dteFolio: number | undefined;
      let timbrePng: string | null | undefined;
      try {
        const em = await issueReceipt(sale.id);
        if (em.status === "emitida") { dteFolio = em.folio; timbrePng = em.timbre_png ?? null; }
        else notifyError("La boleta no se pudo emitir. Quedó pendiente en «Boletas del día» para reintentar.", em.message ?? em.status);
      } catch {
        toast.error("La boleta no se pudo emitir (sin conexión con el SII). Quedó pendiente en «Boletas del día» para reintentar.");
      }
      qc.invalidateQueries({ queryKey: ["sales-today-dte", branchId] });
      setConverting(null);

      if (dteFolio) {
        if (getSkipPrint()) {
          toast.success(`Venta #${sale.folio} cobrada (boleta ${dteFolio}). Imprime desde «Boletas del día».`);
        } else {
          toast.success(`Venta #${sale.folio} cobrada (boleta ${dteFolio}).`);
          try {
            await printReceipt({
              negocio,
              folio: sale.folio,
              fecha: fmtDate(soldAt),
              hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
              items: quoteSnap.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot, descuento: l.discount_amount })),
              neto: sale.neto,
              iva: sale.iva,
              total: sale.total,
              descuento: quoteSnap.discount_amount,
              dte_folio: dteFolio,
              timbre_png: timbrePng ?? null,
              reimpresion: false,
              metodo: sale.method,
              open_drawer: sale.method === "efectivo",
            });
          } catch (e) {
            notifyError(`Boleta emitida (folio ${dteFolio}) pero no se pudo imprimir. Reimprime desde «Boletas del día».`, errMsg(e));
          }
        }
      }
    } catch (e) {
      notifyError(`No se pudo cobrar la cotización.`, errMsg(e));
    } finally {
      setPayBusy(false);
    }
  }

  async function handleDelete(q: QuoteRow) {
    setDeleting(true);
    try {
      await deleteQuote(q.id);
      toast.success(`Cotización #${q.folio} eliminada.`);
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["quotes"] });
    } catch (e) {
      notifyError(`No se pudo eliminar la cotización.`, errMsg(e));
    } finally {
      setDeleting(false);
    }
  }

  const rows = quotes ?? [];

  const tabBtn = (id: "lista" | "nueva", label: string) => (
    <button
      onClick={() => setTab(id)}
      className="relative px-1 pb-2.5 text-[14.5px] font-bold"
      style={{ color: tab === id ? "var(--brand)" : "#5a6b7e" }}
    >
      {label}
      {tab === id && <span className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full" style={{ background: "var(--brand)" }} />}
    </button>
  );

  const discInput = (value: number, onChange: (n: number) => void, w = "w-14") => (
    <div className={`flex items-center rounded-lg border border-[#E1E5EE] bg-white ${w}`}>
      <input
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        inputMode="numeric"
        placeholder="0"
        className="w-full min-w-0 rounded-l-lg bg-transparent py-1.5 pl-2 text-right text-[13px] font-bold text-[#0F2A1B] outline-none"
      />
      <span className="pr-2 text-[12px] font-bold text-[#556A7C]">%</span>
    </div>
  );

  return (
    <div className="relative flex h-full flex-col px-[32px] py-[28px]">
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Ventas</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Cotizaciones</h2>
      </div>

      <div className="mb-5 flex items-center gap-6 border-b border-[#E1E5EE]">
        {tabBtn("lista", `Cotizaciones${rows.length ? ` (${rows.length})` : ""}`)}
        {tabBtn("nueva", "Nueva cotización")}
      </div>

      {tab === "lista" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading && <div className="py-6 text-center text-[13px] text-[#5E6E7E]">Cargando cotizaciones…</div>}
          {!isLoading && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#E1E5EE] bg-white py-12 text-center">
              <div className="text-[15px] font-bold text-[#556A7C]">Aún no hay cotizaciones.</div>
              <button
                onClick={() => setTab("nueva")}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
                style={{ background: "var(--brand)" }}
              >
                <Plus className="size-4" strokeWidth={2.2} /> Nueva cotización
              </button>
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            {rows.map((q) => {
              const vigente = isQuoteVigente(q.valid_until);
              const items = q.lines.reduce((s, l) => s + l.qty, 0);
              const badge = q.converted
                ? { label: "Convertida", bg: "#EAF0FF", fg: "#1d4ed8" }
                : vigente ? { label: "Vigente", bg: "#E6F7EE", fg: "#0a6e36" } : { label: "Vencida", bg: "#FCECEC", fg: "#c0392b" };
              const canConvert = !q.converted && vigente;
              return (
                <div key={q.id} className="flex items-center gap-4 rounded-2xl border border-[#E1E5EE] bg-white px-[18px] py-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-extrabold text-[#0F2A1B]">COT-{q.folio} · {q.customer_name ?? "Sin cliente"}</div>
                    <div className="mt-0.5 text-[12.5px] text-[#556A7C]">{fmtIsoDate(q.created_at.slice(0, 10))} · Vence {fmtIsoDate(q.valid_until)} · {items} ítems</div>
                  </div>
                  <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                  <div className="text-base font-black text-[#0F2A1B]">{fmtCLP(q.total)}</div>
                  <button onClick={() => handlePrint(q)} className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-2 text-[13px] font-bold text-[#5a6b7e]">Imprimir</button>
                  <button
                    onClick={() => tryCobrar(q)}
                    disabled={!canConvert}
                    className="rounded-[10px] px-3.5 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "var(--brand)" }}
                  >
                    Cobrar
                  </button>
                  <button
                    onClick={() => setConfirmDelete(q)}
                    disabled={q.converted}
                    title={q.converted ? "No se puede eliminar una cotización convertida" : "Eliminar cotización"}
                    className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[#F5C2C2] bg-white text-[#D02E2E] hover:bg-[#FDECEC] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="size-[15px]" strokeWidth={1.9} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Catálogo de productos (paneles / tabla) */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-[#E1E5EE] bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar producto por nombre…"
                className="min-w-0 flex-1 rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none focus:border-[var(--brand)]"
              />
              <div className="flex shrink-0 items-center gap-1 rounded-xl border border-[#E1E5EE] bg-[#F6F7FB] p-1">
                <button onClick={() => setCatView("paneles")} title="Ver como paneles" className="flex size-8 items-center justify-center rounded-lg" style={catView === "paneles" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}>
                  <Grid3x3 className="size-[18px]" strokeWidth={1.9} />
                </button>
                <button onClick={() => setCatView("tabla")} title="Ver como tabla" className="flex size-8 items-center justify-center rounded-lg" style={catView === "tabla" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}>
                  <Rows3 className="size-[18px]" strokeWidth={1.9} />
                </button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {[{ id: "todas", label: "Todas" }, ...allCategories.map((c) => ({ id: c.id, label: c.label }))].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCatFilter(c.id)}
                  className="rounded-full border px-[13px] py-[6px] text-[12.5px] font-bold"
                  style={catFilter === c.id
                    ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                    : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[#5E6E7E]">Ningún producto coincide con la búsqueda o el filtro.</div>
              ) : catView === "paneles" ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {filtered.map((p) => {
                    const dot = catById.get(p.category_id ?? "")?.dot ?? "#556A7C";
                    return (
                      <button
                        key={p.id}
                        onClick={() => addLine(p)}
                        className="relative flex flex-col overflow-hidden rounded-2xl border border-[#E1E5EE] bg-white text-left hover:border-[#A7E3C0]"
                      >
                        <div className="flex h-[104px] w-full items-center justify-center bg-[#EEF1F6]">
                          {p.img_url ? (
                            <img src={p.img_url} alt={p.name} className="size-full object-cover" />
                          ) : (
                            <span className="size-3 rounded-full" style={{ background: dot }} />
                          )}
                        </div>
                        <div className="w-full px-3 py-2">
                          <div className="mb-0.5 truncate text-[13.5px] font-bold text-[#0F2A1B]">{p.name}</div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-base font-black text-[#0F2A1B]">{fmtCLP(p.price)}</span>
                            <span className="flex size-[26px] items-center justify-center rounded-lg bg-[#D3F4E0] text-lg" style={{ color: "var(--brand)" }}>+</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <table className="w-full border-collapse text-[14px]">
                  <thead>
                    <tr className="sticky top-0 bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                      <th className="px-3 py-2.5">Producto</th>
                      <th className="px-3 py-2.5">Categoría</th>
                      <th className="px-3 py-2.5 text-right">Precio</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id} className="border-t border-[#EEF1F6] hover:bg-[#FAFBFD]">
                        <td className="px-3 py-2.5 font-bold text-[#0F2A1B]">{p.name}</td>
                        <td className="px-3 py-2.5 text-[13px] text-[#556A7C]">{catById.get(p.category_id ?? "")?.label ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-[#0F2A1B]">{fmtCLP(p.price)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button onClick={() => addLine(p)} className="inline-flex size-[28px] items-center justify-center rounded-lg bg-[#D3F4E0] text-lg" style={{ color: "var(--brand)" }}>+</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Cotización actual — panel pegado a la derecha */}
          <div className="flex w-[380px] shrink-0 flex-col rounded-2xl border border-[#E1E5EE] bg-white">
            <div className="border-b border-[#EEF1F6] px-4 py-3 text-[15px] font-black text-[#0F2A1B]">Cotización actual</div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {quoteLines.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[#5E6E7E]">Elige productos del catálogo para armar la cotización.</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {quoteLines.map(({ product, qty, disc }) => {
                    const lineDisc = resolveDiscount(qty * product.price, "pct", disc);
                    const lineTotal = qty * product.price - lineDisc;
                    return (
                      <div key={product.id} className="rounded-xl border border-[#EEF1F6] p-2.5">
                        <div className="mb-2 flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13.5px] font-bold text-[#0F2A1B]">{product.name}</div>
                            <div className="text-[12px] text-[#556A7C]">{fmtCLP(product.price)} c/u</div>
                          </div>
                          <button onClick={() => removeLine(product.id)} title="Quitar" className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[#F5C2C2] bg-white text-[#D02E2E] hover:bg-[#FDECEC]">
                            <Trash2 className="size-[14px]" strokeWidth={1.9} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#556A7C]">
                              Cant.
                              <input
                                value={qty}
                                onChange={(e) => setQty(product.id, Number(e.target.value.replace(/[^\d]/g, "")) || 1)}
                                inputMode="numeric"
                                className="w-14 rounded-lg border border-[#E1E5EE] bg-white py-1.5 text-center text-[14px] font-black text-[#0F2A1B] outline-none focus:border-[var(--brand)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#556A7C]">
                              Desc.
                              {discInput(disc, (n) => setLineDisc(product.id, n))}
                            </label>
                          </div>
                          <div className="text-right">
                            {lineDisc > 0 && <div className="text-[11px] text-[#5E6E7E] line-through">{fmtCLP(qty * product.price)}</div>}
                            <div className="text-[14px] font-black text-[#0F2A1B]">{fmtCLP(lineTotal)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pie: descuento global, totales y controles — siempre visible */}
            <div className="border-t border-[#E1E5EE] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-[#556A7C]">Descuento cotización</span>
                {discInput(globalDisc, setGlobalDisc, "w-16")}
              </div>
              <div className="mb-2 text-[12.5px] text-[#556A7C]">
                <div className="flex justify-between"><span>Subtotal</span><span>{fmtCLP(totals.neto)}</span></div>
                {totals.discount > 0 && (
                  <div className="flex justify-between font-bold text-[#D02E2E]"><span>Descuento total</span><span>-{fmtCLP(totals.discount)}</span></div>
                )}
                <div className="flex justify-between"><span>IVA 19%</span><span>{fmtCLP(totals.iva)}</span></div>
              </div>
              <div className="mb-3 flex items-baseline justify-between border-t border-[#EEF1F6] pt-2">
                <span className="text-[14px] font-bold text-[#556A7C]">Total ({totals.items})</span>
                <span className="text-[26px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <select
                    value={customerId ?? ""}
                    onChange={(e) => setCustomerId(e.target.value || null)}
                    className="min-w-0 flex-1 rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[13px] font-bold text-[#2A3A2E] outline-none"
                  >
                    <option value="">Sin cliente</option>
                    {allCustomers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                  <select
                    value={validDays}
                    onChange={(e) => setValidDays(Number(e.target.value))}
                    className="shrink-0 rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[13px] font-bold text-[#0F2A1B] outline-none"
                  >
                    <option value={7}>7 días</option>
                    <option value={15}>15 días</option>
                    <option value={30}>30 días</option>
                  </select>
                </div>
                <button
                  onClick={handleCrear}
                  disabled={creating || lines.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl px-6 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "var(--brand)" }}
                >
                  <FileText className="size-4" strokeWidth={2} />
                  {creating ? "Generando…" : "Generar cotización"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PayDialog
        open={!!converting}
        total={converting?.total ?? 0}
        busy={payBusy}
        discounts={[]}
        onClose={() => setConverting(null)}
        onConfirm={handleConfirmCobro}
      />

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDelete(null); }}
        >
          <div className="w-[400px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[15px] font-extrabold text-[#0F2A1B]">¿Eliminar la cotización #{confirmDelete.folio}?</div>
            <div className="mb-4 text-[13px] text-[#556A7C]">Esta acción no se puede deshacer.</div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {deleting ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
