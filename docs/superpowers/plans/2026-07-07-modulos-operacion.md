# Módulos de operación (③a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar los módulos de operación del POS (Inicio, Stock, Venta+cotizaciones+NC, Cierre, Clientes) clonando el prototipo y cableándolos a datos reales de Supabase, dejando el local capaz de vender de punta a punta.

**Architecture:** Cada módulo reemplaza su placeholder de ②: la UI se **clona** del prototipo (`prototype/index.html`, fiel, con Satoshi/branding) y se **cablea** con hooks TanStack Query (lecturas), las RPC de ① (operaciones críticas) y `invoke` a las funciones Rust de impresión ya existentes. El estado de sucursal/caja sale del `WorkContext` de ②. La lógica pura (cálculos de carrito/IVA, mapeos, derivación de stats) vive en módulos testeables.

**Tech Stack:** React 18 + TS, Vite, TanStack Query 5, supabase-js, Tailwind v4 + shadcn (base), @tauri-apps/api (`invoke`), Vitest.

## Global Constraints

- Prosa/UI en español; identificadores/código en inglés.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; PROHIBIDO `Co-Authored-By`/atribución a Claude.
- `git add` de archivos específicos por tarea; nunca `git add -A`. NO tocar `src-tauri/src/printing.rs` ni `tauri.conf.json`.
- **Fidelidad: idéntico al prototipo** (`prototype/index.html`). Clonar markup/estilos; color de marca vía `var(--brand)` (NO `var(--accent)`).
- Montos CLP enteros; IVA incluido: `neto = round(total/1.19)`, `iva = total - neto`.
- Operaciones críticas SOLO por RPC de ①: `cobrar_venta`, `abrir_caja`, `cerrar_caja`, `emitir_nota_credito`, `convertir_cotizacion`. Nunca insertar `sale`/`cash_session` directo desde el cliente (RLS lo impide).
- Impresión SOLO vía `invoke` a las funciones Rust existentes (`print_receipt`, `print_quote`, `print_cierre`, `print_credit_note`).
- La venta se confirma en la BD ANTES de imprimir (si la impresión falla, la venta ya quedó registrada).
- Flujo de caja: sin gate global; Inicio = dashboard; solo Venta exige caja abierta.
- Cada `pnpm typecheck && pnpm test && pnpm build` debe quedar verde por tarea. Verificación en vivo con `pnpm tauri dev` la hace el controller/usuario (no el implementer).

## File Structure

- `src/lib/money.ts` — `computeTotals(lines)`, `iva`/`neto` helpers, `fmtCLP` (lógica pura, testeable).
- `src/lib/print.ts` — wrappers de `invoke`: `printReceipt`, `printQuote`, `printCierre`, `printCreditNote` (con fallback no-Tauri).
- `src/data/cash.ts` — hooks de caja/cierre: `useOpenSession` (reusa/mueve el de `work.ts`), `useCierres`, `cerrarCaja`.
- `src/data/sales.ts` — `useSalesToday`, `useRecentSales`, `cobrarVenta`, `emitirNotaCredito`, `convertirCotizacion`, `crearCotizacion`.
- `src/data/stock.ts` — `useProductsWithStock`, `useCategories`, CRUD producto/categoría, `useCriticalStock`, ajuste de inventory.
- `src/data/customers.ts` — `useCustomers`, CRUD cliente.
- `src/modules/inicio/InicioScreen.tsx` — dashboard.
- `src/modules/stock/` — `StockScreen.tsx`, `ProductForm.tsx`, `CategoryManager.tsx`.
- `src/modules/venta/` — `VentaScreen.tsx`, `Cart.tsx`, `PayDialog.tsx`, `QuotePanel.tsx`, `CreditNoteDialog.tsx`.
- `src/modules/cierre/CierreScreen.tsx`.
- `src/modules/clientes/ClientesScreen.tsx`, `CustomerForm.tsx`.
- Modificar: `src/shell/AppLayout.tsx` (quitar `CashGate` del envoltorio global), `src/App.tsx` (rutas → módulos reales), `src/session/WorkContext.tsx` (exponer sesión de caja si hace falta).
- `supabase/migrations/20260707120000_quote_write.sql` — permitir escritura de cotizaciones (Task 5).
- Tests junto al código: `src/lib/money.test.ts`, y tests de mapeo/derivación por módulo.

