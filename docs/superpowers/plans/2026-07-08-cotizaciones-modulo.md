# Cotizaciones como módulo independiente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cotizar deja de requerir caja abierta: las cotizaciones pasan a un módulo propio (`/cotizaciones`) con su propio armador de líneas (buscador + lista), accesible a cajero y admin. La conversión a venta sigue exigiendo caja abierta.

**Architecture:** Un nuevo `CotizacionesScreen` autónomo arma la cotización con un buscador de productos y un panel de líneas (sin depender del carrito de venta), reutilizando la capa de datos existente (`crearCotizacion`, `useQuotes`, `convertirCotizacion`). La conversión usa la sesión de caja abierta (`useOpenSession`) y avisa si no hay. Se elimina la pestaña "Cotizaciones" de `VentaScreen` y el componente `QuotePanel`.

**Tech Stack:** React + Vite + TypeScript, TanStack Query, Supabase, Tailwind CSS v4.

## Global Constraints

- Prosa en español; identificadores/código en inglés.
- Gestor de paquetes: **pnpm**. Tests: `pnpm test`. Build: `pnpm build`.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; sin `Co-Authored-By` ni atribución a Claude.
- Sin migración: `crear_cotizacion` no requiere caja; `convertir_cotizacion` requiere `session` (RPC existentes).
- Precios con IVA incluido (`computeTotals`: `neto = round(total/1.19)`).
- El precio real de la cotización lo fija el servidor en `crear_cotizacion`; el frontend sólo muestra `product.price` como referencia.

---

### Task 1: Módulo `CotizacionesScreen`

**Files:**
- Create: `src/modules/cotizaciones/CotizacionesScreen.tsx`

**Interfaces:**
- Consumes: `useProductsWithStock` (`@/data/stock`), `useCustomers` (`@/data/customers`), `useBusiness`, `businessToNegocio` (`@/data/business`), `crearCotizacion`, `convertirCotizacion`, `useQuotes`, `isQuoteVigente`, `type QuoteRow` (`@/data/sales`), `useOpenSession` (`@/data/work`), `useWork` (`@/session/WorkContext`), `useAuth` (`@/auth/AuthProvider`), `computeTotals`, `fmtCLP` (`@/lib/money`), `printQuote`, `printReceipt` (`@/lib/print`), `getPrinterName` (`@/lib/printerConfig`), `errMsg` (`@/lib/errors`), `PayDialog`, `type PayMethod` (`@/modules/venta/PayDialog`).
- Produces: `CotizacionesScreen` (named export).

- [ ] **Step 1: Implementar `CotizacionesScreen`**

Crear `src/modules/cotizaciones/CotizacionesScreen.tsx`:

