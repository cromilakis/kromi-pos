import { useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession } from "@/data/work";
import { useCierres, closeCashSession, contarVentasSesion, fetchSessionOpenedAt, type CierreResumen, type CierreRow } from "@/data/cash";
import { printCierre } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { fmtCLP } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtFecha(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtHora(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtFechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${fmtFecha(d)} ${fmtHora(d)}`;
}

/** Caja de descuadre: verde si cuadra, ámbar si sobra, rojo si falta. Clona el estilo de doCierre del prototipo. */
function DiffBox({ diff }: { diff: number }) {
  const style =
    diff === 0
      ? { background: "#E6F7EE", border: "1px solid #A7E3C0", color: "#0a6e36" }
      : diff > 0
        ? { background: "#FEF6DD", border: "1px solid #F2E2A8", color: "#8A6D12" }
        : { background: "#FBEAEA", border: "1px solid #F0B8B8", color: "#B02A2A" };
  const label = diff === 0 ? "Caja cuadrada" : diff > 0 ? "Sobrante" : "Faltante";
  return (
    <div className="mt-3 flex items-center justify-between rounded-xl px-4 py-3" style={style}>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-lg font-black">{fmtCLP(Math.abs(diff))}</span>
    </div>
  );
}

/** Sin sesión abierta: invita a abrir caja desde Venta (este panel no abre caja). */
function SinCaja() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 p-10 text-center">
        <div className="flex size-[78px] items-center justify-center rounded-[22px] bg-[#F0F2F7]">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#556A7C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="text-lg font-black text-[#0F2A1B]">No hay una caja abierta</div>
        <p className="max-w-[320px] text-sm leading-relaxed text-[#556A7C]">
          Abre la caja desde Venta para iniciar un turno y poder registrar el arqueo al cerrar.
        </p>
      </Card>
    </div>
  );
}

function HistorialCierres({ cierres }: { cierres: CierreRow[] }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#E1E5EE] bg-white">
      <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-3.5 border-b border-[#E1E5EE] bg-[#F8FAFC] px-5 py-3 text-[11.5px] font-bold uppercase tracking-[.04em] text-[#5E6E7E]">
        <span>Apertura</span>
        <span>Cierre</span>
        <span className="text-right">Fondo</span>
        <span className="text-right">Contado</span>
      </div>
      {cierres.length === 0 && (
        <div className="px-5 py-8 text-center text-[13.5px] text-[#5E6E7E]">Aún no hay cierres registrados en esta sucursal.</div>
      )}
      {cierres.map((c) => (
        <div key={c.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] items-center gap-3.5 border-b border-[#F0F2F7] px-5 py-3 last:border-b-0">
          <span className="text-[13px] font-semibold text-[#0F2A1B]">{fmtFechaHora(c.opened_at)}</span>
          <span className="text-[13px] text-[#5a6b7e]">{fmtFechaHora(c.closed_at)}</span>
          <span className="text-right text-[13.5px] text-[#5a6b7e]">{fmtCLP(c.float_amount)}</span>
          <span className="text-right text-[13.5px] font-bold text-[#0F2A1B]">{c.counted != null ? fmtCLP(c.counted) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

interface CierrePanelProps {
  /** Se llama tras cerrar la caja con éxito (la venta pasará a pedir reabrir caja). */
  onClosed?: () => void;
}

/** Arqueo y cierre de caja: contenido reutilizable, embebido en el diálogo de cierre dentro de Venta. */
export function CierrePanel({ onClosed }: CierrePanelProps) {
  const { profile } = useAuth();
  const { branch, register } = useWork();
  const qc = useQueryClient();
  const { data: openSession } = useOpenSession(register?.id);
  const { data: cierres } = useCierres(branch?.id);

  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumen, setResumen] = useState<CierreResumen | null>(null);

  // Una vez cerrada la caja se conserva el resumen en pantalla aunque `openSession`
  // pase a null (invalidación de ["open-session"] tras el cierre).
  if (!openSession && !resumen) return <SinCaja />;

  async function handleCerrar() {
    if (!openSession) return;
    const countedNum = Number(counted.replace(/[^\d]/g, "")) || 0;
    setBusy(true);
    try {
      const r: CierreResumen = await closeCashSession(openSession.id, countedNum);
      setResumen(r);
      toast.success("Caja cerrada.");
      qc.invalidateQueries({ queryKey: ["open-session"] });
      qc.invalidateQueries({ queryKey: ["cierres"] });
      onClosed?.();

      try {
        const [openedAtIso, ventas] = await Promise.all([
          fetchSessionOpenedAt(openSession.id),
          contarVentasSesion(openSession.id),
        ]);
        const now = new Date();
        const payload = {
          negocio: {
            tagline: "",
            razon_social: profile?.name ?? "Kromi POS",
            rut: "",
            giro: "",
            direccion: "",
            footer: "¡Gracias por su compra!",
            printer_name: getPrinterName(),
            social: null,
          },
          fecha: fmtFecha(now),
          cajero: profile?.name ?? "—",
          apertura: openedAtIso ? fmtHora(new Date(openedAtIso)) : "—",
          cierre: fmtHora(now),
          ventas,
          cash: r.cash,
          card: r.card,
          fondo: r.float,
          contado: r.counted,
          nc_cash: r.nc_cash,
          nc_card: r.nc_card,
        };
        await printCierre(payload);
      } catch (e) {
        notifyError(`La caja se cerró, pero no se pudo imprimir el comprobante.`, e instanceof Error ? e.message : e);
      }
    } catch (e) {
      notifyError(`No se pudo cerrar la caja.`, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full overflow-auto">
      <div className="mx-auto max-w-[940px]">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>
          Arqueo
        </div>
        <h2 className="mb-1 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Cierre de caja</h2>
        <p className="mb-5 text-sm text-[#556A7C]">Turno de {profile?.name ?? "—"} · {register?.name ?? "caja"}</p>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Card className="flex-1 p-6">
            <div className="mb-1 text-base font-black text-[#0F2A1B]">Arqueo de efectivo</div>
            <div className="mb-4 text-[13px] text-[#556A7C]">Cuente el efectivo en caja e ingrese el monto contado.</div>

            {resumen ? (
              <>
                <div className="flex justify-between border-b border-[#F0F2F7] py-1.5 text-[13px] text-[#556A7C]">
                  <span>Fondo de apertura</span>
                  <span>{fmtCLP(resumen.float)}</span>
                </div>
                <div className="flex justify-between border-b border-[#F0F2F7] py-1.5 text-[13px] text-[#556A7C]">
                  <span>Ventas en efectivo</span>
                  <span>{fmtCLP(resumen.cash)}</span>
                </div>
                {resumen.nc_cash > 0 && (
                  <div className="flex justify-between border-b border-[#F0F2F7] py-1.5 text-[13px] text-[#c0392b]">
                    <span>Notas de crédito (efectivo)</span>
                    <span>-{fmtCLP(resumen.nc_cash)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between pt-1.5 text-sm font-bold text-[#0F2A1B]">
                  <span>Esperado en caja</span>
                  <span>{fmtCLP(resumen.expected_cash)}</span>
                </div>
                <div className="flex justify-between pt-1.5 text-sm font-bold text-[#0F2A1B]">
                  <span>Efectivo contado</span>
                  <span>{fmtCLP(resumen.counted)}</span>
                </div>
                <DiffBox diff={resumen.diff} />
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#A7E3C0] bg-[#E6F7EE] px-3.5 py-3 text-[13px] font-bold text-[#0a6e36]">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Caja cerrada. Abre caja nuevamente para atender otra venta.
                </div>
              </>
            ) : (
              <>
                <label className="mb-1.5 mt-4 block text-xs font-bold text-[#556A7C]">Efectivo contado</label>
                <Input
                  autoFocus
                  inputMode="numeric"
                  placeholder="$0"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value.replace(/[^\d]/g, ""))}
                  className="text-lg font-bold"
                />
              </>
            )}
          </Card>

          <Card className="w-full p-6 lg:w-[300px] lg:shrink-0">
            <div className="mb-3.5 text-base font-black text-[#0F2A1B]">Resumen del turno</div>
            {!resumen ? (
              <p className="mb-4 text-[13px] leading-relaxed text-[#556A7C]">
                El resumen (efectivo, tarjeta y descuadre) se calcula al confirmar el cierre.
              </p>
            ) : (
              <div className="mb-4 flex flex-col gap-2 text-[13px] text-[#5a6b7e]">
                <div className="flex justify-between">
                  <span>Tarjeta</span>
                  <span className="font-bold text-[#0F2A1B]">{fmtCLP(resumen.card)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total efectivo + tarjeta</span>
                  <span className="font-bold text-[#0F2A1B]">{fmtCLP(resumen.cash + resumen.card)}</span>
                </div>
              </div>
            )}
            {!resumen && (
              <Button className="w-full" style={{ background: "var(--brand)" }} onClick={handleCerrar} disabled={busy}>
                {busy ? "Cerrando…" : "Cerrar caja"}
              </Button>
            )}
          </Card>
        </div>

        <h3 className="mb-3 mt-8 text-base font-black text-[#0F2A1B]">Historial de cierres</h3>
        <HistorialCierres cierres={cierres ?? []} />
      </div>
    </div>
  );
}