**Fuente visual:** `prototype/index.html` (login/consola ya no aplican; las pantallas de operación están en los `sc-if` `isInicio`, venta, stock, cierre, clientes). Métodos de referencia en el `<script>`: `totals` (:2537), `addToCart` (:2897), `incCart` (:2914), `confirmPay` (:3026), `createQuote` (:2977), `convertQuote` (:3000), `saveCreditNote` (:2758), `submitScan`/`barcodeOf` (:3091-3095), `saveProduct` (~:3180), `deleteCategory` (:3139), `exportCriticalCsv` (:3194), `onStockFile`/`parseStockFile`/`applyStockParse` (:3209-3254), `doCierre` (:2703), `saveCustomer` (:3292), `buildMetrics` (:3329), `abrirCaja` (:2696). Helpers de formato: `fmt` (:2507), `fmtRut` (:2545).

---

### Task 1: Fundación — cálculos de dinero, impresión, y desbloqueo del gate de caja

**Files:**
- Create: `src/lib/money.ts`, `src/lib/money.test.ts`, `src/lib/print.ts`
- Modify: `src/shell/AppLayout.tsx` (quitar `CashGate` del envoltorio global), `src/session/WorkContext.tsx` (exponer helper de caja si falta)

**Interfaces:**
- Produces:
  - `computeTotals(lines: {qty:number; price:number}[]): { total:number; neto:number; iva:number; items:number }`
  - `fmtCLP(n:number): string` (formato `$` es-CL, como `fmt` del prototipo)
  - `printReceipt(payload:unknown):Promise<void>`, `printQuote`, `printCierre`, `printCreditNote` (en `print.ts`; usan `@tauri-apps/api/core` `invoke`, y en entorno no-Tauri hacen `console.warn` + no-op para no romper el dev web)
- Consumes: `WorkContext`, `AppLayout` de ②.

- [ ] **Step 1: Test de `computeTotals` (TDD)**

`src/lib/money.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeTotals, fmtCLP } from "./money";

describe("computeTotals", () => {
  it("suma total, deriva neto/iva (IVA incluido) e items", () => {
    const r = computeTotals([{ qty: 2, price: 14990 }, { qty: 1, price: 5000 }]);
    expect(r.total).toBe(34980);
    expect(r.neto).toBe(Math.round(34980 / 1.19));
    expect(r.iva).toBe(34980 - Math.round(34980 / 1.19));
    expect(r.items).toBe(3);
  });
  it("carrito vacío = ceros", () => {
    expect(computeTotals([])).toEqual({ total: 0, neto: 0, iva: 0, items: 0 });
  });
});

describe("fmtCLP", () => {
  it("formatea CLP sin decimales con separador de miles", () => {
    expect(fmtCLP(14990)).toBe("$14.990");
  });
});
```
Run: `pnpm test src/lib/money.test.ts` → FALLA (módulo no existe).

- [ ] **Step 2: Implementar `money.ts`**

`src/lib/money.ts`:
```ts
export interface Line { qty: number; price: number; }
export interface Totals { total: number; neto: number; iva: number; items: number; }

export function computeTotals(lines: Line[]): Totals {
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const items = lines.reduce((s, l) => s + l.qty, 0);
  const neto = Math.round(total / 1.19);
  return { total, neto, iva: total - neto, items };
}

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
export function fmtCLP(n: number): string {
  return CLP.format(n).replace(/\s/g, "");
}
```
Run: `pnpm test src/lib/money.test.ts` → PASS. (Si el formato de `Intl` difiere de `$14.990`, ajustar el `.replace`/opciones hasta cumplir el test.)

- [ ] **Step 3: Wrappers de impresión**

`src/lib/print.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke(cmd: string, args: Record<string, unknown>): Promise<void> {
  if (!isTauri) { console.warn(`[print] ${cmd} omitido (no-Tauri)`, args); return; }
  await invoke(cmd, args);
}

export const printReceipt = (payload: unknown) => safeInvoke("print_receipt", { payload });
export const printQuote = (payload: unknown) => safeInvoke("print_quote", { payload });
export const printCierre = (payload: unknown) => safeInvoke("print_cierre", { payload });
export const printCreditNote = (payload: unknown) => safeInvoke("print_credit_note", { payload });
```
> Nota: los nombres de comando y la forma del payload deben coincidir con las firmas reales en `src-tauri/src/printing.rs`/`lib.rs`. El implementer DEBE leer esas firmas (`#[tauri::command]`) y ajustar `cmd`/args para que calcen exactamente. No modificar los archivos Rust.

- [ ] **Step 4: Quitar el gate de caja global**

