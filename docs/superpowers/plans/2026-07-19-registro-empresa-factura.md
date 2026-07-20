# Registro de empresa para factura + integración al DTE — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar el registro de clientes empresa (formulario dedicado con datos tributarios + opcionales) del de personas, y hacer que esos datos viajen al DTE de la factura (DTE 33), incluyendo `CiudadRecep` que hoy falta.

**Architecture:** Misma tabla `customer` con `is_company`; se agregan columnas opcionales. Nuevo componente `EmpresaForm.tsx` (layout horizontal de 2 columnas) para empresa; `CustomerForm.tsx` queda solo para persona (se le quita el toggle). `ClientesScreen` y `CustomerPickerDialog` ofrecen ambas entradas. La Edge Function `issue-receipt` mapea los campos nuevos al receptor de la factura y se redespliega.

**Tech Stack:** React + Vite + TypeScript, Tailwind + inline styles, Supabase/Postgres (migraciones SQL), Deno Edge Functions, Vitest.

## Global Constraints

- Prosa en español; código/identificadores en inglés (CLAUDE.md).
- RUT se guarda normalizado sin puntos ni guion (`normRut`); DV validado con `computeRutDv`.
- Teléfono persona/contacto: máscara `+56 9` + 8 dígitos, se guarda `+569XXXXXXXX`.
- `name` de una empresa = razón social. `is_company = true`.
- Columnas tributarias existentes: `rut, razon_social, giro, direccion, comuna`.
- Emisión en producción usa el proyecto Supabase `immuembrvocwbdpprypk` (ambiente SimpleFactura = 1, real).
- **Gap declarado:** los nombres/ubicación exactos de los campos DTE opcionales (`Contacto`, `CorreoRecep`, bloque `Transporte`) se verifican contra el Postman de SimpleFactura antes de la Task 7. `CiudadRecep` es estándar SII y ya está confirmado.

---

### Task 1: Migración — columnas nuevas en `customer`

**Files:**
- Create: `supabase/migrations/20260719130000_customer_empresa_opcionales.sql`
- Test: `supabase/tests/schema_test.sql` (agregar aserción)

**Interfaces:**
- Produces: columnas `ciudad, direccion_despacho, comuna_despacho, contacto, observaciones` (todas `text` nullable) en `public.customer`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Datos opcionales de empresa para el receptor de factura 33 (ciudad, despacho,
-- contacto y observaciones). Todos nullable: no afectan clientes/empresas existentes.
alter table public.customer
  add column if not exists ciudad             text,
  add column if not exists direccion_despacho text,
  add column if not exists comuna_despacho    text,
  add column if not exists contacto           text,
  add column if not exists observaciones      text;
```

- [ ] **Step 2: Agregar aserción de esquema al test**

En `supabase/tests/schema_test.sql`, agregar al final (sigue el estilo de las aserciones existentes del archivo):

```sql
-- customer: columnas opcionales de empresa (lote registro-empresa)
do $$
begin
  perform 1 from information_schema.columns
    where table_name = 'customer'
      and column_name in ('ciudad','direccion_despacho','comuna_despacho','contacto','observaciones');
  if (select count(*) from information_schema.columns
        where table_name = 'customer'
          and column_name in ('ciudad','direccion_despacho','comuna_despacho','contacto','observaciones')) <> 5 then
    raise exception 'faltan columnas opcionales de empresa en customer';
  end if;
end $$;
```

- [ ] **Step 3: Aplicar la migración y correr el test de esquema**

Run: `pnpm db:reset && pnpm test:schema`
Expected: la migración corre sin error; el test de esquema pasa (sin "faltan columnas opcionales de empresa").

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260719130000_customer_empresa_opcionales.sql supabase/tests/schema_test.sql
git commit -m "feat(db): columnas opcionales de empresa en customer (ciudad/despacho/contacto/observaciones)"
```

---

### Task 2: Capa de datos — extender `customers.ts`

**Files:**
- Modify: `src/data/customers.ts`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `CustomerRow` con `ciudad, direccion_despacho, comuna_despacho, contacto, observaciones` (`string | null`); `createCustomer`/`updateCustomer` aceptan esos campos.

- [ ] **Step 1: Extender la interfaz `CustomerRow`**

En `src/data/customers.ts`, agregar al final de la interfaz `CustomerRow` (después de `comuna`):

```ts
  ciudad: string | null;
  direccion_despacho: string | null;
  comuna_despacho: string | null;
  contacto: string | null;
  observaciones: string | null;
```

- [ ] **Step 2: Agregar las columnas a los tres `select` y a los inputs**

Reemplazar el string de columnas (aparece 3 veces: `useCustomers`, `createCustomer`, `updateCustomer`) de:

