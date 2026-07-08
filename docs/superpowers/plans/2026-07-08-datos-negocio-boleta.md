# Datos del negocio / boleta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La boleta impresa y los documentos (venta, cotización, nota de crédito) usan los datos reales del negocio en vez de placeholders, y una pantalla de Administración permite editarlos.

**Architecture:** Se lee la tabla `business` (que ya tiene `name`, `rut`, `giro`, `direccion`, `tagline`, `footer`, `logo_url`, `social_red`, `social_url`) con un hook nuevo `useBusiness`. Un helper `businessToNegocio` mapea esa fila al objeto `Negocio` que espera el payload ESC/POS, reemplazando los placeholders duplicados en tres componentes. Una pantalla de Administración edita esos campos vía `updateBusiness` (UPDATE directo; la política RLS `business_write` ya permite editar sólo a admin).

**Tech Stack:** React + Vite + TypeScript, TanStack Query, Supabase JS, Tailwind CSS v4, Vitest.

## Global Constraints

- Prosa en español; identificadores/código en inglés.
- Gestor de paquetes: **pnpm**. Tests: `pnpm test` (Vitest). Build: `pnpm build`.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; sin `Co-Authored-By` ni atribución a Claude.
- **Sin migración**: la política RLS de UPDATE (`business_write`, `supabase/migrations/20260707100400_rls.sql:29-30`) ya restringe la edición a admin (`is_pos_admin()`). Un cajero no puede editar (RLS lo bloquea).
- La impresora sigue siendo local (`src/lib/printerConfig.ts` → `getPrinterName()`); no se guarda en `business`.
- El objeto `Negocio` del payload ESC/POS (definido en `src-tauri/src/escpos.rs:6-16`) es: `{ tagline, razon_social, rut, giro, direccion, footer, printer_name, social }`, donde `social` es `null` o `{ red, url, etiqueta }` (`escpos.rs:4`).

---

### Task 1: Capa de datos del negocio + helper de mapeo

**Files:**
- Create: `src/data/business.ts`
- Test: `src/data/business.test.ts`

**Interfaces:**
- Consumes: `supabase` de `@/lib/supabase`.
- Produces:
  - `interface BusinessRow { id: string; name: string; rut: string; giro: string | null; direccion: string | null; tagline: string | null; footer: string | null; logo_url: string | null; social_red: string | null; social_url: string | null; }`
  - `useBusiness(businessId?: string)` → query con `data: BusinessRow | undefined`.
  - `updateBusiness(id: string, patch: Partial<Omit<BusinessRow, "id">>): Promise<void>`
  - `businessToNegocio(b: BusinessRow | undefined, printerName: string)` → objeto `Negocio` del payload ESC/POS.

- [ ] **Step 1: Escribir el test del helper `businessToNegocio`**

Crear `src/data/business.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { businessToNegocio, type BusinessRow } from "./business";

const base: BusinessRow = {
  id: "b1",
  name: "Vivero Kromi SpA",
  rut: "76.123.456-7",
  giro: "Venta de plantas",
  direccion: "Av. Siempreviva 742",
  tagline: "Tu jardín, nuestro oficio",
  footer: "¡Gracias por su compra!",
  logo_url: null,
  social_red: "Instagram",
  social_url: "https://instagram.com/kromi",
};

describe("businessToNegocio", () => {
  it("mapea los campos del negocio al payload ESC/POS", () => {
    const n = businessToNegocio(base, "GEZHI 80mm");
    expect(n.razon_social).toBe("Vivero Kromi SpA");
    expect(n.rut).toBe("76.123.456-7");
    expect(n.giro).toBe("Venta de plantas");
    expect(n.direccion).toBe("Av. Siempreviva 742");
    expect(n.tagline).toBe("Tu jardín, nuestro oficio");
    expect(n.footer).toBe("¡Gracias por su compra!");
    expect(n.printer_name).toBe("GEZHI 80mm");
    expect(n.social).toEqual({ red: "Instagram", url: "https://instagram.com/kromi", etiqueta: "Instagram" });
  });

  it("usa social null cuando falta red o url", () => {
    expect(businessToNegocio({ ...base, social_url: null }, "").social).toBeNull();
    expect(businessToNegocio({ ...base, social_red: null }, "").social).toBeNull();
  });

  it("convierte nulos en cadenas vacías y tolera business undefined", () => {
    const n = businessToNegocio({ ...base, giro: null, direccion: null, tagline: null, footer: null }, "");
    expect(n.giro).toBe("");
    expect(n.direccion).toBe("");
    expect(n.tagline).toBe("");
    expect(n.footer).toBe("");

    const empty = businessToNegocio(undefined, "P1");
    expect(empty.razon_social).toBe("");
    expect(empty.rut).toBe("");
    expect(empty.printer_name).toBe("P1");
    expect(empty.social).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `pnpm test -- src/data/business.test.ts`
Expected: FAIL (no existe `./business`).

- [ ] **Step 3: Implementar `src/data/business.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface BusinessRow {
  id: string;
  name: string;
  rut: string;
  giro: string | null;
  direccion: string | null;
  tagline: string | null;
  footer: string | null;
  logo_url: string | null;
  social_red: string | null;
  social_url: string | null;
}