En `src/shell/AppLayout.tsx`, el contenido hoy es `<BranchGate businessId={...}><CashGate><Outlet/></CashGate></BranchGate>`. Cambiarlo a `<BranchGate businessId={...}><Outlet/></BranchGate>` (quitar `CashGate` del envoltorio; el requisito de caja pasa a la pantalla de Venta). No borrar `CashGate.tsx` (se reutiliza su UI de abrir-caja en Inicio/Venta). Verificar que `useWork()` sigue exponiendo `branch`/`register` y que la sesión de caja se puede consultar con `useOpenSession(register?.id)` (de `work.ts`).

- [ ] **Step 5: Verificar y commit**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: sin errores; tests verdes.
```bash
git add src/lib/money.ts src/lib/money.test.ts src/lib/print.ts src/shell/AppLayout.tsx src/session/WorkContext.tsx
git commit -m "feat(ops): cálculos de dinero, wrappers de impresión y desbloqueo del gate de caja" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 2: Inicio (dashboard)

**Files:**
- Create: `src/data/sales.ts` (parte de stats), `src/modules/inicio/InicioScreen.tsx`
- Modify: `src/App.tsx` (ruta index → `InicioScreen`), `src/routes/placeholders.tsx` (quitar el de Inicio)

**Interfaces:**
- Consumes: `useWork`, `useOpenSession`, `useAuth`, `fmtCLP`, `computeTotals`, RPC `abrir_caja` (de `work.ts` `rpcAbrirCaja`).
- Produces (en `src/data/sales.ts`): `useSalesToday(branchId): { total, count, avg }`; `useRecentSales(branchId, limit): Sale[]`; `useCriticalStock(branchId): {name, stock, min_stock}[]`.

- [ ] **Step 1: Hooks de stats (test de derivación)**

`src/data/sales.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { summarizeSales } from "./sales";

describe("summarizeSales", () => {
  it("total, conteo y promedio de ventas del día", () => {
    const r = summarizeSales([{ total: 10000 }, { total: 20000 }] as any);
    expect(r).toEqual({ total: 30000, count: 2, avg: 15000 });
  });
  it("sin ventas = ceros y promedio 0", () => {
    expect(summarizeSales([])).toEqual({ total: 0, count: 0, avg: 0 });
  });
});
```
Run: `pnpm test src/data/sales.test.ts` → FALLA.

- [ ] **Step 2: Implementar `sales.ts` (stats)**

`src/data/sales.ts` (parte de stats; el resto de funciones de venta se agregan en Task 4/5):
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SaleRow { id?: string; folio?: number; total: number; method?: string; sold_at?: string; }

export function summarizeSales(rows: { total: number }[]): { total: number; count: number; avg: number } {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.length;
  return { total, count, avg: count ? Math.round(total / count) : 0 };
}

/** Ventas de HOY de la sucursal (rango del día local). */
export function useSalesToday(branchId: string | undefined) {
  return useQuery({
    queryKey: ["sales-today", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("sale").select("total").eq("branch_id", branchId!).gte("sold_at", start.toISOString());
      if (error) throw error;
      return summarizeSales(data ?? []);
    },
  });
}

export function useRecentSales(branchId: string | undefined, limit = 8) {
  return useQuery({
    queryKey: ["recent-sales", branchId, limit],
    enabled: !!branchId,
    queryFn: async (): Promise<SaleRow[]> => {
      const { data, error } = await supabase
        .from("sale").select("id,folio,total,method,sold_at").eq("branch_id", branchId!)
        .order("sold_at", { ascending: false }).limit(limit);
      if (error) throw error; return data ?? [];
    },
  });
}

export function useCriticalStock(branchId: string | undefined) {
  return useQuery({
    queryKey: ["critical-stock", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      // inventory de la sucursal con stock <= min_stock del producto
      const { data, error } = await supabase
        .from("inventory").select("stock, product:product(name,min_stock)").eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => ({ name: r.product?.name, stock: r.stock, min_stock: r.product?.min_stock ?? 0 }))
        .filter((r: any) => r.min_stock > 0 && r.stock <= r.min_stock);
    },
  });
}
```
Run: `pnpm test src/data/sales.test.ts` → PASS.

- [ ] **Step 3: Clonar `InicioScreen` del prototipo**

Crear `src/modules/inicio/InicioScreen.tsx` clonando la pantalla "Inicio" del prototipo (`prototype/index.html`, `sc-if isInicio`, ~línea 239 en adelante): eyebrow + título, tarjetas de stats (usa `useSalesToday`: total del día, nº de ventas, ticket promedio; y otras stats que el prototipo muestre, derivadas de datos reales — si alguna no tiene fuente real aún, muéstrala en 0 con su etiqueta), CTA de venta (link a `/venta`), actividad reciente (`useRecentSales`), y panel de stock crítico (`useCriticalStock`, solo si `profile.role` es admin/kromi). Estado de caja: si `useOpenSession(register?.id)` no tiene sesión, mostrar el bloque "Abrir caja" (fondo + `rpcAbrirCaja(register.id, fondo)`); si hay sesión, mostrar su estado. Estilos/markup fieles al prototipo, marca vía `var(--brand)`. Formatear montos con `fmtCLP`.