```
"id,name,email,phone,points,spent,visits,is_company,rut,razon_social,giro,direccion,comuna"
```

por:

```
"id,name,email,phone,points,spent,visits,is_company,rut,razon_social,giro,direccion,comuna,ciudad,direccion_despacho,comuna_despacho,contacto,observaciones"
```

En el objeto `input` de `createCustomer`, agregar (después de `comuna?`):

```ts
  ciudad?: string | null;
  direccion_despacho?: string | null;
  comuna_despacho?: string | null;
  contacto?: string | null;
  observaciones?: string | null;
```

En el `Partial<{...}>` de `updateCustomer`, agregar las mismas cinco claves con tipo `string | null`.

- [ ] **Step 3: Verificar tipos**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/data/customers.ts
git commit -m "feat(data): campos opcionales de empresa en CustomerRow y create/updateCustomer"
```

---

### Task 3: `CustomerForm` solo persona (quitar toggle)

**Files:**
- Modify: `src/modules/clientes/CustomerForm.tsx`

**Interfaces:**
- Produces: `CustomerForm` sin lógica de empresa; al guardar fija `is_company:false` y los campos tributarios en `null`. Props sin cambios.

- [ ] **Step 1: Quitar estado y efectos de empresa**

Eliminar los `useState` de `isCompany, rut, razonSocial, giro, direccion, comuna` y sus `setX(...)` en el `useEffect` (tanto rama `customer` como `else`). Eliminar las funciones `computeRutDv`/`isValidRut` y el import de `normRut` (ya no se usan en este archivo).

- [ ] **Step 2: Simplificar `save()`**

Reemplazar el bloque de validación empresa + `companyFields` por el guardado directo de persona. El cuerpo de `save()` queda:

```ts
  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("El nombre del cliente es obligatorio.");
      return;
    }
    if (phone && phone.length !== 8) {
      toast.error("El teléfono debe tener 8 dígitos (después de +56 9).");
      return;
    }
    const phoneToSave = phone ? `+569${phone}` : null;

    setBusy(true);
    try {
      if (!customer) {
        const created = await createCustomer({
          business_id: businessId,
          name: trimmed,
          email: email.trim() || null,
          phone: phoneToSave,
          created_by: createdBy,
          is_company: false,
        });
        toast.success("Cliente creado.");
        onSaved(created);
      } else {
        await updateCustomer(customer.id, {
          name: trimmed,
          email: email.trim() || null,
          phone: phoneToSave,
          is_company: false,
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
```

- [ ] **Step 3: Quitar el bloque JSX del toggle y de los campos empresa**

Eliminar el `<div>` del switch "Empresa (factura)" y todo el bloque `{isCompany && (<>...</>)}` (RUT, razón social, giro, dirección, comuna). El form queda: Nombre, Correo, Teléfono.

- [ ] **Step 4: Verificar tipos**

Run: `pnpm typecheck`
Expected: sin errores (si aparece "isValidRut is declared but never used" u otro, eliminar el símbolo huérfano).

- [ ] **Step 5: Commit**

```bash
git add src/modules/clientes/CustomerForm.tsx
git commit -m "refactor(clientes): CustomerForm solo persona; empresa se maneja en EmpresaForm"
```

---

### Task 4: Componente `EmpresaForm.tsx`

**Files:**
- Create: `src/modules/clientes/EmpresaForm.tsx`

**Interfaces:**
- Consumes: `createCustomer`/`updateCustomer` (Task 2), `normRut` de `@/lib/rut`.
- Produces: `export function EmpresaForm(props: EmpresaFormProps)` con la misma forma de props que `CustomerForm` (`open, onClose, customer: CustomerRow | null, businessId, createdBy, onSaved`).

- [ ] **Step 1: Crear el componente**

```tsx
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
    if (phone && phone.length !== 8) {
      toast.error("El teléfono debe tener 8 dígitos (después de +56 9).");
      return;
    }
    const fields = {
      name: rs, // el display de la lista es la razón social
      email: email.trim() || null,
      phone: phone ? `+569${phone}` : null,
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
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/modules/clientes/EmpresaForm.tsx
git commit -m "feat(clientes): EmpresaForm dedicado (datos tributarios + opcionales, layout horizontal)"
```

---

### Task 5: `ClientesScreen` con dos entradas

**Files:**
- Modify: `src/modules/clientes/ClientesScreen.tsx`

**Interfaces:**
- Consumes: `EmpresaForm` (Task 4), `CustomerForm` (Task 3).

- [ ] **Step 1: Importar `EmpresaForm` y agregar estado del modal empresa**

Agregar import: `import { EmpresaForm } from "./EmpresaForm";`
Junto a `const [formOpen, setFormOpen] = useState(false);` agregar:

```tsx
  const [empresaOpen, setEmpresaOpen] = useState(false);
```

- [ ] **Step 2: Botón "Nueva empresa" en el header**

Reemplazar el único botón "+ Nuevo cliente" por dos botones envueltos en un contenedor flex:

```tsx
        <div className="flex gap-2.5">
          <button
            onClick={() => { setEditing(null); setEmpresaOpen(true); }}
            className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
          >
            + Nueva empresa
          </button>
          <button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="flex items-center gap-2 rounded-xl border border-[#A7E3C0] bg-[#E6F7EE] px-[18px] py-3 text-sm font-bold text-[#0a6e36]"
          >
            + Nuevo cliente
          </button>
        </div>
```

- [ ] **Step 3: Editar abre el form según `is_company`**

En el botón ✎ de cada fila, reemplazar el `onClick`:

```tsx
                  onClick={() => {
                    setEditing(c);
                    if (c.is_company) setEmpresaOpen(true);
                    else setFormOpen(true);
                  }}
```

- [ ] **Step 4: Renderizar `EmpresaForm`**

Después del bloque `{formOpen && (<CustomerForm ... />)}`, agregar:

```tsx
      {empresaOpen && (
        <EmpresaForm
          open={empresaOpen}
          onClose={() => setEmpresaOpen(false)}
          customer={editing}
          businessId={businessId ?? ""}
          createdBy={profile?.id ?? null}
          onSaved={refetchAll}
        />
      )}
```

- [ ] **Step 5: Verificar tipos y correr tests del frontend**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; tests verdes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/clientes/ClientesScreen.tsx
git commit -m "feat(clientes): entradas separadas Nueva empresa / Nuevo cliente y edición según tipo"
```

---

### Task 6: `CustomerPickerDialog` — crear empresa en la venta

**Files:**
- Modify: `src/modules/venta/CustomerPickerDialog.tsx`

**Interfaces:**
- Consumes: `EmpresaForm` (Task 4).

- [ ] **Step 1: Leer el archivo y ubicar el estado que abre `CustomerForm`**

Run: `sed -n '1,60p' src/modules/venta/CustomerPickerDialog.tsx`
Expected: ver el import de `CustomerForm`, el estado booleano que lo abre (p. ej. `formOpen`/`createOpen`) y el botón que lo dispara.

- [ ] **Step 2: Importar `EmpresaForm` y agregar estado paralelo**

Agregar: `import { EmpresaForm } from "@/modules/clientes/EmpresaForm";`
Agregar un estado booleano análogo al del `CustomerForm`, `const [empresaOpen, setEmpresaOpen] = useState(false);`.

- [ ] **Step 3: Botón "Nueva empresa" junto al de nuevo cliente**

Junto al botón que hoy abre `CustomerForm` para crear, agregar un botón "Nueva empresa" que haga `setEmpresaOpen(true)` (mismo patrón visual que el existente). Mantener el `onSaved` que ya selecciona el cliente creado en la venta (reutilizar el mismo callback que usa `CustomerForm`, que recibe el `CustomerRow` creado).

- [ ] **Step 4: Renderizar `EmpresaForm` con el mismo `onSaved`**

Replicar el bloque de render de `CustomerForm` para `EmpresaForm`, pasando `open={empresaOpen}`, `onClose={() => setEmpresaOpen(false)}`, `customer={null}` y el mismo `businessId`/`createdBy`/`onSaved` que ya usa el `CustomerForm` del picker.

- [ ] **Step 5: Verificar el flujo de factura**

Run: `pnpm typecheck`
Expected: sin errores. Verificación manual (Task 8): crear empresa desde la venta selecciona el cliente y habilita `canFactura` (`is_company && rut`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/venta/CustomerPickerDialog.tsx
git commit -m "feat(venta): permitir crear empresa desde el selector de cliente (factura)"
```

---

### Task 7: `issue-receipt` — mapear campos al receptor de factura

**Files:**
- Modify: `supabase/functions/issue-receipt/index.ts`

**Interfaces:**
- Consumes: columnas de Task 1 en `customer`.

- [ ] **Step 1: Nombres de campos confirmados (gap cerrado)**

Verificado contra el SDK oficial de SimpleFactura (`SDKSimpleFacturaPHP`, `src/Models/Facturacion/`). Nombres exactos a usar:
- `Receptor`: `CiudadRecep` (ciudad), `Contacto` (teléfono/email del contacto), `CorreoRecep` (correo). Todos opcionales.
- `Transporte`: `DirDest`, `CmnaDest`, `CiudadDest`. **Va dentro de `Encabezado`** (junto a IdDoc/Emisor/Receptor/Totales), NO bajo `Documento`.
- `IdDoc.FmaPago` ya existe (se mantiene en 1).

- [ ] **Step 2: Ampliar el `select` del customer y su tipo**

En la rama `if (esFactura)`, cambiar el `select` de:

```ts
        .select("rut,razon_social,giro,direccion,comuna")
```

a:

```ts
        .select("rut,razon_social,giro,direccion,comuna,ciudad,direccion_despacho,comuna_despacho,contacto,email")
```

Y ampliar el tipo local `customer` para incluir esas claves (`ciudad, direccion_despacho, comuna_despacho, contacto, email` como `string | null`).

- [ ] **Step 3: Agregar `CiudadRecep` y opcionales al receptor de factura**

Reemplazar el objeto `receptor` de la rama factura por:

```ts
      receptor = {
        RUTRecep: formatRutDashed(customer!.rut!),
        RznSocRecep: customer!.razon_social,
        GiroRecep: customer!.giro,
        DirRecep: customer!.direccion,
        CmnaRecep: customer!.comuna,
        ...(customer!.ciudad ? { CiudadRecep: customer!.ciudad } : {}),
        ...(customer!.contacto ? { Contacto: customer!.contacto } : {}),
        ...(customer!.email ? { CorreoRecep: customer!.email } : {}),
      };
```

Para la dirección de despacho, agregar el bloque `Transporte` **dentro del `Encabezado`** del `body` (junto a IdDoc/Emisor/Receptor/Totales), solo cuando haya dirección de despacho. En el objeto literal `body.Documento.Encabezado`, agregar como última clave:

```ts
          ...(esFactura && customer!.direccion_despacho
            ? {
                Transporte: {
                  DirDest: customer!.direccion_despacho,
                  ...(customer!.comuna_despacho ? { CmnaDest: customer!.comuna_despacho } : {}),
                  ...(customer!.ciudad ? { CiudadDest: customer!.ciudad } : {}),
                },
              }
            : {}),
```

- [ ] **Step 4: Verificar que la función parsea sin error de sintaxis**

Run: `npx --yes deno@2 check supabase/functions/issue-receipt/index.ts`
Expected: sin errores de tipo/sintaxis. (Si `deno` no está disponible, al menos revisar que el archivo compone bien el objeto `body` y `Transporte`.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/issue-receipt/index.ts
git commit -m "feat(dte): CiudadRecep + contacto/correo/despacho del receptor en factura 33"
```

- [ ] **Step 6: Desplegar a producción**

Ejecutar (login ya realizado en sesión previa):

```bash
npx --yes supabase functions deploy issue-receipt --project-ref immuembrvocwbdpprypk
```

Expected: "Deployed Function issue-receipt".

---

### Task 8: Verificación end-to-end

**Files:** ninguno (verificación manual).

- [ ] **Step 1: Correr la app**

Run: `pnpm tauri dev` (o `pnpm dev`).

- [ ] **Step 2: Registrar una empresa**

En Clientes → "Nueva empresa": cargar RUT válido, razón social, giro, dirección, comuna, ciudad y (opcional) dirección de despacho. Guardar. Verificar que aparece en la lista con la razón social como nombre y el badge de empresa donde corresponda.

- [ ] **Step 3: Emitir una factura**

En la venta: seleccionar esa empresa, elegir Factura, confirmar el cobro. Descargar/ver el PDF del DTE y confirmar que el bloque Receptor muestra: Señor(es) = razón social, RUT, Dirección, Comuna y **Ciudad** reales (no "Cliente sin especificar" ni "Santiago" por defecto).

- [ ] **Step 4: Registrar un cliente persona**

En Clientes → "Nuevo cliente": confirmar que el formulario solo pide Nombre, Correo, Teléfono (con máscara +56 9) y que ya no aparece el toggle de empresa.

---

## Self-Review

- **Spec coverage:** dos formularios separados (Tasks 3-6) ✓; columnas nuevas (Task 1) ✓; capa de datos (Task 2) ✓; `name`=razón social (Task 4) ✓; `CiudadRecep` + opcionales al DTE (Task 7) ✓; redeploy (Task 7 Step 6) ✓; gap de docs (Task 7 Step 1) ✓; entrada empresa en la venta — descubierto en exploración, cubierto en Task 6.
- **Placeholder scan:** sin TBD/TODO; el único paso "abrir y leer" (Task 6 Step 1, Task 7 Step 1) es verificación deliberada con salida esperada, no un placeholder de implementación.
- **Type consistency:** `CustomerRow` (Task 2) usa `ciudad, direccion_despacho, comuna_despacho, contacto, observaciones`; `EmpresaForm` (Task 4) y `issue-receipt` (Task 7) usan exactamente esos nombres; `phoneLocal8`/`onlyDigits` coinciden con la máscara ya implementada en `CustomerForm`.
