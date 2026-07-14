import { useMemo, useRef, useState } from "react";
import { Bookmark, Lock, Grid3x3, ScanLine, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession, rpcOpenCashSession } from "@/data/work";
import { useProductsWithStock, useCategories, findByBarcode } from "@/data/stock";
import type { ProductRow } from "@/data/stock";
import { useCustomers } from "@/data/customers";
import { useBusiness, businessToNegocio } from "@/data/business";
import { useActiveDiscounts } from "@/data/discounts";
import { useHeldSales, holdSale, deleteHeldSale, type HeldSaleRow } from "@/data/heldSales";
import { chargeSale, cartToLines, useSalesTodayDte, type SaleDteRow } from "@/data/sales";
import { issueReceipt } from "@/data/sii";
import { computeTotals, resolveDiscount, discountedPrice, fmtCLP } from "@/lib/money";
import { errMsg, notifyError } from "@/lib/errors";
import { printReceipt } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { getSkipPrint } from "@/lib/deviceConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Cart, type CartLine } from "./Cart";
import { PayDialog, type PayMethod } from "./PayDialog";
import { CustomerPickerDialog } from "./CustomerPickerDialog";
import { shouldPromptCustomer } from "./customerPrompt";
import { CierrePanel } from "@/modules/cierre/CierrePanel";

interface CartItem {
  id: string;
  qty: number;
}

