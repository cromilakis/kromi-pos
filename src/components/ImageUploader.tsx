import { useRef, useState } from "react";
import { toast } from "sonner";
import { processImage } from "@/lib/image";
import { errMsg, notifyError } from "@/lib/errors";

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  onUpload: (blob: Blob) => Promise<string>;
  maxSize: number;
  label?: string;
}

export function ImageUploader({ value, onChange, onUpload, maxSize, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("El archivo debe ser una imagen."); return; }
    setBusy(true);
    try {
      const blob = await processImage(file, maxSize);
      const url = await onUpload(blob);
      onChange(url);
    } catch (e) {
      notifyError(`No se pudo subir la imagen.`, errMsg(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E1E5EE] bg-[#F6F7FB]">
        {value ? <img src={value} alt={label ?? "imagen"} className="size-full object-cover" /> : <span className="text-[11px] text-[#5E6E7E]">Sin imagen</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-[10px] border border-[#A7E3C0] bg-[#E6F7EE] px-3.5 py-2 text-[13px] font-bold text-[#0a6e36] disabled:opacity-60"
        >
          {busy ? "Subiendo…" : value ? "Cambiar imagen" : "Subir imagen"}
        </button>
        {value && !busy && (
          <button type="button" onClick={() => onChange(null)} className="text-left text-[12px] font-bold text-[#556A7C] hover:text-[#D02E2E]">
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}
