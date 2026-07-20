import { useEffect, useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import type { CustomerRow } from "@/data/customers";
import { createCustomer, updateCustomer } from "@/data/customers";
import { normRut } from "@/lib/rut";

/** Dígito verificador (0-9 o 'k') del cuerpo numérico de un RUT. */
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

function isValidRut(rut: string): boolean {
  const normalized = normRut(rut);
  if (normalized.length < 2) return false;
  const body = normalized.slice(0, -1);
  const dv = normalized.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  return computeRutDv(body) === dv;
}

const onlyDigits = (v: string) => v.replace(/\D/g, "");
const phoneLocal8 = (v: string | null | undefined) => onlyDigits(v ?? "").slice(-8);

interface EmpresaFormProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerRow | null;
  businessId: string;
  createdBy: string | null;
  onSaved: (customer?: CustomerRow) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #E1E5EE", borderRadius: 11, padding: "11px 14px",
  fontFamily: "inherit", fontSize: 14, color: "#0F2A1B", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#556A7C", marginBottom: 6 };

export function EmpresaForm({ open, onClose, customer, businessId, createdBy, onSaved }: EmpresaFormProps) {
  const [rut, setRut] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [giro, setGiro] = useState("");
  const [direccion, setDireccion] = useState("");
  const [comuna, setComuna] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [email, setEmail] = useState("");
  const [contacto, setContacto] = useState("");
  const [phone, setPhone] = useState("");
  const [direccionDespacho, setDireccionDespacho] = useState("");
  const [comunaDespacho, setComunaDespacho] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRut(customer?.rut ?? "");
    setRazonSocial(customer?.razon_social ?? "");
    setGiro(customer?.giro ?? "");
    setDireccion(customer?.direccion ?? "");
    setComuna(customer?.comuna ?? "");
    setCiudad(customer?.ciudad ?? "");
    setEmail(customer?.email ?? "");
    setContacto(customer?.contacto ?? "");
    setPhone(phoneLocal8(customer?.phone));
    setDireccionDespacho(customer?.direccion_despacho ?? "");
    setComunaDespacho(customer?.comuna_despacho ?? "");
    setObservaciones(customer?.observaciones ?? "");
  }, [open, customer]);

  if (!open) return null;

  async function save() {
    if (!isValidRut(rut)) {
      toast.error("El RUT de la empresa no es válido.");
      return;
    }
    const rs = razonSocial.trim();
    const gr = giro.trim();
    const dir = direccion.trim();
    const cmn = comuna.trim();
    if (!rs || !gr || !dir || !cmn) {
      toast.error("Razón social, giro, dirección y comuna son obligatorios para facturar.");
      return;
    }
    // Change-aware: solo validar/reformatear si el teléfono cambió respecto al cargado.
    // Preserva teléfonos legados (no conformes a la máscara) al editar otros campos.
    const initialPhone = phoneLocal8(customer?.phone);
    const phoneChanged = phone !== initialPhone;
    if (phoneChanged && phone && phone.length !== 8) {
      toast.error("El teléfono debe tener 8 dígitos (después de +56 9).");
      return;
    }
    const phoneToSave = phoneChanged ? (phone ? `+569${phone}` : null) : (customer?.phone ?? null);
    const fields = {
      name: rs, // el display de la lista es la razón social
      email: email.trim() || null,
      phone: phoneToSave,
      is_company: true,
      rut: normRut(rut),
      razon_social: rs,
      giro: gr,
      direccion: dir,
      comuna: cmn,
      ciudad: ciudad.trim() || null,
      direccion_despacho: direccionDespacho.trim() || null,
      comuna_despacho: comunaDespacho.trim() || null,
      contacto: contacto.trim() || null,
      observaciones: observaciones.trim() || null,
    };
    setBusy(true);
    try {
      if (!customer) {
        const created = await createCustomer({ business_id: businessId, created_by: createdBy, ...fields });
        toast.success("Empresa creada.");
        onSaved(created);
      } else {
        await updateCustomer(customer.id, fields);
        toast.success("Empresa actualizada.");
        onSaved();
      }
      onClose();
    } catch (e) {
      notifyError("No se pudo guardar la empresa.", e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 880, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 22, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,64,.35)" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #E1E5EE", display: "flex", alignItems: "center", gap: 15 }}>
          <div style={{ fontWeight: 900, fontSize: 19, color: "#0F2A1B", flex: 1 }}>{customer ? "Editar empresa" : "Nueva empresa"}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, border: 0, background: "#F6F7FB", borderRadius: 9, color: "#556A7C", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 20 }}>
          {/* Columna izquierda: datos tributarios obligatorios */}
          <div style={{ flex: "1 1 400px", minWidth: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignContent: "start" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Razón social</label>
              <input style={inputStyle} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} placeholder="Razón social de la empresa" />
            </div>
            <div>
              <label style={labelStyle}>RUT</label>
              <input style={inputStyle} value={rut} onChange={(e) => setRut(e.target.value)} placeholder="Ej. 76.123.456-7" />
            </div>
            <div>
              <label style={labelStyle}>Giro</label>
              <input style={inputStyle} value={giro} onChange={(e) => setGiro(e.target.value)} placeholder="Giro comercial" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Dirección tributaria</label>
              <input style={inputStyle} value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección" />
            </div>
            <div>
              <label style={labelStyle}>Comuna</label>
              <input style={inputStyle} value={comuna} onChange={(e) => setComuna(e.target.value)} placeholder="Comuna" />
            </div>
            <div>
              <label style={labelStyle}>Ciudad (opcional)</label>
              <input style={inputStyle} value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ciudad" />
            </div>
          </div>

          {/* Columna derecha: contacto + despacho + observaciones (opcionales) */}
          <div style={{ flex: "1 1 300px", minWidth: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignContent: "start" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Correo DTE (opcional)</label>
              <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Ej. facturacion@empresa.cl" />
            </div>
            <div>
              <label style={labelStyle}>Nombre de contacto (opcional)</label>
              <input style={inputStyle} value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Nombre de contacto" />
            </div>
            <div>
              <label style={labelStyle}>Teléfono (opcional)</label>
              <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #E1E5EE", borderRadius: 11, overflow: "hidden", background: "#fff" }}>
                <span style={{ display: "flex", alignItems: "center", padding: "0 12px", fontSize: 14, fontWeight: 700, color: "#556A7C", background: "#F6F7FB", borderRight: "1px solid #E1E5EE", whiteSpace: "nowrap" }}>+56 9</span>
                <input style={{ ...inputStyle, border: 0, borderRadius: 0 }} value={phone} onChange={(e) => setPhone(onlyDigits(e.target.value).slice(0, 8))} inputMode="numeric" placeholder="1234 5678" />
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Dirección de despacho (opcional)</label>
              <input style={inputStyle} value={direccionDespacho} onChange={(e) => setDireccionDespacho(e.target.value)} placeholder="Si es distinta a la tributaria" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Comuna de despacho (opcional)</label>
              <input style={inputStyle} value={comunaDespacho} onChange={(e) => setComunaDespacho(e.target.value)} placeholder="Comuna de despacho" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Observaciones (opcional)</label>
              <input style={inputStyle} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Observaciones" />
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1px solid #E1E5EE", background: "#FAFBFD", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{ minWidth: 110, border: "1px solid #E1E5EE", background: "#fff", color: "#2A3A2E", borderRadius: 11, padding: "11px 18px", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>Cancelar</button>
          <button onClick={save} disabled={busy} style={{ minWidth: 130, border: 0, background: "var(--brand)", color: "#fff", borderRadius: 11, padding: "11px 18px", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}
