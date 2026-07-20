import { useEffect, useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import type { CustomerRow } from "@/data/customers";
import { createCustomer, updateCustomer } from "@/data/customers";
import { normRut } from "@/lib/rut";

/** Calcula el dígito verificador (0-9 o 'k') para el cuerpo numérico de un RUT. */
function computeRutDv(body: string): string {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return "0";
  if (res === 10) return "k";
  return String(res);
}

/** Valida un RUT chileno usando la normalización de rut.ts + dígito verificador. */
function isValidRut(rut: string): boolean {
  const normalized = normRut(rut);
  if (normalized.length < 2) return false;
  const body = normalized.slice(0, -1);
  const dv = normalized.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  return computeRutDv(body) === dv;
}

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerRow | null;
  businessId: string;
  createdBy: string | null;
  onSaved: (customer?: CustomerRow) => void;
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

const onlyDigits = (v: string) => v.replace(/\D/g, "");
/** Extrae los últimos 8 dígitos de un teléfono guardado (ej. "+56912345678" → "12345678"). */
const phoneLocal8 = (v: string | null | undefined) => onlyDigits(v ?? "").slice(-8);

export function CustomerForm({ open, onClose, customer, businessId, createdBy, onSaved }: CustomerFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isCompany, setIsCompany] = useState(false);
  const [rut, setRut] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [giro, setGiro] = useState("");
  const [direccion, setDireccion] = useState("");
  const [comuna, setComuna] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (customer) {
      setName(customer.name);
      setEmail(customer.email ?? "");
      setPhone(phoneLocal8(customer.phone));
      setIsCompany(customer.is_company);
      setRut(customer.rut ?? "");
      setRazonSocial(customer.razon_social ?? "");
      setGiro(customer.giro ?? "");
      setDireccion(customer.direccion ?? "");
      setComuna(customer.comuna ?? "");
    } else {
      setName("");
      setEmail("");
      setPhone("");
      setIsCompany(false);
      setRut("");
      setRazonSocial("");
      setGiro("");
      setDireccion("");
      setComuna("");
    }
  }, [open, customer]);

  if (!open) return null;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("El nombre del cliente es obligatorio.");
      return;
    }

    // Teléfono opcional; si se ingresa debe tener los 8 dígitos que van después de +56 9.
    if (phone && phone.length !== 8) {
      toast.error("El teléfono debe tener 8 dígitos (después de +56 9).");
      return;
    }
    const phoneToSave = phone ? `+569${phone}` : null;

    const trimmedRazonSocial = razonSocial.trim();
    const trimmedGiro = giro.trim();
    const trimmedDireccion = direccion.trim();
    const trimmedComuna = comuna.trim();

    if (isCompany) {
      if (!isValidRut(rut)) {
        toast.error("El RUT de la empresa no es válido.");
        return;
      }
      if (!trimmedRazonSocial || !trimmedGiro || !trimmedDireccion || !trimmedComuna) {
        toast.error("Razón social, giro, dirección y comuna son obligatorios para facturar a empresa.");
        return;
      }
    }

    const companyFields = isCompany
      ? {
          is_company: true,
          rut: normRut(rut),
          razon_social: trimmedRazonSocial,
          giro: trimmedGiro,
          direccion: trimmedDireccion,
          comuna: trimmedComuna,
        }
      : {
          is_company: false,
          rut: null,
          razon_social: null,
          giro: null,
          direccion: null,
          comuna: null,
        };

    setBusy(true);
    try {
      if (!customer) {
        const created = await createCustomer({
          business_id: businessId,
          name: trimmed,
          email: email.trim() || null,
          phone: phoneToSave,
          created_by: createdBy,
          ...companyFields,
        });
        toast.success("Cliente creado.");
        onSaved(created);
      } else {
        await updateCustomer(customer.id, {
          name: trimmed,
          email: email.trim() || null,
          phone: phoneToSave,
          ...companyFields,
        });
        toast.success("Cliente actualizado.");
        onSaved();
      }
      onClose();
    } catch (e) {
      notifyError(`No se pudo guardar el cliente.`, e instanceof Error ? e.message : e);
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
            <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #E1E5EE", borderRadius: 11, overflow: "hidden", background: "#fff" }}>
              <span style={{ display: "flex", alignItems: "center", padding: "0 12px", fontSize: 14, fontWeight: 700, color: "#556A7C", background: "#F6F7FB", borderRight: "1px solid #E1E5EE", whiteSpace: "nowrap" }}>+56 9</span>
              <input
                style={{ ...inputStyle, border: 0, borderRadius: 0 }}
                value={phone}
                onChange={(e) => setPhone(onlyDigits(e.target.value).slice(0, 8))}
                inputMode="numeric"
                placeholder="1234 5678"
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#2A3A2E" }}>Empresa (factura)</div>
            <button
              type="button"
              role="switch"
              aria-checked={isCompany}
              onClick={() => setIsCompany((v) => !v)}
              style={{
                position: "relative",
                height: 26,
                width: 46,
                flex: "none",
                border: 0,
                borderRadius: 999,
                cursor: "pointer",
                background: isCompany ? "var(--brand)" : "#CBD5E1",
                transition: "background-color .15s",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: isCompany ? 23 : 3,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left .15s",
                }}
              />
            </button>
          </div>
          {isCompany && (
            <>
              <div>
                <label style={labelStyle}>RUT</label>
                <input style={inputStyle} value={rut} onChange={(e) => setRut(e.target.value)} placeholder="Ej. 76.123.456-7" />
              </div>
              <div>
                <label style={labelStyle}>Razón social</label>
                <input style={inputStyle} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} placeholder="Razón social de la empresa" />
              </div>
              <div>
                <label style={labelStyle}>Giro</label>
                <input style={inputStyle} value={giro} onChange={(e) => setGiro(e.target.value)} placeholder="Giro comercial" />
              </div>
              <div>
                <label style={labelStyle}>Dirección</label>
                <input style={inputStyle} value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección" />
              </div>
              <div>
                <label style={labelStyle}>Comuna</label>
                <input style={inputStyle} value={comuna} onChange={(e) => setComuna(e.target.value)} placeholder="Comuna" />
              </div>
            </>
          )}
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