- [ ] **Step 4: Ruta**

En `src/App.tsx`, cambiar `<Route index element={<Placeholder title="Inicio" />} />` por `<Route index element={<InicioScreen />} />` (import desde `@/modules/inicio/InicioScreen`).

- [ ] **Step 5: Verificar y commit**

Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/data/sales.ts src/data/sales.test.ts src/modules/inicio src/App.tsx
git commit -m "feat(ops): Inicio (dashboard con stats reales, actividad, caja, stock crítico)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 3: Stock (productos + inventario, CRUD, categorías, import/export)

**Files:**
- Create: `src/data/stock.ts`, `src/modules/stock/StockScreen.tsx`, `src/modules/stock/ProductForm.tsx`, `src/modules/stock/CategoryManager.tsx`
- Modify: `src/App.tsx` (ruta `/stock`)

**Interfaces:**
- Consumes: `useWork` (branch activa), `useAuth` (rol admin para escritura), `fmtCLP`.
- Produces (en `src/data/stock.ts`): `useProductsWithStock(businessId, branchId)`, `useCategories(businessId)`, `createProduct(input)`, `updateProduct(id, input)`, `softDeleteProduct(id)`, `upsertInventory(productId, branchId, stock)`, `createCategory`, `updateCategory`, `deleteCategory(id)`. Tipo `ProductRow = { id, name, category_id, price, min_stock, critical, img_url, supplier_id, stock }`.

- [ ] **Step 1: Test de mapeo producto+inventory**

`src/data/stock.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapProductsWithStock } from "./stock";

describe("mapProductsWithStock", () => {
  it("une producto con su stock de la sucursal (0 si no hay fila)", () => {
    const products = [{ id: "p1", name: "Monstera", category_id: "c1", price: 14990, min_stock: 2, critical: false, img_url: null, supplier_id: null }];
    const inv = [{ product_id: "p1", stock: 5 }];
    expect(mapProductsWithStock(products as any, inv as any)[0].stock).toBe(5);
    expect(mapProductsWithStock(products as any, [] as any)[0].stock).toBe(0);
  });
});
```
Run: FALLA.

- [ ] **Step 2: Implementar `stock.ts`**

`src/data/stock.ts` — incluir `mapProductsWithStock(products, inventory)` (pura), y los hooks/mutaciones:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ProductRow {
  id: string; name: string; category_id: string | null; price: number;
  min_stock: number; critical: boolean; img_url: string | null; supplier_id: string | null; stock: number;
}

export function mapProductsWithStock(products: Omit<ProductRow, "stock">[], inventory: { product_id: string; stock: number }[]): ProductRow[] {
  const byId = new Map(inventory.map((i) => [i.product_id, i.stock]));
  return products.map((p) => ({ ...p, stock: byId.get(p.id) ?? 0 }));
}

export function useProductsWithStock(businessId?: string, branchId?: string) {
  return useQuery({
    queryKey: ["products-with-stock", businessId, branchId],
    enabled: !!businessId && !!branchId,
    queryFn: async (): Promise<ProductRow[]> => {
      const [{ data: products, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
        supabase.from("product").select("id,name,category_id,price,min_stock,critical,img_url,supplier_id").eq("business_id", businessId!).is("deleted_at", null).order("name"),
        supabase.from("inventory").select("product_id,stock").eq("branch_id", branchId!),
      ]);
      if (e1) throw e1; if (e2) throw e2;
      return mapProductsWithStock(products ?? [], inv ?? []);
    },
  });
}

export function useCategories(businessId?: string) {
  return useQuery({
    queryKey: ["categories", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("category").select("id,key,label,sort").eq("business_id", businessId!).is("deleted_at", null).order("sort");
      if (error) throw error; return data ?? [];
    },
  });
}