```tsx
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession } from "@/data/work";
import { useProductsWithStock } from "@/data/stock";
import type { ProductRow } from "@/data/stock";
import { useCustomers } from "@/data/customers";
import { useBusiness, businessToNegocio } from "@/data/business";
import { crearCotizacion, convertirCotizacion, useQuotes, isQuoteVigente, type QuoteRow } from "@/data/sales";
import { computeTotals, fmtCLP } from "@/lib/money";
import { printQuote, printReceipt } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { errMsg } from "@/lib/errors";
import { PayDialog, type PayMethod } from "@/modules/venta/PayDialog";

interface QuoteItem { id: string; qty: number; }

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function fmtDate(d: Date): string { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
function fmtIsoDate(iso: string): string { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function CotizacionesScreen() {
  const { profile } = useAuth();
  const { branch, register } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const qc = useQueryClient();

  const { data: openSession } = useOpenSession(register?.id);
  const { data: products } = useProductsWithStock(businessId, branchId);
  const { data: customers } = useCustomers(businessId);
  const { data: business } = useBusiness(businessId);
  const { data: quotes, isLoading } = useQuotes(branchId);

  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<QuoteItem[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [validDays, setValidDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<QuoteRow | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const allProducts = products ?? [];
  const allCustomers = customers ?? [];
  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
  const negocio = useMemo(() => businessToNegocio(business, getPrinterName()), [business]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as ProductRow[];
    return allProducts.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [allProducts, query]);

  const quoteLines = useMemo(
    () => lines.map((l) => ({ product: productById.get(l.id)!, qty: l.qty })).filter((l) => l.product),
    [lines, productById],
  );
  const totals = useMemo(() => computeTotals(quoteLines.map((l) => ({ qty: l.qty, price: l.product.price }))), [quoteLines]);

  function addLine(p: ProductRow) {
    setLines((ls) => {
      const i = ls.findIndex((x) => x.id === p.id);
      if (i >= 0) { const n = ls.slice(); n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
      return [...ls, { id: p.id, qty: 1 }];
    });
  }
  function incLine(id: string) { setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l))); }
  function decLine(id: string) {
    setLines((ls) => ls.flatMap((l) => (l.id === id ? (l.qty <= 1 ? [] : [{ ...l, qty: l.qty - 1 }]) : [l])));
  }

  async function handleCrear() {
    if (!branchId || lines.length === 0) return;
    setCreating(true);
    try {
      const quote = await crearCotizacion({
        branch_id: branchId,
        customer_id: customerId,
        valid_until: isoPlusDays(validDays),
        lines: lines.map((l) => ({ product_id: l.id, qty: l.qty })),
      });
      toast.success(`Cotización #${quote.folio} generada.`);
      setLines([]);
      setCustomerId(null);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      try {
        await printQuote({
          negocio,
          folio: quote.folio,
          fecha: fmtDate(new Date()),
          valido_hasta: fmtIsoDate(quote.valid_until),
          cliente: customerId ? (allCustomers.find((c) => c.id === customerId)?.name ?? "Sin cliente") : "Sin cliente",
          items: quoteLines.map((l) => ({ nombre: l.product.name, qty: l.qty, precio: l.product.price })),
          neto: quote.neto,
          iva: quote.iva,
          total: quote.total,
        });
      } catch (e) {
        toast.error(`La cotización se generó, pero no se pudo imprimir: ${errMsg(e)}`);
      }
    } catch (e) {
      toast.error(`No se pudo generar la cotización: ${errMsg(e)}`);
    } finally {
      setCreating(false);
    }
  }

  async function handlePrint(q: QuoteRow) {
    try {
      await printQuote({
        negocio,
        folio: q.folio,
        fecha: fmtIsoDate(q.created_at.slice(0, 10)),
        valido_hasta: fmtIsoDate(q.valid_until),
        cliente: q.customer_name ?? "Sin cliente",
        items: q.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot })),
        neto: q.neto,
        iva: q.iva,
        total: q.total,
      });
    } catch (e) {
      toast.error(`No se pudo imprimir la cotización: ${errMsg(e)}`);
    }
  }

  function tryConvert(q: QuoteRow) {
    if (!openSession) {
      toast.error("Abre la caja para convertir la cotización en venta.");
      return;
    }
    setConverting(q);
  }

  async function handleConfirmConvert(method: PayMethod, recv: number) {
    if (!converting || !openSession) return;
    setPayBusy(true);
    try {
      const sale = await convertirCotizacion(converting.id, openSession.id, method, recv);
      const soldAt = new Date(sale.sold_at);
      toast.success(`Cotización convertida en venta #${sale.folio}.`);
      const quoteLinesSnap = converting.lines;
      setConverting(null);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["sales-today"] });
      qc.invalidateQueries({ queryKey: ["recent-sales"] });
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["customers", businessId] });
      try {
        await printReceipt({
          negocio,
          folio: sale.folio,
          fecha: fmtDate(soldAt),
          hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
          items: quoteLinesSnap.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot })),
          neto: sale.neto,
          iva: sale.iva,
          total: sale.total,
          metodo: sale.method,
          open_drawer: sale.method === "efectivo",
        });
      } catch (e) {
        toast.error(`La venta se registró, pero no se pudo imprimir la boleta: ${errMsg(e)}`);
      }
    } catch (e) {
      toast.error(`No se pudo convertir la cotización: ${errMsg(e)}`);
    } finally {
      setPayBusy(false);
    }
  }

  const rows = quotes ?? [];

  return (
    <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Ventas</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Cotizaciones</h2>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Buscador + resultados */}
        <div className="rounded-2xl border border-[#E1E5EE] bg-white p-4">
          <div className="mb-3 text-[15px] font-black text-[#0F2A1B]">Agregar productos</div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto por nombre…"
            className="mb-3 w-full rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none focus:border-[var(--brand)]"
          />
          <div className="flex max-h-[320px] flex-col gap-1.5 overflow-auto">
            {query.trim() === "" && <div className="py-6 text-center text-[13px] text-[#9aa8bd]">Escribe para buscar productos.</div>}
            {query.trim() !== "" && results.length === 0 && <div className="py-6 text-center text-[13px] text-[#9aa8bd]">Sin resultados.</div>}
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => addLine(p)}
                className="flex items-center gap-3 rounded-xl border border-[#EEF1F6] bg-white px-3 py-2 text-left hover:border-[#A7E3C0]"
              >
                <div className="min-w-0 flex-1 truncate text-sm font-bold text-[#0F2A1B]">{p.name}</div>
                <div className="text-[13px] font-bold text-[#7C95A8]">{fmtCLP(p.price)}</div>
                <span className="flex size-[26px] items-center justify-center rounded-lg bg-[#D3F4E0] text-lg" style={{ color: "var(--brand)" }}>+</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cotización actual */}
        <div className="flex flex-col rounded-2xl border border-[#E1E5EE] bg-white p-4">
          <div className="mb-3 text-[15px] font-black text-[#0F2A1B]">Cotización actual</div>
          <div className="mb-3 flex min-h-[80px] flex-col gap-1.5">
            {quoteLines.length === 0 && <div className="py-6 text-center text-[13px] text-[#9aa8bd]">Sin ítems. Busca y agrega productos.</div>}
            {quoteLines.map(({ product, qty }) => (
              <div key={product.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[#0F2A1B]">{product.name}</div>
                  <div className="text-xs text-[#7C95A8]">{fmtCLP(product.price)} c/u</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => decLine(product.id)} className="flex size-[26px] items-center justify-center rounded-lg border border-[#E1E5EE] bg-white text-base text-[#7C95A8]">–</button>
                  <span className="min-w-4 text-center text-sm font-bold text-[#0F2A1B]">{qty}</span>
                  <button onClick={() => incLine(product.id)} className="flex size-[26px] items-center justify-center rounded-lg bg-[#D3F4E0] text-base" style={{ color: "var(--brand)" }}>+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex items-baseline justify-between border-t border-[#E1E5EE] pt-3">
            <span className="text-sm font-bold text-[#7C95A8]">Total ({totals.items} ítems)</span>
            <span className="text-[22px] font-black text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={customerId ?? ""}
              onChange={(e) => setCustomerId(e.target.value || null)}
              className="rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[13px] font-bold text-[#2A3A2E] outline-none"
            >
              <option value="">Sin cliente</option>
              {allCustomers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <select
              value={validDays}
              onChange={(e) => setValidDays(Number(e.target.value))}
              className="rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[13px] font-bold text-[#0F2A1B] outline-none"
            >
              <option value={7}>Válida 7 días</option>
              <option value={15}>Válida 15 días</option>
              <option value={30}>Válida 30 días</option>
            </select>
            <button
              onClick={handleCrear}
              disabled={creating || lines.length === 0}
              className="ml-auto rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: "var(--brand)" }}
            >
              {creating ? "Generando…" : "Generar cotización"}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-3 text-[15px] font-black text-[#0F2A1B]">Cotizaciones</div>
      {isLoading && <div className="py-6 text-center text-[13px] text-[#9aa8bd]">Cargando cotizaciones…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-[#E1E5EE] bg-white py-8 text-center text-[13.5px] text-[#9aa8bd]">Aún no hay cotizaciones.</div>
      )}
      <div className="flex flex-col gap-2.5">
        {rows.map((q) => {
          const vigente = isQuoteVigente(q.valid_until);
          const items = q.lines.reduce((s, l) => s + l.qty, 0);
          const badge = q.converted
            ? { label: "Convertida", bg: "#EAF0FF", fg: "#1d4ed8" }
            : vigente ? { label: "Vigente", bg: "#E6F7EE", fg: "#0a6e36" } : { label: "Vencida", bg: "#FCECEC", fg: "#c0392b" };
          const canConvert = !q.converted && vigente;
          return (
            <div key={q.id} className="flex items-center gap-4 rounded-2xl border border-[#E1E5EE] bg-white px-[18px] py-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-extrabold text-[#0F2A1B]">COT-{q.folio} · {q.customer_name ?? "Sin cliente"}</div>
                <div className="mt-0.5 text-[12.5px] text-[#7C95A8]">{fmtIsoDate(q.created_at.slice(0, 10))} · Vence {fmtIsoDate(q.valid_until)} · {items} ítems</div>
              </div>
              <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
              <div className="text-base font-black text-[#0F2A1B]">{fmtCLP(q.total)}</div>
              <button onClick={() => handlePrint(q)} className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-2 text-[13px] font-bold text-[#5a6b7e]">Imprimir</button>
              <button
                onClick={() => tryConvert(q)}
                disabled={!canConvert}
                className="rounded-[10px] border px-3.5 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: "var(--brand)", color: "var(--brand)", background: "#fff" }}
              >
                Convertir
              </button>
            </div>
          );
        })}
      </div>

      <PayDialog
        open={!!converting}
        total={converting?.total ?? 0}
        busy={payBusy}
        onClose={() => setConverting(null)}
        onConfirm={handleConfirmConvert}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/modules/cotizaciones/CotizacionesScreen.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(cotizaciones): modulo independiente con armador propio (buscador + lista)"
```

---

### Task 2: Ruta `/cotizaciones` y navegación

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/session/nav.ts`
- Modify: `src/shell/AppLayout.tsx` (icono de nav)

**Interfaces:**
- Consumes: `CotizacionesScreen` (Task 1).
- Produces: ruta `/cotizaciones` para todos los roles autenticados; entrada "Cotizaciones" en el sidebar.

- [ ] **Step 1: Agregar la ruta en `App.tsx`**

Import (junto a los otros módulos):

```tsx
import { CotizacionesScreen } from "@/modules/cotizaciones/CotizacionesScreen";
```

Ruta (dentro de `<Route element={<RequireAuth><AppLayout /></RequireAuth>}>`, junto a las demás):

```tsx
<Route path="cotizaciones" element={<CotizacionesScreen />} />
```

- [ ] **Step 2: Agregar la entrada de navegación en `nav.ts`**

En `src/session/nav.ts`, añadir "Cotizaciones" al arreglo `BASE` (visible para todos los roles), después de "Venta":

```ts
const BASE: NavItem[] = [
  { to: "/", label: "Inicio" },
  { to: "/venta", label: "Venta" },
  { to: "/cotizaciones", label: "Cotizaciones" },
  { to: "/stock", label: "Stock" },
  { to: "/clientes", label: "Clientes" },
];
```

- [ ] **Step 3: Asignar icono en `AppLayout`**

En `src/shell/AppLayout.tsx`, importar `FileText` de lucide y añadirlo al mapa `NAV_ICON`:

```tsx
// en el import de lucide-react, agregar FileText:
import { Home, ShoppingCart, Package, Users, Settings, LogOut, FileText, type LucideIcon } from "lucide-react";

// en NAV_ICON, agregar:
  Cotizaciones: FileText,
```

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: `tsc -b` sin errores; `/cotizaciones` disponible y en el sidebar.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/session/nav.ts src/shell/AppLayout.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(cotizaciones): ruta /cotizaciones y entrada en el sidebar"
```

---

### Task 3: Quitar cotizaciones de VentaScreen y eliminar QuotePanel

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`
- Delete: `src/modules/venta/QuotePanel.tsx`

**Interfaces:**
- Produces: `VentaScreen` sin pestañas (solo venta); ya no importa `QuotePanel`.

- [ ] **Step 1: Quitar el import y el estado de pestañas en `VentaScreen`**

- Eliminar el import `import { QuotePanel } from "./QuotePanel";`.
- Eliminar el estado `const [tab, setTab] = useState<"venta" | "cotizaciones">("venta");`.

- [ ] **Step 2: Quitar la UI de pestañas y el render de `QuotePanel`**

- Eliminar el bloque de botones de pestañas ("Venta" / "Cotizaciones") del encabezado.
- El buscador de productos (que estaba condicionado a `tab === "venta"`) queda **siempre** visible.
- Reemplazar el render condicional `{tab === "cotizaciones" ? (<QuotePanel .../>) : (<> ...contenido de venta... </>)}` por únicamente el contenido de venta (categorías + grilla de productos).
- El `<Cart>` estaba condicionado a `tab === "venta"`; queda **siempre** visible.
- Simplificar el `className` condicional del `<select>` de cliente que dependía de `tab` (dejar el estilo base sin la parte `tab === "venta" ? "" : "ml-auto"`).

- [ ] **Step 3: Eliminar `QuotePanel.tsx`**

```bash
git rm src/modules/venta/QuotePanel.tsx
```

- [ ] **Step 4: Verificar tipos y build**

Run: `pnpm build`
Expected: `tsc -b` sin errores (no deben quedar referencias a `QuotePanel`, `tab`, `setTab`, ni props `cartLines`/`totals`/`onQuoteCreated` de cotización).

- [ ] **Step 5: Verificación manual**

Run: `pnpm dev`.
- Como **cajero sin caja abierta**: entrar a **Cotizaciones** (nuevo ítem del sidebar), buscar productos, agregarlos, elegir cliente/validez y **Generar cotización** (funciona sin caja).
- La cotización aparece en la lista; **Imprimir** funciona.
- **Convertir sin caja**: avisa que se debe abrir la caja. Con caja abierta: convierte y genera la venta.
- En **Venta** ya no aparece la pestaña "Cotizaciones"; el carrito y el catálogo se ven siempre.

Expected: cotizar no requiere caja; convertir sí; venta limpia sin la pestaña.

- [ ] **Step 6: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "refactor(venta): quitar pestana de cotizaciones (ahora modulo aparte) y eliminar QuotePanel"
```

---

## Self-review (cobertura del spec)

- Cotizar sin caja → `CotizacionesScreen` sin gate de caja (Task 1) + ruta para todos los roles (Task 2).
- Armador propio (buscador + lista) → Task 1 (no depende del carrito de venta).
- Conversión a venta desde el módulo, exige caja → `tryConvert`/`handleConfirmConvert` con `useOpenSession` (Task 1).
- Sacar cotizaciones de `VentaScreen` → Task 3.
- Cajero y admin → entrada en `BASE` de `nav.ts` (Task 2).