/** Gate local de caja: si no hay sesión abierta en esta caja, ofrece abrirla en vez de mostrar el carrito. */
function AbrirCajaGate() {
  const { register } = useWork();
  const qc = useQueryClient();
  const [floatAmount, setFloatAmount] = useState("0");
  const [busy, setBusy] = useState(false);

  async function abrir() {
    if (!register) return;
    setBusy(true);
    try {
      await rpcOpenCashSession(register.id, Number(floatAmount) || 0);
      await qc.invalidateQueries({ queryKey: ["open-session"] });
    } catch (e) {
      notifyError(`No se pudo abrir la caja.`, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-sm space-y-3 p-6 text-center">
        <h2 className="text-lg font-black text-[#0F2A1B]">La caja está cerrada</h2>
        <p className="text-sm text-[#556A7C]">Abre la caja para comenzar a registrar ventas de este turno.</p>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-[#556A7C]">$</span>
          <Input value={floatAmount} inputMode="numeric" onChange={(e) => setFloatAmount(e.target.value)} className="pl-7" disabled={!register || busy} />
        </div>
        <Button className="w-full" style={{ background: "var(--brand)" }} onClick={abrir} disabled={!register || busy}>
          {busy ? "Abriendo…" : "Abrir caja"}
        </Button>
      </Card>
    </div>
  );
}

export function VentaScreen() {
  const { profile } = useAuth();
  const { branch, register } = useWork();
  const qc = useQueryClient();
  const businessId = profile?.business_id;
  const branchId = branch?.id;

  const { data: openSession } = useOpenSession(register?.id);
  const { data: products, isLoading } = useProductsWithStock(businessId, branchId);
  const { data: categories } = useCategories(businessId);
  const { data: customers } = useCustomers(businessId);
  const { data: business } = useBusiness(businessId);
  const { data: heldSales } = useHeldSales(branchId);
  const { data: activeDiscounts } = useActiveDiscounts(businessId);

  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [askedForCustomer, setAskedForCustomer] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [boletasOpen, setBoletasOpen] = useState(false);
  const { data: salesDte } = useSalesTodayDte(branchId);
  const [dteBusy, setDteBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"catalogo" | "lectura">("catalogo");
  const [scanQty, setScanQty] = useState(1);
  const scanRef = useRef<HTMLInputElement>(null);

  const allCustomers = customers ?? [];
  const selectedCustomer = customerId ? allCustomers.find((c) => c.id === customerId) ?? null : null;

  const allProducts = products ?? [];
  const allCategories = categories ?? [];
  const catById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);
  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
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
      if (items && items.length) out.push({ key: id, label: catById.get(id)?.label ?? "—", dot: catById.get(id)?.dot ?? "#556A7C", items });
    }
    const none = byCat.get("__none__");
    if (none && none.length) out.push({ key: "__none__", label: "Sin categoría", dot: "#5E6E7E", items: none });
    return out;
  }, [filtered, allCategories, catById]);

  const cartLines: CartLine[] = useMemo(
    () => cart.map((c) => ({ product: productById.get(c.id)!, qty: c.qty })).filter((l) => l.product),
    [cart, productById],
  );
  const totals = useMemo(() => {
    const lines = cartLines.map((l) => {
      const base = l.qty * l.product.price;
      return { qty: l.qty, price: l.product.price, discount: resolveDiscount(base, "pct", l.product.discount_pct ?? 0) };
    });
    return computeTotals(lines);
  }, [cartLines]);

  function inCart(id: string): number {
    return cart.find((c) => c.id === id)?.qty ?? 0;
  }
  function capacity(p: ProductRow): number {
    return p.is_service ? Infinity : p.stock;
  }
  function avail(p: ProductRow): number {
    return capacity(p) - inCart(p.id);
  }

  function addToCart(p: ProductRow) {
    if (avail(p) <= 0) {
      toast.error(`${p.name}: sin stock disponible.`);
      return;
    }
    if (shouldPromptCustomer(cart.length === 0, customerId, askedForCustomer)) {
      setAskedForCustomer(true);
      setPickerOpen(true);
    }
    setCart((c) => {
      const i = c.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const next = c.slice();
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...c, { id: p.id, qty: 1 }];
    });
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const match = findByBarcode(allProducts, query);
    if (match) {
      addToCart(match);
      setQuery("");
    }
  }

  function incCart(id: string) {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === id);
      if (i < 0) return c;
      const p = productById.get(id);
      if (!p || c[i].qty + 1 > capacity(p)) return c;
      const next = c.slice();
      next[i] = { ...next[i], qty: next[i].qty + 1 };
      return next;
    });
  }
  function decCart(id: string) {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === id);
      if (i < 0) return c;
      const q = c[i].qty - 1;
      if (q <= 0) return c.filter((x) => x.id !== id);
      const next = c.slice();
      next[i] = { ...next[i], qty: q };
      return next;
    });
  }
  function clearCart() {
    setCart([]);
    setAskedForCustomer(false);
  }

  function decCartAll(id: string) {
    setCart((c) => c.filter((x) => x.id !== id));
  }

  function addToCartQty(p: ProductRow, qty: number) {
    const current = cart.find((c) => c.id === p.id)?.qty ?? 0;
    const next = Math.min(current + qty, capacity(p));
    if (next <= 0) {
      toast.error(`${p.name}: sin stock disponible.`);
      return;
    }
    setCart((c) => {
      const i = c.findIndex((x) => x.id === p.id);
      if (i >= 0) { const n = c.slice(); n[i] = { ...n[i], qty: next }; return n; }
      return [...c, { id: p.id, qty: next }];
    });
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const match = findByBarcode(allProducts, query);
    if (match) {
      addToCartQty(match, Math.max(1, scanQty));
      setQuery("");
      setScanQty(1);
      scanRef.current?.focus();
    }
  }

  async function handleHold() {
    if (!businessId || !branchId || cart.length === 0) return;
    try {
      await holdSale({
        business_id: businessId,
        branch_id: branchId,
        cashier_id: profile?.id ?? null,
        customer_id: customerId,
        cart: cartToLines(cart),
        total_snapshot: totals.total,
      });
      setCart([]);
      setCustomerId(null);
      setAskedForCustomer(false);
      toast.success("Venta guardada.");
      qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
    } catch (e) {
      notifyError(`No se pudo guardar la venta.`, errMsg(e));
    }
  }

  async function resumeHeld(h: HeldSaleRow) {
    // Reconstruye el carrito con los productos que aún existen, ajustando al stock actual.
    let ajustes = 0;
    const next: CartItem[] = [];
    for (const item of h.cart) {
      const p = productById.get(item.product_id);
      if (!p) { ajustes++; continue; }
      const qty = Math.min(item.qty, p.is_service ? item.qty : p.stock);
      if (qty <= 0) { ajustes++; continue; }
      if (qty !== item.qty) ajustes++;
      next.push({ id: item.product_id, qty });
    }
    setCart(next);
    setCustomerId(h.customer_id);
    setHeldOpen(false);
    try {
      await deleteHeldSale(h.id);
      qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
    } catch (e) {
      notifyError(`No se pudo quitar la venta guardada.`, errMsg(e));
    }
    if (ajustes > 0) toast.warning("Algunas líneas se ajustaron por stock o productos no disponibles.");
  }

  async function discardHeld(id: string) {
    try {
      await deleteHeldSale(id);
      qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
    } catch (e) {
      notifyError(`No se pudo descartar.`, errMsg(e));
    }
  }

  function pad2(n: number): string {
    return String(n).padStart(2, "0");
  }

  async function reintentarBoleta(h: SaleDteRow) {
    setDteBusy(h.id);
    try {
      const em = await issueReceipt(h.id);
      if (em.status === "emitida") {
        toast.success(`Boleta emitida (folio ${em.folio}).`);
        qc.invalidateQueries({ queryKey: ["sales-today-dte", branchId] });
      } else {
        notifyError(`No se pudo emitir.`, em.message ?? em.status);
      }
    } finally {
      setDteBusy(null);
    }
  }

  async function reimprimirBoleta(h: SaleDteRow) {
    const soldAt = new Date(h.sold_at);
    const neto = Math.round(h.total / 1.19);
    const payload = {
      negocio: businessToNegocio(business, getPrinterName()),
      folio: h.folio,
      fecha: `${pad2(soldAt.getDate())}/${pad2(soldAt.getMonth() + 1)}/${soldAt.getFullYear()}`,
      hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
      items: h.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot, descuento: l.discount_amount ?? 0 })),
      neto,
      iva: h.total - neto,
      total: h.total,
      descuento: h.lines.reduce((s, l) => s + (l.discount_amount ?? 0), 0),
      dte_folio: h.dte_folio ?? undefined,
      timbre_png: h.dte_timbre ?? null,
      reimpresion: true,
      metodo: h.method,
      open_drawer: false,
    };
    try {
      await printReceipt(payload);
    } catch (e) {
      notifyError(`No se pudo imprimir.`, errMsg(e));
    }
  }

  async function handleConfirmPay(method: PayMethod, recv: number, discountId: string | null) {
    if (!branchId || !openSession) return;
    setBusy(true);
    try {
      const sale = await chargeSale({
        p_branch: branchId,
        p_session: openSession.id,
        p_lines: cartToLines(cart),
        p_method: method,
        p_recv: recv,
        p_customer: customerId,
        p_discount_id: discountId,
      });

      // Venta confirmada en BD: limpiar carrito, refrescar datos e imprimir la boleta.
      // El diálogo de cobro se cierra al FINAL (en finally), para que el botón quede
      // en estado "Cobrando…" durante toda la emisión SII + impresión de la boleta.
      const soldLines = cartLines;
      setCart([]);
      qc.invalidateQueries({ queryKey: ["sales-today"] });
      qc.invalidateQueries({ queryKey: ["recent-sales"] });
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["customers", businessId] });
      setCustomerId(null);
      setAskedForCustomer(false);

      // Emitir la boleta electrónica. La venta ya está cobrada; si la emisión falla,
      // NO se imprime nada: la venta queda pendiente en "Boletas del día" para reintentar.
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

      // Solo se imprime la boleta si fue emitida (con folio y timbre del SII).
      if (dteFolio) {
        if (getSkipPrint()) {
          toast.success(`Venta #${sale.folio} cobrada (boleta ${dteFolio}). Imprime desde «Boletas del día» en la caja.`);
        } else {
          const soldAt = new Date(sale.sold_at);
          const payload = {
            negocio: businessToNegocio(business, getPrinterName()),
            folio: sale.folio,
            fecha: `${pad2(soldAt.getDate())}/${pad2(soldAt.getMonth() + 1)}/${soldAt.getFullYear()}`,
            hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
            items: soldLines.map((l) => ({ nombre: l.product.name, qty: l.qty, precio: l.product.price, descuento: resolveDiscount(l.qty * l.product.price, "pct", l.product.discount_pct ?? 0) })),
            neto: sale.neto,
            iva: sale.iva,
            total: sale.total,
            descuento: soldLines.reduce((s, l) => s + resolveDiscount(l.qty * l.product.price, "pct", l.product.discount_pct ?? 0), 0),
            dte_folio: dteFolio,
            timbre_png: timbrePng ?? null,
            reimpresion: false,
            metodo: sale.method,
            open_drawer: sale.method === "efectivo",
          };
          try {
            await printReceipt(payload);
          } catch (e) {
            notifyError(`Boleta emitida (folio ${dteFolio}) pero no se pudo imprimir. Reimprime desde «Boletas del día».`, e instanceof Error ? e.message : e);
          }
        }
      }
    } catch (e) {
      notifyError(`No se pudo cobrar la venta.`, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
      setPayOpen(false);
    }
  }

  // Diálogo de cierre de caja: se mantiene montado en una posición estable del árbol tanto si
  // hay sesión abierta como si no, para no perder el resumen del cierre cuando `openSession`
  // pasa a null justo después de confirmar (la venta pedirá reabrir caja).
  const cierreDialog = cierreOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setCierreOpen(false); }}
    >
      <div
        className="max-h-[90vh] w-[980px] max-w-full overflow-auto rounded-[24px] bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button
            onClick={() => setCierreOpen(false)}
            className="rounded-xl border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            Cerrar
          </button>
        </div>
        <CierrePanel />
      </div>
    </div>
  );

  if (!openSession) {
    return (
      <>
        <AbrirCajaGate />
        {cierreDialog}
      </>
    );
  }

  return (
    <>
    <div className="flex h-full">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-[22px] pt-[18px]">
        <div className="mb-4 flex items-center gap-2.5">
          {mode === "catalogo" ? (
            <div className="flex max-w-[420px] flex-1 items-center gap-2.5 rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar planta, maceta, accesorio…"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#0F2A1B] outline-none"
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="inline-flex gap-1 rounded-full bg-[#F0F2F7] p-1">
            <button onClick={() => setMode("catalogo")} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold" style={mode === "catalogo" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}>
              <Grid3x3 className="size-4" strokeWidth={1.9} /> Catálogo
            </button>
            <button onClick={() => setMode("lectura")} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold" style={mode === "lectura" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}>
              <ScanLine className="size-4" strokeWidth={1.9} /> Lectura
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPickerOpen(true)}
              title="Cliente de la venta"
              className="rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-[13px] font-bold text-[#2A3A2E]"
            >
              {selectedCustomer ? selectedCustomer.name : "Sin cliente"}
            </button>
            {selectedCustomer && (
              <button onClick={() => setCustomerId(null)} title="Quitar cliente" className="flex size-[34px] items-center justify-center rounded-xl border border-[#E1E5EE] bg-white text-[#556A7C]">×</button>
            )}
          </div>
          <button
            onClick={() => setHeldOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            <Bookmark className="size-4" strokeWidth={1.9} /> Guardadas{heldSales && heldSales.length > 0 ? ` (${heldSales.length})` : ""}
          </button>
          <button
            onClick={() => setBoletasOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            <FileText className="size-4" strokeWidth={1.9} /> Boletas del día
          </button>
          <button
            onClick={() => setCierreOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            <Lock className="size-4" strokeWidth={1.9} /> Cerrar caja
          </button>
        </div>

        {mode === "lectura" ? (
          <div className="flex min-h-0 flex-1 flex-col pb-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5">
                <span className="text-[12.5px] font-bold text-[#556A7C]">Cantidad</span>
                <input value={scanQty || ""} onChange={(e) => setScanQty(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} inputMode="numeric" className="w-16 border-0 bg-transparent text-center text-lg font-black text-[#0F2A1B] outline-none" />
              </div>
              <div className="flex flex-1 items-center gap-2.5 rounded-xl border-2 bg-white px-4 py-2.5" style={{ borderColor: "var(--brand)" }}>
                <ScanLine className="size-5" strokeWidth={1.9} style={{ color: "var(--brand)" }} />
                <input ref={scanRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleScan} placeholder="Escanea o escribe el código y presiona Enter…" className="min-w-0 flex-1 border-0 bg-transparent text-base text-[#0F2A1B] outline-none" />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[#E1E5EE] bg-white">
              <table className="w-full border-collapse text-[15px]">
                <thead>
                  <tr className="bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3 text-right">P. unit</th>
                    <th className="px-4 py-3 text-center">Cantidad</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {cartLines.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-[14px] text-[#5E6E7E]">Escanea productos para agregarlos a la venta.</td></tr>
                  )}
                  {cartLines.map(({ product, qty }) => {
                    const unit = discountedPrice(product.price, product.discount_pct ?? 0);
                    return (
                    <tr key={product.id} className="border-t border-[#EEF1F6]">
                      <td className="px-4 py-3 font-bold text-[#0F2A1B]">
                        {product.name}
                        {product.discount_pct > 0 && (
                          <span className="ml-2 rounded-full bg-[#E6F7EE] px-2 py-0.5 text-[11px] font-black text-[#0a6e36]">-{product.discount_pct}%</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[#556A7C]">
                        {product.discount_pct > 0 ? (
                          <span className="inline-flex items-baseline justify-end gap-1.5">
                            <span className="text-[12px] text-[#5E6E7E] line-through">{fmtCLP(product.price)}</span>
                            <span className="font-bold text-[#0a6e36]">{fmtCLP(unit)}</span>
                          </span>
                        ) : fmtCLP(product.price)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => decCart(product.id)} className="flex size-7 items-center justify-center rounded-lg border border-[#E1E5EE] bg-white text-[#556A7C]">–</button>
                          <span className="min-w-6 text-center font-black text-[#0F2A1B]">{qty}</span>
                          <button onClick={() => incCart(product.id)} disabled={qty >= capacity(product)} className="flex size-7 items-center justify-center rounded-lg bg-[#D3F4E0] disabled:opacity-40" style={{ color: "var(--brand)" }}>+</button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-[#0F2A1B]">{fmtCLP(unit * qty)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            onClick={() => decCartAll(product.id)}
                            title="Quitar del carrito"
                            className="flex size-8 items-center justify-center rounded-lg border border-[#F5C2C2] bg-white text-[#D02E2E] hover:bg-[#FDECEC]"
                          >
                            <Trash2 className="size-[16px]" strokeWidth={1.9} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between gap-6 rounded-2xl border border-[#E1E5EE] bg-white px-5 py-4">
              <div className="flex items-center gap-6">
                <div className="text-[13px] text-[#556A7C]">
                  <div className="flex justify-between gap-4"><span>Subtotal</span><span>{fmtCLP(totals.neto)}</span></div>
                  <div className="flex justify-between gap-4"><span>IVA 19%</span><span>{fmtCLP(totals.iva)}</span></div>
                  {totals.discount > 0 && (
                    <div className="flex justify-between gap-4 font-bold text-[#D02E2E]"><span>Descuento</span><span>-{fmtCLP(totals.discount)}</span></div>
                  )}
                </div>
                <div className="flex items-baseline gap-2 border-l border-[#EEF1F6] pl-6">
                  <span className="text-[15px] font-bold text-[#556A7C]">Total</span>
                  <span className="text-[32px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
                </div>
              </div>
              <button onClick={() => setPayOpen(true)} disabled={cartLines.length === 0} className="rounded-[14px] px-8 py-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-[#EEF1F6] disabled:text-[#5E6E7E]" style={cartLines.length > 0 ? { background: "var(--brand)" } : undefined}>
                Cobrar
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[{ id: "todas", label: "Todas" }, ...allCategories.map((c) => ({ id: c.id, label: c.label }))].map((c) => (
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

        <div className="min-h-0 flex-1 overflow-auto pb-5">
          {isLoading && <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Cargando catálogo…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-[60px] text-center text-[#5E6E7E]">
              <div className="text-[16px] font-bold text-[#556A7C]">Sin resultados</div>
              <div className="mt-[3px] text-[13.5px] text-[#5E6E7E]">Ningún producto coincide con la búsqueda o el filtro.</div>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-6">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="size-[9px] rounded-full" style={{ background: g.dot }} />
                <span className="text-[17px] font-black tracking-[-.01em] text-[#0F2A1B]">{g.label}</span>
                <span className="rounded-full bg-[#E7EFE8] px-2.5 py-0.5 text-xs font-bold text-[#0F2A1B]">{g.items.length}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,196px)] justify-start gap-3.5">
                {g.items.map((p) => {
                  const available = avail(p);
                  const disabled = available <= 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      disabled={disabled}
                      className="relative flex flex-col overflow-hidden rounded-2xl border border-[#E1E5EE] bg-white text-left disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {p.discount_pct > 0 && (
                        <span className="absolute right-2 top-2 z-10 rounded-full bg-[#0a6e36] px-2 py-0.5 text-[11px] font-black text-white">
                          -{p.discount_pct}%
                        </span>
                      )}
                      <div className="flex h-[140px] w-full items-center justify-center bg-[#EEF1F6]">
                        {p.img_url ? (
                          <img src={p.img_url} alt={p.name} className="size-full object-cover" />
                        ) : (
                          <span className="size-3 rounded-full" style={{ background: g.dot }} />
                        )}
                      </div>
                      <div className="w-full px-3 py-2">
                        <div className="mb-0.5 truncate text-sm font-bold text-[#0F2A1B]">{p.name}</div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-bold" style={{ color: disabled ? "#D02E2E" : "#556A7C" }}>
                            {p.is_service ? "Servicio" : disabled ? "Sin stock" : `${available} disp.`}
                          </span>
                          {p.discount_pct > 0 ? (
                            <span className="flex items-baseline gap-1.5">
                              <span className="text-[11px] font-bold text-[#5E6E7E] line-through">{fmtCLP(p.price)}</span>
                              <span className="whitespace-nowrap text-base font-black text-[#0a6e36]">{fmtCLP(discountedPrice(p.price, p.discount_pct))}</span>
                            </span>
                          ) : (
                            <span className="whitespace-nowrap text-base font-black text-[#0F2A1B]">{fmtCLP(p.price)}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        </>
        )}
      </div>

      {mode === "catalogo" && (
        <Cart lines={cartLines} totals={totals} onInc={incCart} onDec={decCart} onClear={clearCart} onHold={handleHold} onPay={() => setPayOpen(true)} />
      )}

      <PayDialog open={payOpen} total={totals.total} busy={busy} discounts={activeDiscounts ?? []} onClose={() => setPayOpen(false)} onConfirm={handleConfirmPay} />

      <CustomerPickerDialog
        open={pickerOpen}
        businessId={businessId}
        onSelect={(c) => { setCustomerId(c.id); setPickerOpen(false); }}
        onContinueWithout={() => setPickerOpen(false)}
        onClose={() => setPickerOpen(false)}
      />

      {heldOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setHeldOpen(false); }}>
          <div className="max-h-[80vh] w-[480px] max-w-full overflow-auto rounded-[22px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[18px] font-black text-[#0F2A1B]">Ventas guardadas</div>
              <button onClick={() => setHeldOpen(false)} className="rounded-lg border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] font-bold text-[#5a6b7e]">Cerrar</button>
            </div>
            {(!heldSales || heldSales.length === 0) ? (
              <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">No hay ventas guardadas.</div>
            ) : (
              heldSales.map((h) => {
                const cliente = h.customer_id ? (allCustomers.find((c) => c.id === h.customer_id)?.name ?? "Cliente") : "Sin cliente";
                const items = h.cart.reduce((s, it) => s + it.qty, 0);
                const hora = new Date(h.created_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={h.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-[#0F2A1B]">{cliente}</div>
                      <div className="text-xs text-[#556A7C]">{hora} · {items} {items === 1 ? "ítem" : "ítems"} · {fmtCLP(h.total_snapshot)}</div>
                    </div>
                    <button
                      onClick={() => resumeHeld(h)}
                      className="rounded-[10px] px-3.5 py-2 text-[13px] font-bold text-white"
                      style={{ background: "var(--brand)" }}
                    >
                      Retomar
                    </button>
                    <button
                      onClick={() => discardHeld(h.id)}
                      title="Descartar"
                      className="flex size-[34px] items-center justify-center rounded-[10px] border border-[#F5C2C2] bg-white text-[#D02E2E]"
                    >
                      🗑
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {boletasOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setBoletasOpen(false); }}>
          <div className="max-h-[80vh] w-[560px] max-w-full overflow-auto rounded-[22px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[18px] font-black text-[#0F2A1B]">Boletas del día</div>
              <button onClick={() => setBoletasOpen(false)} className="rounded-lg border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] font-bold text-[#5a6b7e]">Cerrar</button>
            </div>
            {(!salesDte || salesDte.length === 0) ? (
              <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">No hay ventas hoy.</div>
            ) : (
              salesDte.map((h) => {
                const hora = new Date(h.sold_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
                const emitida = h.dte_status === "emitida";
                const badge = emitida
                  ? { label: `SII ${h.dte_folio}`, bg: "#E6F7EE", fg: "#0a6e36" }
                  : h.dte_status === "rechazada"
                    ? { label: "Rechazada", bg: "#FCECEC", fg: "#c0392b" }
                    : { label: "Pendiente", bg: "#FBF1E0", fg: "#9A6F12" };
                return (
                  <div key={h.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-[#0F2A1B]">Venta #{h.folio} · {fmtCLP(h.total)}</div>
                      <div className="text-xs text-[#556A7C]">{hora} · {h.method}</div>
                    </div>
                    <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                    {emitida ? (
                      <button onClick={() => reimprimirBoleta(h)} className="rounded-[10px] border border-[#E1E5EE] bg-white px-3.5 py-2 text-[13px] font-bold text-[#5a6b7e]">
                        Reimprimir
                      </button>
                    ) : (
                      <button onClick={() => reintentarBoleta(h)} disabled={dteBusy === h.id} className="rounded-[10px] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-60" style={{ background: "var(--brand)" }}>
                        {dteBusy === h.id ? "Emitiendo…" : "Reintentar"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
    {cierreDialog}
    </>
  );
}
