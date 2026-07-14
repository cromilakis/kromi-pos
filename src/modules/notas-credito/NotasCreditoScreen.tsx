import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useCreditNotes, type CreditNoteRow } from "@/data/sales";
import { emitirNotaCreditoDte } from "@/data/sii";
import { useBusiness, businessToNegocio } from "@/data/business";
import { printCreditNote } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { fmtCLP } from "@/lib/money";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function fmtDate(d: Date): string { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }

export function NotasCreditoScreen() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { branch } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const qc = useQueryClient();

  const { data: business } = useBusiness(businessId);
  const { data: creditNotes, isLoading } = useCreditNotes(branchId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = creditNotes ?? [];

  async function handleReimprimir(nc: CreditNoteRow) {
    const createdAt = new Date(nc.created_at);
    const neto = Math.round(nc.total / 1.19);
    try {
      await printCreditNote({
        negocio: businessToNegocio(business, getPrinterName()),
        folio: nc.folio,
        fecha: fmtDate(createdAt),
        hora: `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
        sale_folio: nc.boleta_folio,
        metodo: nc.method,
        motivo: nc.reason ?? "Sin motivo",
        items: nc.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot })),
        neto,
        iva: nc.total - neto,
        total: nc.total,
        dte_folio: nc.dte_folio ?? undefined,
        timbre_png: nc.dte_timbre,
      });
    } catch (e) {
      notifyError(`No se pudo imprimir la nota de crédito.`, e instanceof Error ? e.message : e);
    }
  }

  async function handleReintentar(nc: CreditNoteRow) {
    setBusyId(nc.id);
    try {
      const em = await emitirNotaCreditoDte(nc.id);
      if (em.status === "emitida") {
        toast.success(`Nota de crédito emitida (folio ${em.folio}).`);
      } else {
        notifyError(`No se pudo emitir.`, em.message ?? em.status);
      }
      qc.invalidateQueries({ queryKey: ["credit-notes", branchId] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="relative flex h-full flex-col px-[32px] py-[28px]">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Ventas</div>
          <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Notas de crédito</h2>
        </div>
        <button
          onClick={() => navigate("/notas-credito/nueva")}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          <Plus className="size-4" strokeWidth={2.2} /> Nueva nota de crédito
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <div className="py-6 text-center text-[13px] text-[#5E6E7E]">Cargando notas de crédito…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#E1E5EE] bg-white py-12 text-center">
            <div className="text-[15px] font-bold text-[#556A7C]">Aún no hay notas de crédito.</div>
            <button
              onClick={() => navigate("/notas-credito/nueva")}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              <Plus className="size-4" strokeWidth={2.2} /> Nueva nota de crédito
            </button>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="sticky top-0 bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                <th className="px-3 py-2.5">Folio NC</th>
                <th className="px-3 py-2.5">Boleta</th>
                <th className="px-3 py-2.5">Folio SII</th>
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5">Motivo</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((nc) => {
                const emitida = nc.dte_status === "emitida";
                const badge = emitida
                  ? { label: `SII ${nc.dte_folio}`, bg: "#E6F7EE", fg: "#0a6e36" }
                  : nc.dte_status === "rechazada"
                    ? { label: "Rechazada", bg: "#FCECEC", fg: "#c0392b" }
                    : { label: "Pendiente", bg: "#FBF1E0", fg: "#9A6F12" };
                return (
                  <tr key={nc.id} className="border-t border-[#EEF1F6] hover:bg-[#FAFBFD]">
                    <td className="px-3 py-2.5 font-bold text-[#0F2A1B]">NC-{nc.folio}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#556A7C]">{nc.boleta_folio ?? "Manual"}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#556A7C]">{nc.dte_folio ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#556A7C]">{fmtDate(new Date(nc.created_at))}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-[#0F2A1B]">{fmtCLP(nc.total)}</td>
                    <td className="px-3 py-2.5 text-[13px] text-[#556A7C]">{nc.reason ?? "Sin motivo"}</td>
                    <td className="px-3 py-2.5">
                      <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {emitida ? (
                        <button onClick={() => handleReimprimir(nc)} className="rounded-[10px] border border-[#E1E5EE] bg-white px-3.5 py-2 text-[13px] font-bold text-[#5a6b7e]">
                          Reimprimir
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReintentar(nc)}
                          disabled={busyId === nc.id}
                          className="rounded-[10px] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-60"
                          style={{ background: "var(--brand)" }}
                        >
                          {busyId === nc.id ? "Emitiendo…" : "Reintentar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
