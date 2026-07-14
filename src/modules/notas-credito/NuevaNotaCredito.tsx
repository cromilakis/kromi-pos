import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession } from "@/data/work";
import { issueCreditNote, buscarVentaPorFolio, type SaleWithLines } from "@/data/sales";
import { issueCreditNoteDte } from "@/data/sii";
import { useBusiness, businessToNegocio } from "@/data/business";
import { fmtCLP } from "@/lib/money";
import { printCreditNote } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { getSkipPrint } from "@/lib/deviceConfig";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import type { PayMethod } from "@/modules/venta/PayDialog";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

interface NcLine {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  maxQty: number;
  restock: boolean;
  selected: boolean;
}

type Modo = "anular" | "devolver";

export function NuevaNotaCredito() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { branch, register } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const { data: openSession } = useOpenSession(register?.id);
  const sessionId = openSession?.id ?? null;

  const { data: business } = useBusiness(businessId);

  const [folioInput, setFolioInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundSale, setFoundSale] = useState<SaleWithLines | null>(null);
  const [lines, setLines] = useState<NcLine[]>([]);
  const [modo, setModo] = useState<Modo>("anular");
  const [method, setMethod] = useState<PayMethod>("efectivo");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const preloadedFolio = (location.state as { folio?: number } | null)?.folio;
  const preloadDone = useRef(false);

  useEffect(() => {
    if (preloadDone.current || !preloadedFolio || !branchId) return;
    preloadDone.current = true;
    setFolioInput(String(preloadedFolio));
    void handleBuscarFolio(preloadedFolio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadedFolio, branchId]);

  const boletaEmitida = foundSale?.dte_status === "emitida" && !!foundSale.dte_folio;

  const lineasActivas = modo === "anular" ? lines : lines.filter((l) => l.selected);
  const total = lineasActivas.reduce((s, l) => s + l.qty * l.price, 0);
  const canSave = boletaEmitida && lineasActivas.some((l) => l.qty > 0);

  async function handleBuscarFolio(folioOverride?: number) {
    const folio = folioOverride ?? Number(folioInput);
    if (!branchId || !folio) return;
    setSearching(true);
    try {
      const sale = await buscarVentaPorFolio(branchId, folio);
      if (!sale) {
        toast.error(`No se encontró la boleta #${folio}.`);
        return;
      }
      setFoundSale(sale);
      setModo("anular");
      setMethod(sale.method as PayMethod);
      setReason("");
      setLines(
        sale.lines.map((l) => ({
          product_id: l.product_id ?? "",
          name: l.name_snapshot,
          price: l.price_snapshot,
          qty: l.qty,
          maxQty: l.qty,
          restock: true,
          selected: false,
        })),
      );
    } catch (e) {
      notifyError(`No se pudo buscar la boleta.`, e instanceof Error ? e.message : e);
    } finally {
      setSearching(false);
    }
  }

  function resetBusqueda() {
    setFoundSale(null);
    setLines([]);
    setFolioInput("");
  }

  function setLineQty(idx: number, qty: number) {
    setLines((ls) =>
      ls.map((l, i) => (i === idx ? { ...l, qty: Math.min(Math.max(0, qty), l.maxQty) } : l)),
    );
  }
  function toggleRestock(idx: number) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, restock: !l.restock } : l)));
  }
  function toggleSelected(idx: number) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, selected: !l.selected } : l)));
  }

  async function handleEmitir() {
    if (!branchId || !foundSale) return;
    const usable = lineasActivas.filter((l) => l.qty > 0);
    if (!usable.length) {
      toast.error("Seleccione al menos una línea con cantidad.");
      return;
    }
    setBusy(true);
    try {
      const nc = await issueCreditNote({
        p_branch: branchId,
        p_session: sessionId,
        p_sale: foundSale.id,
        p_method: method,
        p_reason: reason.trim() || "Sin motivo",
        p_lines: usable.map((l) => ({ product_id: l.product_id, qty: l.qty, restock: l.restock })),
        p_cod_ref: modo === "anular" ? 1 : 3,
      });

      const em = await issueCreditNoteDte(nc.id);
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["credit-notes", branchId] });

      if (em.status !== "emitida" || !em.folio) {
        toast.error("La nota de crédito quedó pendiente de emisión. Reintentar desde el listado.");
        navigate("/notas-credito");
        return;
      }

      if (getSkipPrint()) {
        toast.success(`Nota de crédito #${em.folio} emitida. Imprime desde el listado en la caja.`);
      } else {
        try {
          const createdAt = new Date(nc.created_at);
          await printCreditNote({
            negocio: businessToNegocio(business, getPrinterName()),
            folio: nc.folio,
            fecha: fmtDate(createdAt),
            hora: `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
            sale_folio: foundSale.dte_folio ?? foundSale.folio,
            metodo: nc.method,
            motivo: nc.reason ?? "Sin motivo",
            items: usable.map((l) => ({ nombre: l.name, qty: l.qty, precio: l.price })),
            neto: nc.neto,
            iva: nc.iva,
            total: nc.total,
            dte_folio: em.folio,
            timbre_png: em.timbre_png ?? null,
          });
        } catch (e) {
          notifyError(`La nota de crédito se emitió, pero no se pudo imprimir.`, e instanceof Error ? e.message : e);
        }

        toast.success(`Nota de crédito ${em.folio} emitida`);
      }
      navigate("/notas-credito");
    } catch (e) {
      notifyError(`No se pudo emitir la nota de crédito.`, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col px-[32px] py-[28px]">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => navigate("/notas-credito")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2 text-[13px] font-bold text-[#5a6b7e]"
        >
          <ArrowLeft className="size-4" strokeWidth={2.2} /> Volver al listado
        </button>
      </div>

      <div className="mb-5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Ventas</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Nueva nota de crédito</h2>
      </div>

      {!foundSale && (
        <div className="max-w-md rounded-2xl border border-[#E1E5EE] bg-white p-6">
          <label className="mb-1.5 block text-[12.5px] font-bold text-[#5a6b7e]">N° de boleta</label>
          <div className="flex gap-2.5">
            <input
              value={folioInput}
              onChange={(e) => setFolioInput(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Ej. 5002"
              className="flex-1 rounded-[11px] border border-[#E1E5EE] px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none"
            />
            <button
              onClick={() => handleBuscarFolio()}
              disabled={searching || !folioInput}
              className="rounded-[11px] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: "var(--brand)" }}
            >
              {searching ? "Buscando…" : "Buscar"}
            </button>
          </div>
        </div>
      )}

      {foundSale && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="max-w-2xl rounded-2xl border border-[#E1E5EE] bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[17px] font-black text-[#0F2A1B]">
                Boleta #{String(foundSale.dte_folio ?? foundSale.folio).padStart(4, "0")}
              </div>
              <button onClick={resetBusqueda} className="text-[13px] font-bold" style={{ color: "var(--brand)" }}>
                Buscar otra boleta
              </button>
            </div>

            {!boletaEmitida && (
              <div className="mb-4 rounded-xl border border-[#F3D9B1] bg-[#FBF1E0] px-3.5 py-2.5 text-[13px] font-bold text-[#9A6F12]">
                La boleta no está emitida en el SII.
              </div>
            )}

            <div className="mb-4 inline-flex gap-1 rounded-full bg-[#F0F2F7] p-1">
              <button
                onClick={() => setModo("anular")}
                className="rounded-full px-4 py-1.5 text-[13.5px] font-bold"
                style={modo === "anular" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}
              >
                Anular boleta completa
              </button>
              <button
                onClick={() => setModo("devolver")}
                className="rounded-full px-4 py-1.5 text-[13.5px] font-bold"
                style={modo === "devolver" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}
              >
                Devolver líneas seleccionadas
              </button>
            </div>

            <div className="mb-3.5 flex flex-col gap-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2.5 rounded-xl border border-[#E1E5EE] px-3 py-2.5">
                  {modo === "devolver" && (
                    <button
                      onClick={() => toggleSelected(idx)}
                      className="flex size-4 items-center justify-center rounded border"
                      style={l.selected ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" } : { borderColor: "#cdd5e3" }}
                    >
                      {l.selected ? "✓" : ""}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-[#0F2A1B]">{l.name}</div>
                    <div className="text-xs text-[#556A7C]">
                      {fmtCLP(l.price)} c/u · {fmtCLP(l.price * l.qty)}
                    </div>
                  </div>
                  <input
                    value={l.qty}
                    onChange={(e) => setLineQty(idx, Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
                    disabled={modo === "anular"}
                    inputMode="numeric"
                    className="w-14 rounded-lg border border-[#E1E5EE] px-2 py-2 text-center text-sm font-bold text-[#0F2A1B] outline-none disabled:bg-[#F8FAFC]"
                  />
                  <button
                    onClick={() => toggleRestock(idx)}
                    title="Reponer stock"
                    className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-[#5a6b7e]"
                  >
                    <span
                      className="flex size-4 items-center justify-center rounded border"
                      style={l.restock ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" } : { borderColor: "#cdd5e3" }}
                    >
                      {l.restock ? "✓" : ""}
                    </span>
                    Stock
                  </button>
                </div>
              ))}
            </div>

            <div className="mb-3 flex gap-2.5">
              <div className="flex-1">
                <label className="mb-1 block text-[12.5px] font-bold text-[#5a6b7e]">Medio de devolución</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayMethod)}
                  className="w-full rounded-[11px] border border-[#E1E5EE] bg-[#F8FAFC] px-3 py-2.5 text-sm font-bold text-[#0F2A1B] outline-none"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta (reverso)</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[12.5px] font-bold text-[#5a6b7e]">Total a devolver</label>
                <div className="rounded-[11px] border border-[#E1E5EE] px-3.5 py-2.5 text-base font-black text-[#c0392b]">{fmtCLP(total)}</div>
              </div>
            </div>

            <div className="mb-5">
              <label className="mb-1 block text-[12.5px] font-bold text-[#5a6b7e]">Motivo</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. producto defectuoso"
                className="w-full rounded-[11px] border border-[#E1E5EE] px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none"
              />
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => navigate("/notas-credito")}
                disabled={busy}
                className="flex-none rounded-xl border border-[#E1E5EE] bg-white px-5 py-3 text-[15px] font-bold text-[#2A3A2E] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEmitir}
                disabled={busy || !canSave}
                title={!boletaEmitida ? "La boleta no está emitida en el SII" : undefined}
                className="flex-1 rounded-xl py-3 text-[15px] font-bold text-white disabled:opacity-50"
                style={{ background: canSave ? "#c0392b" : "#e0a9a2" }}
              >
                {busy ? "Emitiendo…" : "Emitir nota de crédito"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
