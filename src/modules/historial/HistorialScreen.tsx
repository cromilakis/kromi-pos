import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useSalesHistory, HISTORY_PAGE, type SaleHistoryRow } from "@/data/salesHistory";
import { markSalePrinted } from "@/data/sales";
import { CustomerPickerDialog } from "@/modules/venta/CustomerPickerDialog";
import { fmtCLP, globalDiscount } from "@/lib/money";
import { useBusiness, businessToNegocio } from "@/data/business";
import { getPrinterName } from "@/lib/printerConfig";
import { printReceipt } from "@/lib/print";
import { notifyError, errMsg } from "@/lib/errors";
import { getDtePdf } from "@/data/sii";
import { savePdfBase64 } from "@/lib/fileSave";
import { Eye, Printer, Undo2, FileText } from "lucide-react";

function todayLocalIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Estado de emisión (sin el número SII, que ahora se muestra como título de la venta). */
function dteBadge(row: SaleHistoryRow): { label: string; bg: string; fg: string } {
  if (row.dte_status === "emitida") return { label: "Emitida", bg: "#E6F7EE", fg: "#0a6e36" };
  if (row.dte_status === "rechazada") return { label: "Rechazada", bg: "#FCECEC", fg: "#c0392b" };
  return { label: "Pendiente", bg: "#FBF1E0", fg: "#9A6F12" };
}

/** Tipo de documento (Boleta o Factura). */
function docTypeBadge(row: SaleHistoryRow): { label: string; bg: string; fg: string } {
  if (row.doc_type === "factura") return { label: "Factura", bg: "#FEE8E8", fg: "#8B3A3A" };
  return { label: "Boleta", bg: "#F0F9F7", fg: "#1B5E59" };
}