export async function createProduct(input: { business_id: string; name: string; category_id: string | null; price: number; min_stock: number; critical: boolean; img_url: string | null; supplier_id: string | null; }) {
  const { data, error } = await supabase.from("product").insert(input).select().single();
  if (error) throw error; return data;
}
export async function updateProduct(id: string, input: Partial<{ name: string; category_id: string | null; price: number; min_stock: number; critical: boolean; img_url: string | null; supplier_id: string | null; }>) {
  const { error } = await supabase.from("product").update(input).eq("id", id); if (error) throw error;
}
export async function softDeleteProduct(id: string) {
  const { error } = await supabase.from("product").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error;
}
export async function upsertInventory(productId: string, branchId: string, stock: number) {
  const { error } = await supabase.from("inventory").upsert({ product_id: productId, branch_id: branchId, stock }, { onConflict: "product_id,branch_id" }); if (error) throw error;
}
export async function createCategory(input: { business_id: string; key: string; label: string; sort?: number }) {
  const { error } = await supabase.from("category").insert(input); if (error) throw error;
}
export async function updateCategory(id: string, input: Partial<{ label: string; sort: number }>) {
  const { error } = await supabase.from("category").update(input).eq("id", id); if (error) throw error;
}
export async function deleteCategory(id: string) {
  const { error } = await supabase.from("category").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error;
}
```
Run test → PASS.

- [ ] **Step 3: Clonar la pantalla Stock + formularios**

Clonar la pantalla de stock del prototipo (tabla/lista de productos con columnas nombre, categoría, precio, stock, mín, crítico; filtro por categoría; búsqueda; marca de crítico cuando `stock <= min_stock`). `ProductForm.tsx`: alta/edición (nombre, categoría, precio, min_stock, crítico, proveedor opcional, imagen opcional) → `createProduct`/`updateProduct` + `upsertInventory` para el stock de la sucursal. `CategoryManager.tsx`: listar/crear/editar/eliminar categorías (bloquear eliminar si tiene productos, como `deleteCategory` :3139 del prototipo). Import/export CSV: exportar críticos (como `exportCriticalCsv` :3194) e importar cantidades por código de barras (como `onStockFile`/`parseStockFile`/`applyStockParse` :3209-3254) aplicando `upsertInventory`. Escritura solo si `profile.role` es admin/kromi (ocultar acciones si cajero). Toasts en error. Estados vacío/carga.

- [ ] **Step 4: Ruta + verificar + commit**

`src/App.tsx`: `/stock` → `<StockScreen/>`.
Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/data/stock.ts src/data/stock.test.ts src/modules/stock src/App.tsx
git commit -m "feat(ops): Stock (productos+inventario por sucursal, CRUD, categorías, CSV)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 4: Venta — catálogo, carrito, cobro e impresión

**Files:**
- Create: `src/modules/venta/VentaScreen.tsx`, `src/modules/venta/Cart.tsx`, `src/modules/venta/PayDialog.tsx`; ampliar `src/data/sales.ts`
- Modify: `src/App.tsx` (ruta `/venta`)

**Interfaces:**
- Consumes: `useProductsWithStock`, `useWork` (branch + sesión de caja), `useOpenSession`, `computeTotals`, `fmtCLP`, `printReceipt`, `useCustomers` (opcional, de Task 7 — si aún no existe, permitir venta sin cliente).
- Produces (en `sales.ts`): `cobrarVenta(args): Promise<Sale>` con
  `args = { p_branch, p_session, p_lines: {product_id, qty}[], p_method: 'efectivo'|'tarjeta', p_recv, p_customer? }`.

- [ ] **Step 1: Wrapper `cobrarVenta` + test de payload de líneas**

En `src/data/sales.ts` agregar:
```ts
import { supabase } from "@/lib/supabase";
export interface CartItem { product_id: string; qty: number; }

export async function cobrarVenta(args: {
  p_branch: string; p_session: string; p_lines: CartItem[];
  p_method: "efectivo" | "tarjeta"; p_recv: number; p_customer?: string | null;
}) {
  const { data, error } = await supabase.rpc("cobrar_venta", {
    p_branch: args.p_branch, p_session: args.p_session, p_lines: args.p_lines,
    p_method: args.p_method, p_recv: args.p_recv, p_customer: args.p_customer ?? null,
  });
  if (error) throw error; return data;
}

