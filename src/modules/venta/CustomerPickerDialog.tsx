import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyError, errMsg } from "@/lib/errors";
import { useCustomers, filterCustomers, createCustomer, type CustomerRow } from "@/data/customers";

interface CustomerPickerDialogProps {
  open: boolean;
  businessId: string | undefined;
  onSelect: (customer: CustomerRow) => void;
  onContinueWithout: () => void;
  onClose: () => void;
}

type Mode = "search" | "new";

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #E1E5EE",
  borderRadius: 11,
  padding: "11px 14px",
  fontFamily: "inherit",
  fontSize: 14,
  color: "#0F2A1B",
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#556A7C", marginBottom: 6 };

/** Popup reutilizable para buscar/seleccionar (o crear) un cliente durante la venta. */
export function CustomerPickerDialog({ open, businessId, onSelect, onContinueWithout, onClose }: CustomerPickerDialogProps) {
  const qc = useQueryClient();
  const { data: customers } = useCustomers(businessId);

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("search");
      setQuery("");
      setName("");
      setPhone("");
      setEmail("");
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const filtered = filterCustomers(customers ?? [], query);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const created = await createCustomer({
        business_id: businessId!,
        name: trimmed,
        phone: phone.trim() || null,
        email: email.trim() || null,
      });
      await qc.invalidateQueries({ queryKey: ["customers", businessId] });
      onSelect(created);
    } catch (e) {
      notifyError("No se pudo crear el cliente.", errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[420px] max-w-full rounded-[22px] bg-white"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 24px 70px rgba(0,0,64,.35)" }}
      >
        <div className="flex items-center gap-3 border-b border-[#E1E5EE] p-5">
          <div className="text-[19px] font-black text-[#0F2A1B] flex-1">
            {mode === "search" ? "Seleccionar cliente" : "Nuevo cliente"}
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg border-0 bg-[#F6F7FB] text-lg text-[#556A7C]"
          >
            ×
          </button>
        </div>

        {mode === "search" ? (
          <div className="flex flex-col gap-3.5 p-5">
            <input
              autoFocus
              style={inputStyle}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, teléfono o correo"
            />
            <div className="max-h-[280px] overflow-auto rounded-xl border border-[#E1E5EE]">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-[#556A7C]">Sin resultados.</div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-[#E1E5EE] px-4 py-2.5 text-left last:border-b-0 hover:bg-[#F6F7FB]"
                  >
                    <span className="text-sm font-bold text-[#0F2A1B]">{c.name}</span>
                    <span className="text-xs text-[#556A7C]">
                      {[c.phone, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={onContinueWithout}
                className="flex-1 rounded-2xl border border-[#E1E5EE] bg-white py-3 text-[14px] font-bold text-[#2A3A2E]"
              >
                Continuar sin cliente
              </button>
              <button
                onClick={() => setMode("new")}
                className="flex-1 rounded-2xl py-3 text-[14px] font-bold text-white"
                style={{ background: "var(--brand)" }}
              >
                Nuevo cliente
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 p-5">
            <div>
              <label style={labelStyle}>Nombre</label>
              <input autoFocus style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+56 9 1234 5678" />
            </div>
            <div>
              <label style={labelStyle}>Correo</label>
              <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Ej. cliente@correo.cl" />
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setMode("search")}
                disabled={saving}
                className="flex-1 rounded-2xl border border-[#E1E5EE] bg-white py-3 text-[14px] font-bold text-[#2A3A2E] disabled:opacity-50"
              >
                Volver
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 rounded-2xl py-3 text-[14px] font-bold text-white disabled:opacity-50"
                style={{ background: "var(--brand)" }}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
