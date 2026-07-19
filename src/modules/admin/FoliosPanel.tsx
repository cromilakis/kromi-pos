import { useEffect, useState } from "react";
import { notifyError, errMsg } from "@/lib/errors";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { consultarFolios, solicitarFolios, type FoliosInfo } from "@/data/folios";

const TIPOS: { tipoDte: number; label: string }[] = [
  { tipoDte: 39, label: "Boleta electrónica" },
  { tipoDte: 33, label: "Factura electrónica" },
  { tipoDte: 61, label: "Nota de crédito electrónica" },
];

interface RowState {
  info: FoliosInfo | null;
  loading: boolean;
  error: string | null;
  cantidad: string;
  busy: boolean;
}

const EMPTY_ROW: RowState = { info: null, loading: true, error: null, cantidad: "", busy: false };

function FolioRow({ tipoDte, label }: { tipoDte: number; label: string }) {
  const [state, setState] = useState<RowState>(EMPTY_ROW);

  async function cargar() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const info = await consultarFolios(tipoDte);
      setState((s) => ({ ...s, info, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errMsg(e) }));
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoDte]);

  async function handleSolicitar() {
    const cantidad = Number(state.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      toast.error("Ingresa una cantidad válida (entero mayor a 0).");
      return;
    }
    const max = state.info?.maxRequestable ?? null;
    if (max !== null && cantidad > max) {
      toast.error(`La cantidad no puede superar el máximo solicitable (${max}).`);
      return;
    }
    setState((s) => ({ ...s, busy: true }));
    try {
      await solicitarFolios(tipoDte, cantidad);
      toast.success("Folios solicitados con éxito.");
      setState((s) => ({ ...s, busy: false, cantidad: "" }));
      await cargar();
    } catch (e) {
      notifyError("No se pudieron solicitar los folios.", e);
      setState((s) => ({ ...s, busy: false }));
    }
  }

  const max = state.info?.maxRequestable ?? null;

  return (
    <Card className="p-6">
      <div className="mb-4 text-base font-black text-[#0F2A1B]">{label}</div>

      {state.loading ? (
        <div className="py-4 text-center text-[13.5px] text-[#5E6E7E]">Cargando…</div>
      ) : state.error ? (
        <div className="flex flex-col gap-3">
          <div className="text-[13px] text-[#B02A2A]">No se pudo consultar: {state.error}</div>
          <Button variant="outline" onClick={cargar} className="w-fit">Reintentar</Button>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] font-bold uppercase tracking-[.04em] text-[#5a6b7e]">Disponibles (sin usar)</span>
              <span className="text-lg font-black text-[#0F2A1B]">{state.info?.sinUso ?? 0}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] font-bold uppercase tracking-[.04em] text-[#5a6b7e]">Máximo a solicitar</span>
              <span className="text-lg font-black text-[#0F2A1B]">{max === null ? "Sin límite" : max}</span>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <label className="flex flex-1 max-w-[220px] flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#5a6b7e]">Cantidad a solicitar</span>
              <Input
                inputMode="numeric"
                placeholder="Ej: 50"
                value={state.cantidad}
                max={max ?? undefined}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "");
                  setState((s) => ({ ...s, cantidad: digits }));
                }}
              />
            </label>
            <Button onClick={handleSolicitar} disabled={state.busy}>
              {state.busy ? "Solicitando…" : "Solicitar"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Consulta y solicitud de folios (CAF) por tipo de documento: boleta, factura y nota de crédito. */
export function FoliosPanel() {
  return (
    <div className="min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Administración</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Folios</h2>
        <p className="mt-1 text-sm text-[#556A7C]">Consulta los folios disponibles y solicita nuevos CAF por tipo de documento.</p>
      </div>

      <div className="flex max-w-[640px] flex-col gap-4">
        {TIPOS.map((t) => (
          <FolioRow key={t.tipoDte} tipoDte={t.tipoDte} label={t.label} />
        ))}
      </div>
    </div>
  );
}