/** Identificador visible de la venta: folio SII (#dte_folio) o marca de pendiente. */
function folioSii(row: { dte_folio: number | null }): string {
  return row.dte_folio ? `#${row.dte_folio}` : "— pendiente";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Método de pago con mayúscula inicial (Efectivo / Tarjeta). */
const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta" };
function metodoLabel(m: string): string {
  return METHOD_LABEL[m] ?? (m ? m.charAt(0).toUpperCase() + m.slice(1) : m);
}

/** Historial de ventas de la sucursal: filtros por fecha/cliente/folio y paginación. */
export function HistorialScreen() {
  const { profile } = useAuth();
  const { branch } = useWork();
  const qc = useQueryClient();
  const nav = useNavigate();
  const location = useLocation();
  const didInitFolio = useRef(false);
  const pendingDetailFolio = useRef<number | null>(null);
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const { data: business } = useBusiness(businessId);

  const [detail, setDetail] = useState<SaleHistoryRow | null>(null);

  const today = todayLocalIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [folioStr, setFolioStr] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SaleHistoryRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [appliedFrom, setAppliedFrom] = useState(today);
  const [appliedTo, setAppliedTo] = useState(today);
  const [appliedCustomerId, setAppliedCustomerId] = useState<string | null>(null);
  const [appliedFolio, setAppliedFolio] = useState<number | null>(null);

  const { data, isFetching } = useSalesHistory(branchId, {
    from: appliedFrom,
    to: appliedTo,
    customerId: appliedCustomerId,
    folio: appliedFolio,
    page,
  });

  useEffect(() => {
    if (!data) return;
    setRows((prev) => (page === 0 ? data : [...prev, ...data]));
  }, [data, page]);

  // Pre-carga del filtro por folio SII cuando se llega desde la actividad reciente
  // del Inicio (navigate("/historial", { state: { folio } })). Disparo único.
  useEffect(() => {
    if (didInitFolio.current) return;
    const folio = (location.state as { folio?: number } | null)?.folio;
    if (!folio) return;
    didInitFolio.current = true;
    setFolioStr(String(folio));
    setPage(0);
    setRows([]);
    setAppliedFolio(folio);
    // Si se llega con openDetail (desde la actividad reciente del Inicio), recordar el
    // folio para abrir su detalle en cuanto lleguen los resultados de la búsqueda.
    if ((location.state as { openDetail?: boolean } | null)?.openDetail) {
      pendingDetailFolio.current = folio;
    }
  }, [location.state]);

  // Abre el detalle de la venta pendiente (llegada desde el Inicio) cuando la búsqueda
  // por folio ya trajo la fila correspondiente. Disparo único por folio.
  useEffect(() => {
    const f = pendingDetailFolio.current;
    if (f == null) return;
    const row = rows.find((r) => r.dte_folio === f);
    if (row) {
      pendingDetailFolio.current = null;
      setDetail(row);
    }
  }, [rows]);

  function handleBuscar() {
    setPage(0);
    setRows([]);
    setAppliedFrom(from);
    setAppliedTo(to);
    setAppliedCustomerId(customerId);
    setAppliedFolio(folioStr.trim() ? Number(folioStr.trim()) : null);
  }

  function handleCargarMas() {
    setPage((p) => p + 1);
  }

  const canLoadMore = (data?.length ?? 0) >= HISTORY_PAGE;

  async function reimprimirBoleta(row: SaleHistoryRow) {
    const soldAt = new Date(row.sold_at);
    const payload = {
      negocio: businessToNegocio(business, getPrinterName()),
      folio: row.folio,
      fecha: `${pad2(soldAt.getDate())}/${pad2(soldAt.getMonth() + 1)}/${soldAt.getFullYear()}`,
      hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
      items: row.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot, descuento: l.discount_amount ?? 0 })),
      neto: row.neto,
      iva: row.iva,
      total: row.total,
      descuento: globalDiscount(row.discount_amount, row.points_discount),
      canje_pts: row.points_redeemed ?? 0,
      canje_monto: row.points_discount ?? 0,
      dte_folio: row.dte_folio ?? undefined,
      timbre_png: row.dte_timbre ?? null,
      reimpresion: !!row.printed_at,
      metodo: row.method,
      open_drawer: false,
      doc_type: row.doc_type,
      // Nota: SaleHistoryRow no trae razón social/RUT/giro/dirección del receptor;
      // en reimpresión de factura desde el historial esos datos quedan en blanco
      // (concern no bloqueante, documentado en el reporte de la tarea).
    };
    try {
      await printReceipt(payload);
      try {
        await markSalePrinted(row.id);
        qc.invalidateQueries({ queryKey: ["sales-history"] });
      } catch (e) {
        // No romper el flujo de impresión si el marcado falla: la boleta ya se imprimió.
        console.error("markSalePrinted falló", e);
      }
    } catch (e) {
      notifyError(`No se pudo imprimir.`, errMsg(e));
    }
  }

  function emitirNotaCredito(row: SaleHistoryRow) {
    nav("/notas-credito/nueva", { state: { folio: row.dte_folio } });
  }

  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  async function descargarPdf(row: SaleHistoryRow) {
    setPdfBusy(row.id);
    try {
      const r = await getDtePdf(row.id);
      if (r.status === "ok" && r.pdf_base64) {
        const nombre = `${row.doc_type === "factura" ? "factura" : "boleta"}-${row.dte_folio}.pdf`;
        await savePdfBase64(r.pdf_base64, nombre);
      } else {
        notifyError("No se pudo descargar el PDF.", r.message);
      }
    } catch (e) {
      notifyError("No se pudo descargar el PDF.", errMsg(e));
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div className="relative flex h-full flex-col px-[32px] py-[28px]">
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Ventas</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Historial</h2>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl border border-[#E1E5EE] bg-white p-3.5">
        <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#556A7C]">
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-[#E1E5EE] bg-white px-2.5 py-1.5 text-[13px] font-bold text-[#0F2A1B] outline-none focus:border-[var(--brand)]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#556A7C]">
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-[#E1E5EE] bg-white px-2.5 py-1.5 text-[13px] font-bold text-[#0F2A1B] outline-none focus:border-[var(--brand)]"
          />
        </label>

        {customerId ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E1E5EE] bg-[#F6F7FB] px-2.5 py-1.5 text-[13px] font-bold text-[#2A3A2E]">
            {customerName ?? "Cliente"}
            <button
              onClick={() => { setCustomerId(null); setCustomerName(null); }}
              title="Quitar filtro de cliente"
              className="flex size-4 items-center justify-center text-[#556A7C]"
            >
              ×
            </button>
          </span>
        ) : (
          <button
            onClick={() => setPickerOpen(true)}
            className="rounded-lg border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] font-bold text-[#5a6b7e]"
          >
            Cliente
          </button>
        )}

        <input
          value={folioStr}
          onChange={(e) => setFolioStr(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="N° folio SII"
          className="w-28 rounded-lg border border-[#E1E5EE] bg-white px-2.5 py-1.5 text-[13px] font-bold text-[#0F2A1B] outline-none focus:border-[var(--brand)]"
        />

        <button
          onClick={handleBuscar}
          className="ml-auto rounded-lg px-4 py-1.5 text-[13px] font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          Buscar
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isFetching && page === 0 && rows.length === 0 && (
          <div className="py-6 text-center text-[13px] text-[#5E6E7E]">Cargando historial…</div>
        )}
        {!isFetching && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#E1E5EE] bg-white py-12 text-center">
            <div className="text-[15px] font-bold text-[#556A7C]">No hay ventas para los filtros seleccionados.</div>
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const badge = dteBadge(r);
            const typeBadge = docTypeBadge(r);
            return (
              <div key={r.id} className="flex items-center gap-4 rounded-2xl border border-[#E1E5EE] bg-white px-[18px] py-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-extrabold text-[#0F2A1B]">{folioSii(r)}</div>
                  <div className="mt-0.5 text-[12.5px] text-[#556A7C]">
                    {new Date(r.sold_at).toLocaleString("es-CL")} · {r.customer_name ?? "Cliente No Registrado"} · {metodoLabel(r.method)}
                  </div>
                </div>
                <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: typeBadge.bg, color: typeBadge.fg }}>{typeBadge.label}</span>
                <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                <div className="text-base font-black text-[#0F2A1B]">{fmtCLP(r.total)}</div>
                <div className="flex flex-none items-center gap-1.5">
                  <button
                    onClick={() => setDetail(r)}
                    title="Ver detalle"
                    className="flex size-9 items-center justify-center rounded-lg text-[#2563EB] hover:brightness-95"
                    style={{ background: "#EAF1FE" }}
                  >
                    <Eye className="size-[18px]" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => reimprimirBoleta(r)}
                    disabled={!r.dte_folio}
                    title={!r.dte_folio ? "La boleta no está emitida en el SII" : r.printed_at ? "Reimprimir boleta" : "Imprimir boleta"}
                    className="flex size-9 items-center justify-center rounded-lg hover:brightness-95 disabled:opacity-40"
                    style={{ background: "#E6F7EE", color: "var(--brand)" }}
                  >
                    <Printer className="size-[18px]" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => descargarPdf(r)}
                    disabled={!r.dte_folio || pdfBusy === r.id}
                    title={!r.dte_folio ? "La boleta no está emitida en el SII" : "Descargar PDF"}
                    className="flex size-9 items-center justify-center rounded-lg hover:brightness-95 disabled:opacity-40"
                    style={{ background: "#EEF2F7", color: "#475569" }}
                  >
                    <FileText className="size-[18px]" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => emitirNotaCredito(r)}
                    disabled={!r.dte_folio}
                    title={!r.dte_folio ? "La boleta no está emitida en el SII" : "Emitir nota de crédito"}
                    className="flex size-9 items-center justify-center rounded-lg text-[#D02E2E] hover:brightness-95 disabled:opacity-40"
                    style={{ background: "#FDECEC" }}
                  >
                    <Undo2 className="size-[18px]" strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {canLoadMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={handleCargarMas}
              disabled={isFetching}
              className="rounded-xl border border-[#E1E5EE] bg-white px-5 py-2.5 text-[13px] font-bold text-[#2A3A2E] disabled:opacity-50"
            >
              {isFetching ? "Cargando…" : "Cargar más"}
            </button>
          </div>
        )}
      </div>

      <CustomerPickerDialog
        open={pickerOpen}
        businessId={businessId}
        onSelect={(c) => { setCustomerId(c.id); setCustomerName(c.name); setPickerOpen(false); }}
        onContinueWithout={() => { setCustomerId(null); setCustomerName(null); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <div
            className="w-[480px] max-w-full rounded-[22px] bg-white p-6"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 70px rgba(0,0,64,.35)" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[19px] font-black text-[#0F2A1B]">{folioSii(detail)}</div>
              <button onClick={() => setDetail(null)} className="text-[13px] font-bold text-[#5a6b7e]">
                Cerrar
              </button>
            </div>

            <div className="mb-3 text-[12.5px] text-[#556A7C]">
              {new Date(detail.sold_at).toLocaleString("es-CL")} · {detail.customer_name ?? "Cliente No Registrado"} · {metodoLabel(detail.method)}
            </div>

            <div className="mb-4 flex flex-col gap-2">
              {detail.lines.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2.5 rounded-xl border border-[#E1E5EE] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-[#0F2A1B]">{l.name_snapshot}</div>
                    <div className="text-xs text-[#556A7C]">
                      {l.qty} × {fmtCLP(l.price_snapshot)}
                      {l.discount_amount > 0 ? ` · Descuento ${fmtCLP(l.discount_amount)}` : ""}
                    </div>
                  </div>
                  <div className="text-[13.5px] font-black text-[#0F2A1B]">{fmtCLP(l.qty * l.price_snapshot - l.discount_amount)}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1.5 rounded-xl border border-[#E1E5EE] bg-[#F8FAFC] px-3.5 py-3 text-[13px] font-bold text-[#556A7C]">
              <div className="flex justify-between"><span>Neto</span><span className="text-[#0F2A1B]">{fmtCLP(detail.neto)}</span></div>
              <div className="flex justify-between"><span>IVA</span><span className="text-[#0F2A1B]">{fmtCLP(detail.iva)}</span></div>
              {(() => {
                // Total de descuentos = suma de los descuentos por línea + el descuento
                // global (comercial). Los descuentos suelen ser por línea (product.discount_pct),
                // que no viven en sale.discount_amount; hay que sumarlos desde las líneas.
                const totalDescuentos = detail.lines.reduce((s, l) => s + (l.discount_amount ?? 0), 0) + (detail.discount_amount ?? 0);
                return totalDescuentos > 0 ? (
                  <div className="flex justify-between"><span>Total descuentos</span><span className="text-[#0F2A1B]">-{fmtCLP(totalDescuentos)}</span></div>
                ) : null;
              })()}
              {detail.points_redeemed > 0 && (
                <div className="flex justify-between">
                  <span>Canje de puntos ({detail.points_redeemed} pts)</span>
                  <span className="text-[#0F2A1B]">−{fmtCLP(detail.points_discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-[15px]"><span>Total</span><span className="text-[#0F2A1B]">{fmtCLP(detail.total)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
