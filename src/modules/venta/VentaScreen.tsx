import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession, rpcAbrirCaja } from "@/data/work";
import { useProductsWithStock, useCategories, findByBarcode } from "@/data/stock";
import type { ProductRow } from "@/data/stock";
import { useCustomers } from "@/data/customers";
import { useBusiness, businessToNegocio } from "@/data/business";
import { useHeldSales, holdSale, deleteHeldSale, type HeldSaleRow } from "@/data/heldSales";
import { cobrarVenta, cartToLines } from "@/data/sales";
import { computeTotals, resolveDiscount, fmtCLP } from "@/lib/money";
import { errMsg } from "@/lib/errors";
import { printReceipt } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Cart, type CartLine } from "./Cart";
import { PayDialog, type PayMethod } from "./PayDialog";
import { CreditNoteDialog } from "./CreditNoteDialog";
import { CierrePanel } from "@/modules/cierre/CierrePanel";

interface CartItem {
  id: string;
  qty: number;
  disc_kind?: "pct" | "amount" | null;
  disc_value?: number;
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
      await rpcAbrirCaja(register.id, Number(floatAmount) || 0);
      await qc.invalidateQueries({ queryKey: ["open-session"] });
    } catch (e) {
      toast.error(`No se pudo abrir la caja: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-sm space-y-3 p-6 text-center">
        <h2 className="text-lg font-black text-[#0F2A1B]">La caja está cerrada</h2>
        <p className="text-sm text-[#7C95A8]">Abre la caja para comenzar a registrar ventas de este turno.</p>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-[#7C95A8]">$</span>
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

  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ncOpen, setNcOpen] = useState(false);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [totalDisc, setTotalDisc] = useState<{ kind: "pct" | "amount"; value: number } | null>(null);
  const canDiscount = profile?.role === "admin" || profile?.role === "kromi";

  const allCustomers = customers ?? [];

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
      if (items && items.length) out.push({ key: id, label: catById.get(id)?.label ?? "—", dot: catById.get(id)?.dot ?? "#7C95A8", items });
    }
    const none = byCat.get("__none__");
    if (none && none.length) out.push({ key: "__none__", label: "Sin categoría", dot: "#9aa8bd", items: none });
    return out;
  }, [filtered, allCategories, catById]);

  const cartLines: CartLine[] = useMemo(
    () => cart.map((c) => ({ product: productById.get(c.id)!, qty: c.qty, disc_kind: c.disc_kind ?? null, disc_value: c.disc_value ?? 0 })).filter((l) => l.product),
    [cart, productById],
  );
  const totals = useMemo(() => {
    const lines = cartLines.map((l) => ({
      qty: l.qty,
      price: l.product.price,
      discount: resolveDiscount(l.qty * l.product.price, l.disc_kind ?? null, l.disc_value ?? 0),
    }));
    const sub = lines.reduce((s, l) => s + l.qty * l.price - (l.discount ?? 0), 0);
    const totalDiscMonto = totalDisc ? resolveDiscount(sub, totalDisc.kind, totalDisc.value) : 0;
    return computeTotals(lines, totalDiscMonto);
  }, [cartLines, totalDisc]);

  function inCart(id: string): number {
    return cart.find((c) => c.id === id)?.qty ?? 0;
  }
  function avail(p: ProductRow): number {
    return p.stock - inCart(p.id);
  }

  function addToCart(p: ProductRow) {
    if (avail(p) <= 0) {
      toast.error(`${p.name}: sin stock disponible.`);
      return;
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
      if (!p || c[i].qty + 1 > p.stock) return c;
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
    setTotalDisc(null);
  }

  function setLineDiscount(id: string, kind: "pct" | "amount" | null, value: number) {
    setCart((c) => c.map((x) => (x.id === id ? { ...x, disc_kind: kind, disc_value: value } : x)));
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
      toast.success("Venta guardada.");
      qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
    } catch (e) {
      toast.error(`No se pudo guardar la venta: ${errMsg(e)}`);
    }
  }

  async function resumeHeld(h: HeldSaleRow) {
    // Reconstruye el carrito con los productos que aún existen, ajustando al stock actual.
    let ajustes = 0;
    const next: CartItem[] = [];
    for (const item of h.cart) {
      const p = productById.get(item.product_id);
      if (!p) { ajustes++; continue; }
      const qty = Math.min(item.qty, p.stock);
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
      toast.error(`No se pudo quitar la venta guardada: ${errMsg(e)}`);
    }
    if (ajustes > 0) toast.warning("Algunas líneas se ajustaron por stock o productos no disponibles.");
  }

  async function discardHeld(id: string) {
    try {
      await deleteHeldSale(id);
      qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
    } catch (e) {
      toast.error(`No se pudo descartar: ${errMsg(e)}`);
    }
  }

  function pad2(n: number): string {
    return String(n).padStart(2, "0");
  }

  async function handleConfirmPay(method: PayMethod, recv: number) {
    if (!branchId || !openSession) return;
    setBusy(true);
    try {
      const sale = await cobrarVenta({
        p_branch: branchId,
        p_session: openSession.id,
        p_lines: cartToLines(cart),
        p_method: method,
        p_recv: recv,
        p_customer: customerId,
        p_total_disc: totalDisc,
      });

      // Venta confirmada en BD: limpiar carrito, refrescar datos e imprimir la boleta.
      const soldLines = cartLines;
      setCart([]);
      setTotalDisc(null);
      setPayOpen(false);
      toast.success(`Venta #${sale.folio} cobrada.`);
      qc.invalidateQueries({ queryKey: ["sales-today"] });
      qc.invalidateQueries({ queryKey: ["recent-sales"] });
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["customers", businessId] });
      setCustomerId(null);

      const soldAt = new Date(sale.sold_at);
      // Forma esperada por `print_receipt` (struct ReceiptPayload en src-tauri/src/escpos.rs).
      const payload = {
        negocio: businessToNegocio(business, getPrinterName()),
        folio: sale.folio,
        fecha: `${pad2(soldAt.getDate())}/${pad2(soldAt.getMonth() + 1)}/${soldAt.getFullYear()}`,
        hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
        items: soldLines.map((l) => ({ nombre: l.product.name, qty: l.qty, precio: l.product.price })),
        neto: sale.neto,
        iva: sale.iva,
        total: sale.total,
        descuento: sale.discount_amount + soldLines.reduce((s, l) => s + resolveDiscount(l.qty * l.product.price, l.disc_kind ?? null, l.disc_value ?? 0), 0),
        metodo: sale.method,
        open_drawer: sale.method === "efectivo",
      };
      try {
        await printReceipt(payload);
      } catch (e) {
        toast.error(`La venta se registró, pero no se pudo imprimir la boleta: ${e instanceof Error ? e.message : e}`);
      }
    } catch (e) {
      toast.error(`No se pudo cobrar la venta: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  // Diálogo de cierre de caja: se mantiene montado en una posición estable del árbol tanto si
  // hay sesión abierta como si no, para no perder el resumen del cierre cuando `openSession`
  // pasa a null justo después de confirmar (la venta pedirá reabrir caja).
  const cierreDialog = cierreOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
      onClick={() => setCierreOpen(false)}
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
          <div className="flex max-w-[420px] flex-1 items-center gap-2.5 rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar planta, maceta, accesorio…"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#0F2A1B] outline-none"
            />
          </div>
          <select
            value={customerId ?? ""}
            onChange={(e) => setCustomerId(e.target.value || null)}
            title="Cliente de la venta"
            className="rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-[13px] font-bold text-[#2A3A2E] outline-none"
          >
            <option value="">Sin cliente</option>
            {allCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setHeldOpen(true)}
            className="rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            Guardadas{heldSales && heldSales.length > 0 ? ` (${heldSales.length})` : ""}
          </button>
          <button
            onClick={() => setNcOpen(true)}
            className="rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            Nota de crédito
          </button>
          <button
            onClick={() => setCierreOpen(true)}
            className="rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            Cerrar caja
          </button>
        </div>

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
          {isLoading && <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">Cargando catálogo…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-[60px] text-center text-[#9aa8bd]">
              <div className="text-[16px] font-bold text-[#7C95A8]">Sin resultados</div>
              <div className="mt-[3px] text-[13.5px] text-[#9aa8bd]">Ningún producto coincide con la búsqueda o el filtro.</div>
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
                      className="flex flex-col overflow-hidden rounded-2xl border border-[#E1E5EE] bg-white text-left disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex h-[110px] w-full items-center justify-center bg-[#EEF1F6]">
                        {p.img_url ? (
                          <img src={p.img_url} alt={p.name} className="size-full object-cover" />
                        ) : (
                          <span className="size-3 rounded-full" style={{ background: g.dot }} />
                        )}
                      </div>
                      <div className="w-full px-3 pt-2.5 pb-2.5">
                        <div className="mb-1.5 truncate text-sm font-bold text-[#0F2A1B]">{p.name}</div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-bold" style={{ color: disabled ? "#D02E2E" : "#7C95A8" }}>
                            {disabled ? "Sin stock" : `${available} disp.`}
                          </span>
                          <span className="whitespace-nowrap text-base font-black text-[#0F2A1B]">{fmtCLP(p.price)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Cart lines={cartLines} totals={totals} onInc={incCart} onDec={decCart} onClear={clearCart} onHold={handleHold} onPay={() => setPayOpen(true)} canDiscount={canDiscount} totalDisc={totalDisc} onSetTotalDisc={setTotalDisc} onSetLineDisc={setLineDiscount} />

      <PayDialog open={payOpen} total={totals.total} busy={busy} onClose={() => setPayOpen(false)} onConfirm={handleConfirmPay} />

      <CreditNoteDialog
        open={ncOpen}
        branchId={branchId}
        sessionId={openSession?.id ?? null}
        products={allProducts}
        business={business}
        onClose={() => setNcOpen(false)}
        onEmitted={() => {
          qc.invalidateQueries({ queryKey: ["products-with-stock"] });
          qc.invalidateQueries({ queryKey: ["critical-stock"] });
        }}
      />

      {heldOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setHeldOpen(false)}>
          <div className="max-h-[80vh] w-[480px] max-w-full overflow-auto rounded-[22px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[18px] font-black text-[#0F2A1B]">Ventas guardadas</div>
              <button onClick={() => setHeldOpen(false)} className="rounded-lg border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] font-bold text-[#5a6b7e]">Cerrar</button>
            </div>
            {(!heldSales || heldSales.length === 0) ? (
              <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">No hay ventas guardadas.</div>
            ) : (
              heldSales.map((h) => {
                const cliente = h.customer_id ? (allCustomers.find((c) => c.id === h.customer_id)?.name ?? "Cliente") : "Sin cliente";
                const items = h.cart.reduce((s, it) => s + it.qty, 0);
                const hora = new Date(h.created_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={h.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-[#0F2A1B]">{cliente}</div>
                      <div className="text-xs text-[#7C95A8]">{hora} · {items} {items === 1 ? "ítem" : "ítems"} · {fmtCLP(h.total_snapshot)}</div>
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
    </div>
    {cierreDialog}
    </>
  );
}
