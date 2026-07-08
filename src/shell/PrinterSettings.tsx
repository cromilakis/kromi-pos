import { useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { getPrinterName, setPrinterName } from "@/lib/printerConfig";

/** Botón + diálogo para configurar el nombre de la impresora de boletas (persistido localmente). */
export function PrinterSettings() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => getPrinterName());

  function save() {
    setPrinterName(name);
    setOpen(false);
    toast.success(name.trim() ? `Impresora de boletas: ${name.trim()}` : "Se usará la impresora predeterminada del sistema.");
  }

  return (
    <>
      <button
        type="button"
        title="Impresora de boletas"
        onClick={() => { setName(getPrinterName()); setOpen(true); }}
        className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[#7C95A8] hover:bg-[#F7F8FA]"
      >
        <Printer className="size-[17px]" strokeWidth={1.7} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setOpen(false)}>
          <div className="w-[460px] max-w-full rounded-[20px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Impresora de boletas</div>
            <div className="mb-4 text-[13px] leading-relaxed text-[#7C95A8]">
              Escribe el nombre exacto de la impresora térmica, tal como aparece en Windows → Configuración → Bluetooth y dispositivos → Impresoras y escáneres. Déjalo vacío para usar la impresora predeterminada del sistema.
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. GEZHI 80mm"
              className="w-full rounded-[12px] border border-[#E1E5EE] px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--brand)]"
            />
            <div className="mt-5 flex justify-end gap-2.5">
              <button onClick={() => setOpen(false)} className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]">Cancelar</button>
              <button onClick={save} className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white" style={{ background: "var(--brand)" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