/** Convierte el carrito (con qty) a las líneas que espera la RPC. */
export function cartToLines(cart: { id: string; qty: number }[]): CartItem[] {
  return cart.map((c) => ({ product_id: c.id, qty: c.qty }));
}
```
Test `src/data/sales.test.ts` (agregar):
```ts
import { cartToLines } from "./sales";
it("cartToLines mapea id→product_id y conserva qty", () => {
  expect(cartToLines([{ id: "p1", qty: 2 }])).toEqual([{ product_id: "p1", qty: 2 }]);
});
```
Run → FALLA (cartToLines) → implementar (arriba) → PASS.

- [ ] **Step 2: Clonar la pantalla Venta**

Clonar la pantalla de venta del prototipo: catálogo en grilla (usar `useProductsWithStock`; disponibilidad = `stock` de la sucursal; deshabilitar/avisar si 0), buscador + escáner (buscar por nombre; el escáner por código de barras puede diferirse si el prototipo lo deriva por fórmula — replicar `submitScan`/`barcodeOf` :3091 si aplica), carrito (estado local `{id, qty}[]`, `computeTotals` para totales/IVA), selección de cliente opcional. **Gate de caja local**: obtener la sesión con `useOpenSession(register?.id)`; si no hay sesión abierta, en vez del carrito mostrar un CTA "Abrir caja" (reutilizar la UI/lógica de `CashGate`/`rpcAbrirCaja`).

- [ ] **Step 3: `PayDialog` + cobro + impresión**

`PayDialog.tsx`: método (efectivo/tarjeta), efectivo recibido (si efectivo), muestra total y vuelto. Al confirmar: `cobrarVenta({ p_branch: branch.id, p_session: session.id, p_lines: cartToLines(cart), p_method, p_recv, p_customer })`; si OK → limpiar carrito, invalidar queries (`["sales-today"]`, `["recent-sales"]`, `["products-with-stock"]`, `["critical-stock"]`), y `printReceipt(...)` con el payload que espera la firma Rust (leerla). Errores de la RPC (stock insuficiente, caja no abierta, efectivo insuficiente) → `toast.error` con el mensaje. La venta se confirma antes de imprimir; si `printReceipt` falla, avisar sin revertir.

- [ ] **Step 4: Ruta + verificar + commit**

`src/App.tsx`: `/venta` → `<VentaScreen/>`.
Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/data/sales.ts src/data/sales.test.ts src/modules/venta src/App.tsx
git commit -m "feat(ops): Venta (catálogo, carrito, cobro atómico e impresión de boleta)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 5: Cotizaciones y Notas de crédito (extensión de Venta) + RLS de cotización

**Files:**
- Create: `supabase/migrations/20260707120000_quote_write.sql`, `src/modules/venta/QuotePanel.tsx`, `src/modules/venta/CreditNoteDialog.tsx`; ampliar `src/data/sales.ts`
- Modify: `src/modules/venta/VentaScreen.tsx` (entradas a cotización/NC)

**Interfaces:**
- Produces (en `sales.ts`): `crearCotizacion(args)`, `convertirCotizacion(quoteId, session, method, recv)`, `emitirNotaCredito(args)`, `useQuotes(branchId)`.

- [ ] **Step 1: Migración RLS para permitir crear cotizaciones**

En ① las tablas `quote`/`quote_line` quedaron solo-lectura para el cliente. Cotizar no mueve caja ni stock, así que un usuario del negocio puede crearlas directamente (como `customer`).
`supabase/migrations/20260707120000_quote_write.sql`:
```sql
-- Permitir a usuarios del negocio crear/editar cotizaciones (no mueven caja/stock).
-- quote: política de escritura por negocio. quote_line: escritura validada por el quote padre.
create policy quote_write on public.quote for all
  using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

create policy quote_line_write on public.quote_line for all
  using (exists (select 1 from public.quote q where q.id = quote_id and q.business_id = public.current_business_id()))
  with check (exists (select 1 from public.quote q where q.id = quote_id and q.business_id = public.current_business_id()));
```
Aplicar: `pnpm db:reset && pnpm test:db` → los 3 tests siguen OK (esta migración solo agrega políticas; no rompe los invariantes existentes). Verificar además que no choca con las políticas `_read` existentes (Postgres combina policies con OR para el mismo comando; convivencia correcta).

- [ ] **Step 2: Wrappers en `sales.ts`**

Agregar:
```ts
export async function crearCotizacion(args: {
  business_id: string; branch_id: string; customer_id?: string | null;
  valid_until: string; lines: { product_id: string; qty: number; price: number; name: string }[];
}) {
  const total = args.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const neto = Math.round(total / 1.19);
  // folio de cotización: se obtiene con la secuencia del backend al insertar; aquí usamos la RPC de folio si existe,
  // o insertamos y dejamos que la lógica de folio del backend lo asigne. Si no hay RPC de folio para quote en el
  // cliente, el implementer usa siguiente_folio vía rpc. Ver nota.
  const { data: quote, error } = await supabase.from("quote").insert({
    business_id: args.business_id, branch_id: args.branch_id, customer_id: args.customer_id ?? null,
    valid_until: args.valid_until, total, neto, iva: total - neto,
    folio: await nextFolio(args.branch_id, "quote"),
  }).select().single();
  if (error) throw error;
  const { error: e2 } = await supabase.from("quote_line").insert(
    args.lines.map((l) => ({ quote_id: quote.id, product_id: l.product_id, name_snapshot: l.name, price_snapshot: l.price, qty: l.qty }))
  );
  if (e2) throw e2; return quote;
}

