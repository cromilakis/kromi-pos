import { useEffect, useState } from "react";
import { notifyError, errMsg } from "@/lib/errors";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { consultarFolios, solicitarFolios, type FolioTipoInfo } from "@/data/folios";

const TIPOS: { tipoDte: number; label: string }[] = [
  { tipoDte: 39, label: "Boleta electrónica" },
  { tipoDte: 33, label: "Factura electrónica" },
  { tipoDte: 61, label: "Nota de crédito electrónica" },
];

const TIPO_IDS = TIPOS.map((t) => t.tipoDte);

interface PanelState {
  loading: boolean;
  error: string | null;
  infoByTipo: Record<number, FolioTipoInfo>;
}

const EMPTY_STATE: PanelState = { loading: true, error: null, infoByTipo: {} };

function FolioRow({
  tipoDte,
  label,
  info,
  onSolicitado,
}: {
  tipoDte: number;
  label: string;
  info: FolioTipoInfo | undefined;
  onSolicitado: () => Promise<void>;
}) {
  const [cantidad, setCantidad] = useState("");
  const [busy, setBusy] = useState(false);

  const max = info?.maxRequestable ?? null;
  const maxNoDisponible = !!info?.maxError;

  async function handleSolicitar() {
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error("Ingresa una cantidad válida (entero mayor a 0).");
      return;
    }
    if (!maxNoDisponible && max !== null && n > max) {
      toast.error(`La cantidad no puede superar el máximo solicitable (${max}).`);
      return;
    }
    setBusy(true);
    try {
      await solicitarFolios(tipoDte, n);
      toast.success("Folios solicitados con éxito.");
      setCantidad("");
      await onSolicitado();
    } catch (e) {
      notifyError("No se pudieron solicitar los folios.", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 text-base font-black text-[#0F2A1B]">{label}</div>

      {info?.error ? (
        <div className="text-[13px] text-[#B02A2A]">No se pudo consultar: {info.error}</div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] font-bold uppercase tracking-[.04em] text-[#5a6b7e]">Disponibles (sin usar)</span>
              <span className="text-lg font-black text-[#0F2A1B]">{info?.sinUso ?? 0}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] font-bold uppercase tracking-[.04em] text-[#5a6b7e]">Máximo a solicitar</span>
              <span className="text-lg font-black text-[#0F2A1B]">
                {maxNoDisponible ? "No disponible" : max === null ? "Sin límite" : max}
              </span>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <label className="flex flex-1 max-w-[220px] flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#5a6b7e]">Cantidad a solicitar</span>
              <Input
                inputMode="numeric"
                placeholder="Ej: 50"
                value={cantidad}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "");
                  setCantidad(digits);
                }}
              />
            </label>
            <Button onClick={handleSolicitar} disabled={busy}>
              {busy ? "Solicitando…" : "Solicitar"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Consulta y solicitud de folios (CAF) por tipo de documento: boleta, factura y nota de crédito.
 *  Una sola invocación a la Edge Function `folios` consulta todos los tipos (reutiliza un único
 *  token de SimpleFactura, ya que el endpoint de token es muy limitado). */
export function FoliosPanel() {
  const [state, setState] = useState<PanelState>(EMPTY_STATE);

  async function cargar() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const results = await consultarFolios(TIPO_IDS);
      const infoByTipo: Record<number, FolioTipoInfo> = {};
      for (const r of results) infoByTipo[r.tipoDte] = r;
      setState({ loading: false, error: null, infoByTipo });
    } catch (e) {
      setState({ loading: false, error: errMsg(e), infoByTipo: {} });
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Administración</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Folios</h2>
        <p className="mt-1 text-sm text-[#556A7C]">Consulta los folios disponibles y solicita nuevos CAF por tipo de documento.</p>
      </div>

      <div className="flex max-w-[640px] flex-col gap-4">
        {state.loading ? (
          <div className="py-4 text-center text-[13.5px] text-[#5E6E7E]">Cargando…</div>
        ) : state.error ? (
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-[#B02A2A]">No se pudo consultar: {state.error}</div>
            <Button variant="outline" onClick={cargar} className="w-fit">Reintentar</Button>
          </div>
        ) : (
          <>
            {TIPOS.map((t) => (
              <FolioRow
                key={t.tipoDte}
                tipoDte={t.tipoDte}
                label={t.label}
                info={state.infoByTipo[t.tipoDte]}
                onSolicitado={cargar}
              />
            ))}
            <Button variant="outline" onClick={cargar} className="w-fit">Reintentar</Button>
          </>
        )}
      </div>
    </div>
  );
}