const COLS = "id,name,rut,giro,direccion,tagline,footer,logo_url,social_red,social_url";

export function useBusiness(businessId?: string) {
  return useQuery({
    queryKey: ["business", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<BusinessRow> => {
      const { data, error } = await supabase.from("business").select(COLS).eq("id", businessId!).single();
      if (error) throw error;
      return data as BusinessRow;
    },
  });
}

export async function updateBusiness(id: string, patch: Partial<Omit<BusinessRow, "id">>) {
  const { error } = await supabase.from("business").update(patch).eq("id", id);
  if (error) throw error;
}

/** Objeto `social` del payload ESC/POS. `etiqueta` reutiliza el nombre de la red. */
interface NegocioSocial { red: string; url: string; etiqueta: string; }

/** Mapea la fila `business` al objeto `Negocio` que espera el payload de impresión
 *  (ver src-tauri/src/escpos.rs). `printerName` se inyecta aparte (config local). */
export function businessToNegocio(b: BusinessRow | undefined, printerName: string) {
  const social: NegocioSocial | null =
    b?.social_red && b?.social_url ? { red: b.social_red, url: b.social_url, etiqueta: b.social_red } : null;
  return {
    tagline: b?.tagline ?? "",
    razon_social: b?.name ?? "",
    rut: b?.rut ?? "",
    giro: b?.giro ?? "",
    direccion: b?.direccion ?? "",
    footer: b?.footer ?? "",
    printer_name: printerName,
    social,
  };
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `pnpm test -- src/data/business.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/business.ts src/data/business.test.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): capa de datos del negocio (useBusiness, updateBusiness, businessToNegocio)"
```

---

### Task 2: Boleta y documentos con datos reales del negocio

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx` (payload de boleta en `handleConfirmPay`; props a `QuotePanel` y `CreditNoteDialog`)
- Modify: `src/modules/venta/QuotePanel.tsx:36-77` (prop `negocioNombre` → `business`)
- Modify: `src/modules/venta/CreditNoteDialog.tsx:32,38,147-156` (prop `negocioNombre` → `business`)

**Interfaces:**
- Consumes: `useBusiness`, `businessToNegocio`, `BusinessRow` de `@/data/business` (Task 1); `getPrinterName` de `@/lib/printerConfig`.
- Produces: `QuotePanel` y `CreditNoteDialog` reciben `business?: BusinessRow` en vez de `negocioNombre: string`.

- [ ] **Step 1: En `VentaScreen`, leer el negocio**

En `src/modules/venta/VentaScreen.tsx`, junto a los otros hooks de datos (cerca de `const { data: customers } = useCustomers(businessId);`), agregar el import y el hook:

```tsx
// import (junto a los demás imports de datos)
import { useBusiness, businessToNegocio } from "@/data/business";

// dentro de VentaScreen(), junto a los otros useQuery:
const { data: business } = useBusiness(businessId);
```

- [ ] **Step 2: Reemplazar el payload placeholder de la boleta**

En `handleConfirmPay` de `VentaScreen.tsx`, sustituir el objeto `negocio: { ... }` del `payload` (el bloque con `razon_social: profile?.name ?? "Kromi POS"`, `rut: ""`, etc.) por el helper:

```tsx
const payload = {
  negocio: businessToNegocio(business, getPrinterName()),
  folio: sale.folio,
  fecha: `${pad2(soldAt.getDate())}/${pad2(soldAt.getMonth() + 1)}/${soldAt.getFullYear()}`,
  hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
  items: soldLines.map((l) => ({ nombre: l.product.name, qty: l.qty, precio: l.product.price })),
  neto: sale.neto,
  iva: sale.iva,
  total: sale.total,
  metodo: sale.method,
  open_drawer: sale.method === "efectivo",
};
```

(El comentario previo sobre "placeholders razonables" se elimina.)

- [ ] **Step 3: Pasar `business` a `QuotePanel` y `CreditNoteDialog`**

En el JSX de `VentaScreen.tsx`, cambiar la prop `negocioNombre={profile?.name ?? "Kromi POS"}` por `business={business}` en ambos componentes (`<QuotePanel ... />` y `<CreditNoteDialog ... />`).

- [ ] **Step 4: Actualizar `QuotePanel` para usar `business`**

En `src/modules/venta/QuotePanel.tsx`:
- Import: agregar `import { businessToNegocio, type BusinessRow } from "@/data/business";`
- En `QuotePanelProps`, reemplazar `negocioNombre: string;` por `business?: BusinessRow;`
- En la desestructuración de props, reemplazar `negocioNombre,` por `business,`
- Reemplazar el `useMemo` del objeto `negocio` (líneas 65-77) por:

```tsx
const negocio = useMemo(() => businessToNegocio(business, getPrinterName()), [business]);
```

(`getPrinterName` ya está importado en el archivo.)

- [ ] **Step 5: Actualizar `CreditNoteDialog` para usar `business`**

En `src/modules/venta/CreditNoteDialog.tsx`:
- Import: agregar `import { businessToNegocio, type BusinessRow } from "@/data/business";`
- En `CreditNoteDialogProps`, reemplazar `negocioNombre: string;` por `business?: BusinessRow;`
- En la firma del componente, reemplazar `negocioNombre` por `business` en la desestructuración.
- En la llamada `printCreditNote({ negocio: { ... }, ... })`, reemplazar el objeto `negocio` literal (líneas 147-156) por:

```tsx
          negocio: businessToNegocio(business, getPrinterName()),
```

(`getPrinterName` ya está importado en el archivo.)

- [ ] **Step 6: Verificar tipos y build**

Run: `pnpm build`
Expected: `tsc -b` sin errores (no deben quedar referencias a `negocioNombre`).

- [ ] **Step 7: Verificación manual**

Run: `pnpm dev`. Con datos de negocio cargados en la DB (seed), cobrar una venta y confirmar que la boleta impresa (o el payload) usa razón social, RUT, giro, dirección y pie reales. Repetir en cotización y nota de crédito.
Expected: documentos con datos reales, sin "Kromi POS"/campos vacíos.

- [ ] **Step 8: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx src/modules/venta/QuotePanel.tsx src/modules/venta/CreditNoteDialog.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): usar datos reales del negocio en boleta, cotizacion y nota de credito"
```

---

### Task 3: Pantalla de Administración para editar el negocio

**Files:**
- Create: `src/modules/admin/BusinessSettings.tsx`
- Modify: `src/App.tsx:6,12-19` (ruta `/admin` renderiza la pantalla real)

**Interfaces:**
- Consumes: `useBusiness`, `updateBusiness`, `BusinessRow` de `@/data/business`; `useAuth` de `@/auth/AuthProvider`; `useQueryClient` de `@tanstack/react-query`; `toast` de `sonner`.
- Produces: componente `BusinessSettings` (default o named export) usado en la ruta `/admin`.

- [ ] **Step 1: Implementar `BusinessSettings`**

Crear `src/modules/admin/BusinessSettings.tsx`. Formulario controlado con los campos editables; guarda con `updateBusiness` e invalida la query `["business", businessId]`.

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useBusiness, updateBusiness, type BusinessRow } from "@/data/business";

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
  { key: "logo_url", label: "Logo (URL)", placeholder: "https://…" },
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
```

- [ ] **Step 2: Conectar la ruta `/admin`**

En `src/App.tsx`, reemplazar el uso del `Placeholder` de Administración por la pantalla real. Cambiar el import y el cuerpo de `AdminRoute`:

```tsx
// import (junto a los otros imports de módulos)
import { BusinessSettings } from "@/modules/admin/BusinessSettings";

function AdminRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <BusinessSettings />
    </RequireRole>
  );
}
```

(Si `Placeholder` deja de usarse en el archivo, quitar su import para no dejar imports muertos.)

- [ ] **Step 3: Verificar tipos y build**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 4: Verificación manual**

Run: `pnpm dev`. Como admin, entrar a **Administración**: el formulario carga los datos actuales; editar y guardar muestra el toast y persiste (recargar mantiene los cambios). Cobrar una venta después de editar refleja los nuevos datos en la boleta.
Como cajero: la entrada Administración no aparece en el sidebar y `/admin` está protegida (`RequireRole`); si además intentara un update, RLS lo bloquea.
Expected: edición funciona para admin; cajero sin acceso.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/BusinessSettings.tsx src/App.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(admin): pantalla de datos del negocio editable en Administracion"
```

---

## Self-review (cobertura del spec)

- Boleta/documentos con datos reales → Task 2 (VentaScreen, QuotePanel, CreditNoteDialog).
- Hook `useBusiness` + helper de mapeo → Task 1.
- Pantalla de ajustes editable (solo admin) → Task 3 + política RLS existente `business_write`.
- Logo por URL → campo `logo_url` en el formulario (Task 3), sin upload.
- Impresora sigue local → no se toca `printerConfig`; `getPrinterName()` se inyecta en `businessToNegocio`.