async function nextFolio(branchId: string, doc: "quote"): Promise<number> {
  const { data, error } = await supabase.rpc("siguiente_folio", { p_branch: branchId, p_doc: doc });
  if (error) throw error; return data as number;
}

export async function convertirCotizacion(quoteId: string, session: string, method: "efectivo" | "tarjeta", recv: number) {
  const { data, error } = await supabase.rpc("convertir_cotizacion", { p_quote: quoteId, p_session: session, p_method: method, p_recv: recv });
  if (error) throw error; return data;
}

export async function emitirNotaCredito(args: {
  p_branch: string; p_session: string | null; p_sale: string | null;
  p_method: "efectivo" | "tarjeta"; p_reason: string;
  p_lines: { product_id: string; qty: number; restock: boolean }[];
}) {
  const { data, error } = await supabase.rpc("emitir_nota_credito", {
    p_branch: args.p_branch, p_session: args.p_session, p_sale: args.p_sale,
    p_method: args.p_method, p_reason: args.p_reason, p_lines: args.p_lines,
  });
  if (error) throw error; return data;
}
```
> Nota: `siguiente_folio` tiene `execute` para authenticated (grant de ①); confirmar. Si estuviese revocada, crear la cotización vía una RPC dedicada. El implementer verifica con un `select` de prueba.

- [ ] **Step 3: `QuotePanel` y `CreditNoteDialog` (clonar del prototipo)**

`QuotePanel.tsx`: crear cotización desde el carrito (`crearCotizacion`), listar cotizaciones vigentes (`useQuotes`), convertir a venta (`convertirCotizacion` → luego imprimir boleta) e imprimir cotización (`printQuote`), como `createQuote`/`convertQuote` del prototipo. `CreditNoteDialog.tsx`: emitir NC (por boleta o manual), con líneas y `restock`, motivo, método (`emitirNotaCredito`) e impresión (`printCreditNote`), como `saveCreditNote` :2758. Toasts en error. Fidelidad al prototipo.

- [ ] **Step 4: Verificar + commit**

Run: `pnpm db:reset && pnpm test:db` (por la migración) y `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add supabase/migrations/20260707120000_quote_write.sql src/data/sales.ts src/modules/venta/QuotePanel.tsx src/modules/venta/CreditNoteDialog.tsx src/modules/venta/VentaScreen.tsx
git commit -m "feat(ops): cotizaciones y notas de crédito en Venta (+ RLS de escritura de quote)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 6: Cierre (arqueo + cerrar caja + historial)

**Files:**
- Create: `src/data/cash.ts` (ampliar work.ts o nuevo), `src/modules/cierre/CierreScreen.tsx`
- Modify: `src/App.tsx` (ruta `/cierre`)

**Interfaces:**
- Consumes: `useWork`, `useOpenSession`, `printCierre`, `fmtCLP`.
- Produces: `cerrarCaja(sessionId, counted)` (reusa `rpcCerrarCaja` de `work.ts`); `useCierres(branchId)` (sesiones cerradas con sus totales).

- [ ] **Step 1: Hooks de cierre**

En `src/data/cash.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
export { rpcCerrarCaja as cerrarCaja } from "./work";

export function useCierres(branchId?: string) {
  return useQuery({
    queryKey: ["cierres", branchId], enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_session")
        .select("id,opened_at,closed_at,float_amount,counted,status")
        .eq("branch_id", branchId!).eq("status", "closed").order("closed_at", { ascending: false }).limit(30);
      if (error) throw error; return data ?? [];
    },
  });
}
```
(No requiere test unit propio; la lógica de cálculo del cierre vive en la RPC `cerrar_caja` de ①, ya testeada.)

- [ ] **Step 2: Clonar la pantalla Cierre**

`CierreScreen.tsx` clonando el prototipo (`doCierre` :2703): muestra la sesión abierta actual (fondo, ventas efectivo/tarjeta acumuladas —consultables o mostradas tras cerrar—), campo de conteo, botón "Cerrar caja" → `cerrarCaja(session.id, counted)` → muestra el resumen devuelto (efectivo esperado, contado, descuadre) e imprime comprobante (`printCierre`). Historial de cierres con `useCierres`. Si no hay sesión abierta, indicar que no hay caja abierta. Toasts en error.

- [ ] **Step 3: Ruta + verificar + commit**

