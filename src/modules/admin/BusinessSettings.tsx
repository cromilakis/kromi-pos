import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useBusiness, updateBusiness, type BusinessRow } from "@/data/business";
import { ImageUploader } from "@/components/ImageUploader";
import { uploadLogoImage } from "@/lib/image";

type FormState = Omit<BusinessRow, "id">;

const EMPTY: FormState = {
  name: "", rut: "", giro: "", direccion: "", tagline: "", footer: "",
  logo_url: "", social_red: "", social_url: "",
};

const FIELDS: { key: keyof FormState; label: string; placeholder?: string }[] = [
  { key: "name", label: "Razón social" },
  { key: "rut", label: "RUT" },
  { key: "giro", label: "Giro" },
  { key: "direccion", label: "Dirección" },
  { key: "tagline", label: "Lema (tagline)" },
  { key: "footer", label: "Pie de boleta" },
  { key: "social_red", label: "Red social (nombre)", placeholder: "Instagram" },
  { key: "social_url", label: "Red social (URL)", placeholder: "https://…" },
];

export function BusinessSettings() {
  const { profile } = useAuth();
  const businessId = profile?.business_id;
  const qc = useQueryClient();
  const { data: business, isLoading } = useBusiness(businessId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (business) {
      setForm({
        name: business.name ?? "",
        rut: business.rut ?? "",
        giro: business.giro ?? "",
        direccion: business.direccion ?? "",
        tagline: business.tagline ?? "",
        footer: business.footer ?? "",
        logo_url: business.logo_url ?? "",
        social_red: business.social_red ?? "",
        social_url: business.social_url ?? "",
      });
    }
  }, [business]);

  async function save() {
    if (!businessId) return;
    if (!form.name.trim() || !form.rut.trim()) {
      toast.error("La razón social y el RUT son obligatorios.");
      return;
    }
    setBusy(true);
    try {
      await updateBusiness(businessId, {
        name: form.name.trim(),
        rut: form.rut.trim(),
        giro: form.giro?.trim() || null,
        direccion: form.direccion?.trim() || null,
        tagline: form.tagline?.trim() || null,
        footer: form.footer?.trim() || null,
        logo_url: form.logo_url?.trim() || null,
        social_red: form.social_red?.trim() || null,
        social_url: form.social_url?.trim() || null,
      });
      toast.success("Datos del negocio actualizados.");
      qc.invalidateQueries({ queryKey: ["business", businessId] });
    } catch (e) {
      toast.error(`No se pudo guardar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-[11px] border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none focus:border-[var(--brand)]";

  return (
    <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Administración</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Datos del negocio</h2>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">Cargando…</div>
      ) : (
        <div className="max-w-[640px] rounded-2xl border border-[#E1E5EE] bg-white p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-bold text-[#5a6b7e]">{f.label}</span>
                <input
                  className={inputCls}
                  value={form[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-[#5a6b7e]">Logo del negocio</span>
            <ImageUploader
              value={form.logo_url || null}
              onChange={(url) => setForm((s) => ({ ...s, logo_url: url ?? "" }))}
              onUpload={(blob) => uploadLogoImage(businessId!, blob)}
              maxSize={400}
              label="logo"
            />
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-[12px] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-70"
              style={{ background: "var(--brand)" }}
            >
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
