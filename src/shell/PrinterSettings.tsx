import { useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { getPrinterName, setPrinterName } from "@/lib/printerConfig";
import { getSkipPrint, setSkipPrint } from "@/lib/deviceConfig";

/**
 * Botón "Configurar" + diálogo para los ajustes de impresión de este equipo:
 * si el dispositivo imprime boletas y el nombre de la impresora térmica.
 * Ambos se persisten localmente (deviceConfig / printerConfig) al Guardar.
 */
export function PrinterSettings() {
  const [open, setOpen] = useState(false);
  const [prints, setPrints] = useState(() => !getSkipPrint());
  const [name, setName] = useState(() => getPrinterName());

  function openDialog() {
    setPrints(!getSkipPrint());
    setName(getPrinterName());
    setOpen(true);
  }

  function save() {
    setSkipPrint(!prints);
    setPrinterName(name);
    setOpen(false);
    if (!prints) {
      toast.success("Modo sin impresión activado en este equipo.");
    } else {
      toast.success(name.trim() ? `Impresora de boletas: ${name.trim()}` : "Se usará la impresora predeterminada del sistema.");
    }
  }

  return (
    <>
      <button
        type="button"
        title="Configurar impresión"
        onClick={openDialog}
        className="flex shrink-0 items-center gap-2 rounded-[10px] border border-[#E1E5EE] bg-white px-3.5 py-2 text-[13px] font-bold text-[#556A7C] hover:bg-[#F7F8FA]"
      >
        <Printer className="size-[16px]" strokeWidth={1.7} />
        Configurar
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-[460px] max-w-full rounded-[20px] bg-white p-6">
            <div className="mb-4 text-[17px] font-black text-[#0F2A1B]">Configurar impresión</div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13.5px] font-bold text-[#2A3A2E]">Este dispositivo imprime boletas</div>
                <div className="text-[11.5px] leading-relaxed text-[#5E6E7E]">Desactívalo en tablets que solo cobran: la venta se emite igual y la boleta se imprime luego en la caja.</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prints}
                onClick={() => setPrints((v) => !v)}
                className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
                style={{ background: prints ? "var(--brand)" : "#CBD5E1" }}
              >
                <span className="absolute top-[3px] size-[20px] rounded-full bg-white transition-all" style={{ left: prints ? "23px" : "3px" }} />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-1.5" style={{ opacity: prints ? 1 : 0.5 }}>
              <label className="text-[13.5px] font-bold text-[#2A3A2E]">Nombre de la impresora</label>
              <div className="text-[11.5px] leading-relaxed text-[#556A7C]">
                Escribe el nombre exacto de la impresora térmica, tal como aparece en Windows → Configuración → Bluetooth y dispositivos → Impresoras y escáneres. Déjalo vacío para usar la impresora predeterminada del sistema.
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!prints}
                placeholder="Ej. GEZHI 80mm"
                className="mt-1 w-full rounded-[12px] border border-[#E1E5EE] px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-[#F7F8FA]"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button onClick={() => setOpen(false)} className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]">Cancelar</button>
              <button onClick={save} className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white" style={{ background: "var(--brand)" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