`src/App.tsx`: `/cierre` → `<CierreScreen/>`.
Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/data/cash.ts src/modules/cierre src/App.tsx
git commit -m "feat(ops): Cierre (arqueo, cerrar caja, historial de cierres)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 7: Clientes (CRUD + fidelización)

**Files:**
- Create: `src/data/customers.ts`, `src/modules/clientes/ClientesScreen.tsx`, `src/modules/clientes/CustomerForm.tsx`
- Modify: `src/App.tsx` (ruta `/clientes`); `src/modules/venta/VentaScreen.tsx` (selector de cliente usa `useCustomers`)

**Interfaces:**
- Produces: `useCustomers(businessId, query?)`, `createCustomer(input)`, `updateCustomer(id, input)`, `softDeleteCustomer(id)`. Tipo `CustomerRow = { id, name, email, phone, points, spent, visits }`.

- [ ] **Step 1: `customers.ts` + test de filtro de búsqueda**

`src/data/customers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { filterCustomers } from "./customers";
describe("filterCustomers", () => {
  it("filtra por nombre/teléfono (case-insensitive)", () => {
    const rows = [{ id: "1", name: "Camila Rojas", phone: "+56 9 5512", email: "", points: 0, spent: 0, visits: 0 }];
    expect(filterCustomers(rows as any, "camila")).toHaveLength(1);
    expect(filterCustomers(rows as any, "5512")).toHaveLength(1);
    expect(filterCustomers(rows as any, "zzz")).toHaveLength(0);
  });
});
```
Run → FALLA.

- [ ] **Step 2: Implementar `customers.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CustomerRow { id: string; name: string; email: string | null; phone: string | null; points: number; spent: number; visits: number; }

export function filterCustomers(rows: CustomerRow[], q: string): CustomerRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((c) => `${c.name} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(s));
}

export function useCustomers(businessId?: string) {
  return useQuery({
    queryKey: ["customers", businessId], enabled: !!businessId,
    queryFn: async (): Promise<CustomerRow[]> => {
      const { data, error } = await supabase.from("customer")
        .select("id,name,email,phone,points,spent,visits").eq("business_id", businessId!).is("deleted_at", null).order("name");
      if (error) throw error; return data ?? [];
    },
  });
}
export async function createCustomer(input: { business_id: string; name: string; email?: string | null; phone?: string | null; created_by?: string | null; }) {
  const { error } = await supabase.from("customer").insert(input); if (error) throw error;
}
export async function updateCustomer(id: string, input: Partial<{ name: string; email: string | null; phone: string | null }>) {
  const { error } = await supabase.from("customer").update(input).eq("id", id); if (error) throw error;
}
export async function softDeleteCustomer(id: string) {
  const { error } = await supabase.from("customer").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error;
}
```
Run → PASS.

- [ ] **Step 3: Clonar pantalla Clientes + form**

`ClientesScreen.tsx` (lista con búsqueda `filterCustomers`, fidelización: puntos/gasto/visitas visibles) + `CustomerForm.tsx` (alta/edición: nombre, email, teléfono → `createCustomer`/`updateCustomer`; `created_by = profile.id`), clonando el prototipo (`saveCustomer` :3292). Conectar el selector de cliente de `VentaScreen` a `useCustomers`. Toasts en error, estados vacíos.

- [ ] **Step 4: Ruta + verificar + commit**

`src/App.tsx`: `/clientes` → `<ClientesScreen/>`.
Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/data/customers.ts src/data/customers.test.ts src/modules/clientes src/App.tsx src/modules/venta/VentaScreen.tsx
git commit -m "feat(ops): Clientes (CRUD, fidelización, búsqueda) + selector en Venta" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

## Verificación integral (controller/usuario, en vivo)

Tras las 7 tareas, con `pnpm tauri dev` y login del admin real:
1. Stock → crear categoría y producto con stock en "Planta con Mati".
2. Inicio → abrir caja (fondo 50000); ver el dashboard.
3. Venta → agregar el producto, cobrar (efectivo) → boleta impresa/registrada; ver stock bajar y stats subir.
4. Clientes → crear cliente; vender con cliente → ver puntos/gasto/visitas subir.
5. Venta → crear cotización, convertirla a venta; emitir una nota de crédito con reposición.
6. Cierre → cerrar caja, ver arqueo/descuadre e historial.

## Notas de handoff a ③b

Historial (ventas/boletas), Proveedores, Personal (+ edge function de alta con service_role), Métricas (pantalla dedicada), Configuración, Respaldo, y el submenú completo de Administración en la barra lateral. Reusan los patrones de `src/data/` y `src/modules/` establecidos aquí.
