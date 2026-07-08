import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { CustomerRow } from "@/data/customers";
import { createCustomer, updateCustomer } from "@/data/customers";

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerRow | null;
  businessId: string;
  createdBy: string | null;
  onSaved: () => void;
}

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

export function CustomerForm({ open, onClose, customer, businessId, createdBy, onSaved }: CustomerFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (customer) {
      setName(customer.name);
      setEmail(customer.email ?? "");
      setPhone(customer.phone ?? "");
    } else {
      setName("");
      setEmail("");
      setPhone("");
    }
  }, [open, customer]);

  if (!open) return null;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("El nombre del cliente es obligatorio.");
      return;
    }
    setBusy(true);
    try {
      if (!customer) {
        await createCustomer({
          business_id: businessId,
          name: trimmed,
          email: email.trim() || null,
          phone: phone.trim() || null,
          created_by: createdBy,
        });
        toast.success("Cliente creado.");
      } else {
        await updateCustomer(customer.id, {
          name: trimmed,
          email: email.trim() || null,
          phone: phone.trim() || null,
        });
        toast.success("Cliente actualizado.");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(`No se pudo guardar el cliente: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: 420, maxWidth: "100%", background: "#fff", borderRadius: 22, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,64,.35)" }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #E1E5EE", display: "flex", alignItems: "center", gap: 15 }}>
          <div
            style={{ width: 46, height: 46, borderRadius: 13, background: "#E7EFE8", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--brand)" }} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div style={{ fontWeight: 900, fontSize: 19, color: "#0F2A1B", flex: 1 }}>{customer ? "Editar cliente" : "Nuevo cliente"}</div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, border: 0, background: "#F6F7FB", borderRadius: 9, color: "#556A7C", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflow: "auto" }}>
          <div>
            <label style={labelStyle}>Nombre</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" />
          </div>
          <div>
            <label style={labelStyle}>Correo</label>
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Ej. cliente@correo.cl" />
          </div>
          <div>
            <label style={labelStyle}>Teléfono</label>
            <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+56 9 1234 5678" />
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #E1E5EE", background: "#FAFBFD", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ minWidth: 110, border: "1px solid #E1E5EE", background: "#fff", color: "#2A3A2E", borderRadius: 11, padding: "11px 18px", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={busy}
            style={{ minWidth: 130, border: 0, background: "var(--brand)", color: "#fff", borderRadius: 11, padding: "11px 18px", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
