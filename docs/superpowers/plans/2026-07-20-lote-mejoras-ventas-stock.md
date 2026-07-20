# Lote de mejoras venta/inicio/stock — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7 mejoras: reubicar controles del carrito, métricas de Inicio por método de pago, indicador de stock crítico, export CSV con diálogo nativo + inventario completo, normalización de selects, y subsistema de histórico de precios por proveedor con gráfico.

**Architecture:** Cambios de UI en módulos existentes (venta, inicio, stock) + extensión de hooks de datos + una migración (drop `product.supplier_id`) + nueva dependencia `recharts` para el gráfico de precios. Cada tarea es independiente y testeable por separado.

**Tech Stack:** React + Vite + TS, Tailwind + inline styles, Supabase/Postgres, Tauri (dialog/fs para guardar archivos), recharts, Vitest.

## Global Constraints

- Prosa/comentarios en español; identificadores en inglés.
- Estilos: seguir el patrón existente (Tailwind en venta/inicio, `inputStyle` inline en `ProductForm`). Color de marca `var(--brand)`.
- CSV: mantener BOM `﻿` y separador `,` con `\r\n` (formato actual de `downloadCsv`).
- Guardado de archivos en Tauri usa `@tauri-apps/plugin-dialog` `save` + `invoke("save_file", { path, contents })` (patrón de `src/lib/fileSave.ts`).
- `product.supplier_id` es un atributo muerto (solo lo usa el form/tipo/tests); se elimina.
- Gestor de paquetes: **pnpm**.

---

### Task 1: Inicio — métricas por método de pago

**Files:**
- Modify: `src/data/sales.ts` (`summarizeSales`, `useSalesToday`)
- Modify: `src/modules/inicio/InicioScreen.tsx` (tarjetas)
- Test: `src/data/sales.test.ts` (o crear si no existe aserción de summarize)

**Interfaces:**
- Produces: `summarizeSales(rows: { total: number; method?: string }[]): { total; count; avg; card; cash }`.

- [ ] **Step 1: Escribir el test de `summarizeSales` (card/cash)**

En `src/data/sales.test.ts` (crear el archivo si no existe) agregar:

```ts
import { describe, it, expect } from "vitest";
import { summarizeSales } from "./sales";

describe("summarizeSales", () => {
  it("suma total, promedio y desglosa por método", () => {
    const rows = [
      { total: 1000, method: "efectivo" },
      { total: 3000, method: "tarjeta" },
      { total: 2000, method: "efectivo" },
    ];
    const s = summarizeSales(rows);
    expect(s.total).toBe(6000);
    expect(s.count).toBe(3);
    expect(s.avg).toBe(2000);
    expect(s.cash).toBe(3000);
    expect(s.card).toBe(3000);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `pnpm test -- sales.test`
Expected: FAIL (`summarizeSales` no devuelve `cash`/`card`).

- [ ] **Step 3: Extender `summarizeSales` y `useSalesToday`**

En `src/data/sales.ts`, reemplazar `summarizeSales` por:

```ts
export function summarizeSales(rows: { total: number; method?: string }[]): { total: number; count: number; avg: number; card: number; cash: number } {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.length;
  const card = rows.filter((r) => r.method === "tarjeta").reduce((s, r) => s + r.total, 0);
  const cash = rows.filter((r) => r.method === "efectivo").reduce((s, r) => s + r.total, 0);
  return { total, count, avg: count ? Math.round(total / count) : 0, card, cash };
}
```

En `useSalesToday`, cambiar el `select` de `"total"` a `"total,method"`:

```ts
        .from("sale").select("total,method").eq("branch_id", branchId!).gte("sold_at", start.toISOString());
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `pnpm test -- sales.test`
Expected: PASS.

- [ ] **Step 5: Reemplazar las tarjetas de Inicio**

En `src/modules/inicio/InicioScreen.tsx`, tras `const avg = stats?.avg ?? 0;` agregar:

```tsx
  const card = stats?.card ?? 0;
  const cash = stats?.cash ?? 0;
```

Reemplazar el bloque `{/* tarjetas de stats */}` (la grilla `grid-cols-4` con las 4 tarjetas "Ventas de hoy"/"Total vendido"/"Ticket promedio"/"Nuevos clientes") por:

```tsx
        {/* tarjetas de stats */}
        <div className="mb-[18px] grid grid-cols-4 gap-4">
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Total vendido</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(total)}</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">IVA incluido</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Ticket promedio</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(avg)}</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">por venta</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Total tarjeta</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(card)}</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">pagos con tarjeta</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Total efectivo</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(cash)}</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">pagos en efectivo</div>
          </div>
        </div>
```

Si `count` queda sin uso tras esto y TypeScript lo marca, eliminar la línea `const count = stats?.count ?? 0;`.

- [ ] **Step 6: Verificar y commit**

Run: `pnpm typecheck && pnpm test -- sales.test`
Expected: sin errores; test verde.

```bash
git add src/data/sales.ts src/data/sales.test.ts src/modules/inicio/InicioScreen.tsx
git commit -m "feat(inicio): pilas Total tarjeta/efectivo; summarizeSales desglosa por método

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Stock crítico — indicar el flag `critical`

**Files:**
- Modify: `src/data/sales.ts` (`CriticalStockRow`, `useCriticalStock`)
- Modify: `src/modules/inicio/InicioScreen.tsx` (tarjeta stock bajo)
- Modify: `src/modules/stock/StockScreen.tsx` (listado)

**Interfaces:**
- Produces: `CriticalStockRow` con `critical: boolean`.

- [ ] **Step 1: Exponer `critical` en `useCriticalStock`**

En `src/data/sales.ts`, cambiar la interfaz y el hook:

```ts
export interface CriticalStockRow { name: string; stock: number; min_stock: number; critical: boolean; }
```

En el `select` del hook: `"stock, product:product_id(name,min_stock,critical)"`; y en el `.map`:

```ts
        .map((r: any) => ({ name: r.product?.name, stock: r.stock, min_stock: r.product?.min_stock ?? 0, critical: !!r.product?.critical }))
```

- [ ] **Step 2: Badge de crítico en la tarjeta de Inicio**

En `src/modules/inicio/InicioScreen.tsx`, dentro del `.map` de `critical` (la fila con `{r.name}`), agregar un badge cuando `r.critical`. Reemplazar el `<div className="min-w-0 flex-1">...` de esa fila por:

```tsx
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[14px] font-bold text-[#0F2A1B]">{r.name}</span>
                          {r.critical && (
                            <span className="shrink-0 rounded-full bg-[#FBF1E0] px-1.5 py-0.5 text-[10px] font-black text-[#9A6F12]">★ Crítico</span>
                          )}
                        </div>
                      </div>
```

- [ ] **Step 3: Badge de crítico en el banner/listado de StockScreen**

En `src/modules/stock/StockScreen.tsx`, ubicar el listado del banner de stock bajo (`lowStockList.map`, donde muestra nombre + `stock/min`). Junto al nombre del producto, si `p.critical`, agregar el mismo badge:

```tsx
{p.critical && <span className="ml-1.5 rounded-full bg-[#FBF1E0] px-1.5 py-0.5 text-[10px] font-black text-[#9A6F12]">★ Crítico</span>}
```

(El badge `★ Crítico` de la tabla/bloques ya existe por producto; esta tarea agrega la marca donde el listado de stock bajo hoy no la muestra. No cambiar la lógica de `isLowStock`.)

- [ ] **Step 4: Verificar y commit**

Run: `pnpm typecheck`
Expected: sin errores.

```bash
git add src/data/sales.ts src/modules/inicio/InicioScreen.tsx src/modules/stock/StockScreen.tsx
git commit -m "feat(stock): marcar productos críticos con ★ en listados de stock bajo (Inicio + Stock)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Export CSV con diálogo nativo + inventario completo

**Files:**
- Modify: `src/lib/fileSave.ts` (nueva `saveTextAs`)
- Modify: `src/modules/stock/StockScreen.tsx` (`downloadCsv` delega; nuevo export completo + botón)

**Interfaces:**
- Consumes: patrón de `saveUrlAs`.
- Produces: `saveTextAs(text: string, suggestedName: string, mimeType?: string): Promise<boolean>`.

- [ ] **Step 1: Agregar `saveTextAs` a `fileSave.ts`**

Al final de `src/lib/fileSave.ts`:

```ts
/** Guarda texto (p.ej. CSV) reusando el flujo de `saveUrlAs`: diálogo nativo "Guardar como"
 *  en Tauri, descarga por <a> en el navegador. No muestra mensajes: el guardado se confirma
 *  con el propio diálogo. */
export async function saveTextAs(text: string, suggestedName: string, mimeType = "text/csv;charset=utf-8;"): Promise<boolean> {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    return await saveUrlAs(url, suggestedName);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 2: `downloadCsv` delega en `saveTextAs`**

En `src/modules/stock/StockScreen.tsx`, agregar el import: `import { saveTextAs } from "@/lib/fileSave";`

Reemplazar el cuerpo de `downloadCsv` por (arma el mismo texto con BOM y delega; ya no crea `<a>`):

```ts
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(","));
  const text = "﻿" + [header.join(",")].concat(body).join("\r\n");
  void saveTextAs(text, filename);
}
```

- [ ] **Step 3: Export del inventario completo + botón**

En `StockScreen.tsx`, agregar la función (junto a `exportCriticalCsv`):

```ts
  function exportStockCsv() {
    const list = products ?? [];
    if (!list.length) return;
    const header = ["nombre", "cantidad", "precio"];
    const rows = list.map((p) => [p.name, p.stock, p.price]);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    downloadCsv(`stock-${stamp}.csv`, header, rows);
  }
```

En el header de acciones (dentro del `canManage ? (<div className="flex gap-2.5">...`), agregar antes del botón "+ Agregar producto":

```tsx
            <button
              onClick={exportStockCsv}
              title="Exportar todo el inventario a CSV (nombre, cantidad, precio)"
              className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
            >
              Exportar stock (CSV)
            </button>
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm typecheck`
Expected: sin errores.

```bash
git add src/lib/fileSave.ts src/modules/stock/StockScreen.tsx
git commit -m "feat(stock): CSV con diálogo nativo (Tauri) + export de inventario completo (nombre/cantidad/precio)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Normalizar `<select>` con los inputs

**Files:**
- Modify: `src/modules/stock/ProductForm.tsx` (nuevo `selectStyle`, aplicar a los `<select>`)
- Modify: `src/modules/venta/PayDialog.tsx` (select de descuento — clase Tailwind)

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Definir `selectStyle` en `ProductForm.tsx`**

En `src/modules/stock/ProductForm.tsx`, tras la definición de `inputStyle`, agregar:

```ts
// Select normalizado para igualar el alto/relleno de inputStyle: sin apariencia nativa,
// alto explícito y flecha custom (SVG data-URI) alineada a la derecha.
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  height: 44,
  paddingRight: 38,
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' fill='none' stroke='%23556A7C' stroke-width='1.6' stroke-linecap='round'/></svg>\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
};
```

(`height: 44` iguala el alto efectivo del input con `padding: 11px 14px` + `border 1px` + `fontSize 14`; ajustar solo si visualmente no coincide.)

- [ ] **Step 2: Aplicar `selectStyle` a los `<select>` de ProductForm**

Cambiar `style={inputStyle}` por `style={selectStyle}` en los `<select>` del formulario (categoría y — hasta la Task 6 — proveedor). Buscar cada `<select style={inputStyle}` y reemplazar por `<select style={selectStyle}`.

- [ ] **Step 3: Normalizar el select de descuento en PayDialog**

En `src/modules/venta/PayDialog.tsx`, el `<select>` de descuento usa clases Tailwind. Ubicar su `className` (contiene `rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 ...`) y agregar `appearance-none` y una altura consistente con los inputs del diálogo. Cambiar el `className` del select agregando `appearance-none h-[42px]` (mantener el resto de clases):

```tsx
                className="h-[42px] w-full appearance-none rounded-xl border border-[#E1E5EE] bg-white px-3 text-[13px] font-bold text-[#2A3A2E] outline-none disabled:opacity-50"
```

(Se quita `py-2.5` porque `h-[42px]` fija el alto; el resto igual.)

- [ ] **Step 4: Verificar y commit**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; tests verdes.

```bash
git add src/modules/stock/ProductForm.tsx src/modules/venta/PayDialog.tsx
git commit -m "style(forms): normalizar selects nativos para igualar el diseño de los inputs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Carrito — reubicar cliente y carritos guardados

**Files:**
- Modify: `src/modules/venta/Cart.tsx` (props nuevas + header + línea de cliente)
- Modify: `src/modules/venta/VentaScreen.tsx` (quitar botones del header; pasar props a `<Cart>`)

**Interfaces:**
- Produces: `CartProps` extendido con `customerName: string | null`, `heldCount: number`, `onOpenHeld: () => void`, `onPickCustomer: () => void`, `onRemoveCustomer: () => void`.

- [ ] **Step 1: Extender `CartProps` y el header de `Cart.tsx`**

En `src/modules/venta/Cart.tsx`, extender la interfaz:

```ts
interface CartProps {
  lines: CartLine[];
  totals: Totals;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onClear: () => void;
  onHold: () => void;
  onPay: () => void;
  customerName: string | null;
  heldCount: number;
  onOpenHeld: () => void;
  onPickCustomer: () => void;
  onRemoveCustomer: () => void;
}
```

Cambiar la firma de la función a:

```ts
export function Cart({ lines, totals, onInc, onDec, onClear, onHold, onPay, customerName, heldCount, onOpenHeld, onPickCustomer, onRemoveCustomer }: CartProps) {
```

En el header (el `<div>` con los íconos 💾/🧹), agregar entre 💾 y 🧹 un ícono de "abrir guardadas". Reemplazar el `<div className="flex items-center gap-1.5">` de los botones por:

```tsx
          <div className="flex items-center gap-1.5">
            <button
              onClick={onHold}
              disabled={!hasCart}
              title="Guardar venta para retomarla después"
              className="flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e] disabled:opacity-40"
            >
              💾
            </button>
            <button
              onClick={onOpenHeld}
              title="Abrir ventas guardadas"
              className="relative flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e]"
            >
              📂
              {heldCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-black text-white">{heldCount}</span>
              )}
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              disabled={!hasCart}
              title="Vaciar carrito"
              className="flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e] disabled:opacity-40"
            >
              🧹
            </button>
          </div>
```

- [ ] **Step 2: Línea de cliente actual en `Cart.tsx`**

Justo después del `</div>` que cierra el header (el `<div className="border-b border-[#E1E5EE] p-5 pb-3">`), antes del `<div className="min-h-0 flex-1 overflow-auto ...">` del listado, agregar:

```tsx
      <div className="flex items-center justify-between gap-2 border-b border-[#E1E5EE] px-5 py-2.5">
        {customerName ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#0F2A1B]">{customerName}</span>
            <button onClick={onRemoveCustomer} title="Quitar cliente" className="shrink-0 text-[#556A7C]">×</button>
          </>
        ) : (
          <button onClick={onPickCustomer} className="text-[13px] font-bold" style={{ color: "var(--brand)" }}>
            Cliente no registrado
          </button>
        )}
      </div>
```

- [ ] **Step 3: Quitar los botones del header de `VentaScreen` y pasar props a `<Cart>`**

En `src/modules/venta/VentaScreen.tsx`, eliminar del header de acciones el bloque del cliente (`<div className="flex items-center gap-1.5">` con el botón `setPickerOpen` y el "×") y el botón "Guardadas" (`<button onClick={() => setHeldOpen(true)} ...>`). Dejar los botones "Boletas del día" y "Cerrar caja".

Cambiar el render de `<Cart .../>` (línea ~781) por:

```tsx
        <Cart
          lines={cartLines}
          totals={totals}
          onInc={incCart}
          onDec={decCart}
          onClear={clearCart}
          onHold={handleHold}
          onPay={() => setPayOpen(true)}
          customerName={selectedCustomer?.name ?? null}
          heldCount={heldSales?.length ?? 0}
          onOpenHeld={() => setHeldOpen(true)}
          onPickCustomer={() => setPickerOpen(true)}
          onRemoveCustomer={() => setCustomerId(null)}
        />
```

Si tras quitar los botones queda algún import sin usar (p. ej. `Bookmark`), eliminarlo si TypeScript lo marca.

- [ ] **Step 4: Verificar y commit**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; tests verdes.

```bash
git add src/modules/venta/Cart.tsx src/modules/venta/VentaScreen.tsx
git commit -m "feat(venta): mover cliente y carritos guardados al panel del carrito

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Quitar `supplier_id` del producto

**Files:**
- Create: `supabase/migrations/20260720120000_product_drop_supplier.sql`
- Modify: `src/data/stock.ts` (`ProductRow`, `select` de `useProducts`/`useProductsWithStock`, inputs de `createProduct`/`updateProduct`)
- Modify: `src/modules/stock/ProductForm.tsx` (quitar estado/select de proveedor)
- Modify: `src/data/stock.test.ts` (fixtures sin `supplier_id`)

**Interfaces:**
- Produces: `ProductRow` sin `supplier_id`; `createProduct`/`updateProduct` sin `supplier_id`.

- [ ] **Step 1: Migración drop column**

Crear `supabase/migrations/20260720120000_product_drop_supplier.sql`:

```sql
-- El proveedor deja de ser un atributo del producto: pasa a ser solo un filtro del
-- histórico de precios (que se deriva de las facturas de compra). La columna estaba
-- muerta (solo la usaba el formulario), así que se elimina.
alter table public.product drop column if exists supplier_id;
```

- [ ] **Step 2: Quitar `supplier_id` de la capa de datos**

En `src/data/stock.ts`:
- Quitar `supplier_id: string | null;` de la interfaz `ProductRow` (y de cualquier otro tipo que lo declare — hay 3 apariciones según grep: líneas ~12, ~115, ~134).
- En el/los `select` que incluyan `supplier_id` (`useProducts`/`useProductsWithStock`), quitar `,supplier_id`.
- En los inputs de `createProduct`/`updateProduct`, quitar la clave `supplier_id`.

- [ ] **Step 3: Quitar el proveedor de `ProductForm.tsx`**

- Eliminar `const [supplierId, setSupplierId] = useState<string>("");`.
- Eliminar `setSupplierId(product.supplier_id ?? "");` del `useEffect` y el correspondiente reset en la rama `else`.
- Eliminar `supplier_id: supplierId || null,` de los objetos de `createProduct` y `updateProduct`.
- Eliminar el `<div>` del `<select>` de "Proveedor (opcional)" (label + select).
- Quitar la prop `suppliers` de `ProductFormProps` y de la firma si ya no se usa en el form; si `StockScreen` la pasaba, quitar ese paso. (El `useSuppliers` de StockScreen puede quedar para la Task 7.)

- [ ] **Step 4: Fixtures de test sin `supplier_id`**

En `src/data/stock.test.ts`, quitar `supplier_id: null` de los tres fixtures que lo declaran (líneas ~6, ~13, ~19 según grep).

- [ ] **Step 5: Verificar y commit**

Run: `pnpm db:reset && pnpm test:schema && pnpm typecheck && pnpm test`
Expected: la migración corre; typecheck sin errores; tests verdes.
(Si `db:reset` falla por Docker apagado, reportar BLOCKED con la remediación — no improvisar.)

```bash
git add supabase/migrations/20260720120000_product_drop_supplier.sql src/data/stock.ts src/modules/stock/ProductForm.tsx src/data/stock.test.ts
git commit -m "refactor(stock): quitar supplier_id del producto (pasa a filtro del histórico)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Histórico de precios por proveedor (recharts)

**Files:**
- Modify: `package.json` / lockfile (agregar `recharts`)
- Modify: `src/data/purchases.ts` (hook `usePriceHistory`)
- Create: `src/modules/stock/PriceHistory.tsx`
- Modify: `src/modules/stock/ProductForm.tsx` (integrar la sección)

**Interfaces:**
- Consumes: `purchase_invoice_line ⋈ purchase_invoice ⋈ supplier`.
- Produces: `usePriceHistory(productId?: string)` → `PricePoint[]`; componente `PriceHistory`.

- [ ] **Step 1: Instalar recharts**

Run: `pnpm add recharts`
Expected: se agrega `recharts` a `dependencies` y al lockfile.

- [ ] **Step 2: Hook `usePriceHistory` en `purchases.ts`**

Agregar en `src/data/purchases.ts`:

```ts
export interface PricePoint {
  issued_at: string;
  unit_cost: number;
  supplier_id: string;
  supplier_name: string;
}

/** Serie de precios de compra (unit_cost) de un producto a lo largo del tiempo, con su
 *  proveedor. Une purchase_invoice_line con su factura (fecha + proveedor). Ordenada por fecha. */
export function usePriceHistory(productId: string | undefined) {
  return useQuery({
    queryKey: ["price-history", productId],
    enabled: !!productId,
    queryFn: async (): Promise<PricePoint[]> => {
      const { data, error } = await supabase
        .from("purchase_invoice_line")
        .select("unit_cost, invoice:invoice_id(issued_at, supplier_id, supplier:supplier_id(razon_social))")
        .eq("product_id", productId!);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => ({
          issued_at: r.invoice?.issued_at,
          unit_cost: r.unit_cost,
          supplier_id: r.invoice?.supplier_id ?? "",
          supplier_name: r.invoice?.supplier?.razon_social ?? "—",
        }))
        .filter((p: PricePoint) => !!p.issued_at)
        .sort((a: PricePoint, b: PricePoint) => a.issued_at.localeCompare(b.issued_at));
    },
  });
}
```

(Verificar que `supabase` esté importado en `purchases.ts`; ya lo está para los otros hooks.)

- [ ] **Step 3: Componente `PriceHistory.tsx`**

Crear `src/modules/stock/PriceHistory.tsx`:

```tsx
import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { usePriceHistory } from "@/data/purchases";
import { fmtCLP } from "@/lib/money";

/** Histórico de precios de compra de un producto. Permite filtrar por proveedor y grafica
 *  unit_cost vs fecha en un gráfico de línea. Requiere un producto ya existente con compras. */
export function PriceHistory({ productId }: { productId: string | null }) {
  const { data: points, isLoading } = usePriceHistory(productId ?? undefined);
  const [supplierId, setSupplierId] = useState<string>("");

  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    (points ?? []).forEach((p) => map.set(p.supplier_id, p.supplier_name));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [points]);

  const series = useMemo(() => {
    const filtered = (points ?? []).filter((p) => !supplierId || p.supplier_id === supplierId);
    return filtered.map((p) => ({ fecha: p.issued_at, precio: p.unit_cost }));
  }, [points, supplierId]);

  if (!productId) {
    return <div className="text-[13px] text-[#556A7C]">El histórico de precios aparece tras registrar compras de este producto.</div>;
  }
  if (isLoading) return <div className="text-[13px] text-[#556A7C]">Cargando histórico…</div>;
  if (!points || points.length === 0) {
    return <div className="text-[13px] text-[#556A7C]">Aún no hay compras registradas para este producto.</div>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-[11px] font-semibold text-[#556A7C]">Proveedor</label>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="h-9 appearance-none rounded-xl border border-[#E1E5EE] bg-white px-3 text-[13px] font-bold text-[#2A3A2E] outline-none"
        >
          <option value="">Todos</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="#F0F2F7" vertical={false} />
            <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: "#556A7C" }} />
            <YAxis tickFormatter={(v) => fmtCLP(v)} tick={{ fontSize: 11, fill: "#556A7C" }} width={70} />
            <Tooltip formatter={(v: number) => fmtCLP(v)} labelStyle={{ color: "#0F2A1B" }} />
            <Line type="monotone" dataKey="precio" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Integrar en `ProductForm.tsx`**

Agregar el import: `import { PriceHistory } from "./PriceHistory";`

En la columna derecha del formulario (donde estaban los flags/imagen), agregar al final una sección:

```tsx
            <div>
              <label style={labelStyle}>Histórico de precios</label>
              <PriceHistory productId={product?.id ?? null} />
            </div>
```

(`product` es la prop del `ProductForm`; en alta nueva es `null` y el componente muestra el mensaje de "sin compras".)

- [ ] **Step 5: Verificar y commit**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; tests verdes.

```bash
git add package.json pnpm-lock.yaml src/data/purchases.ts src/modules/stock/PriceHistory.tsx src/modules/stock/ProductForm.tsx
git commit -m "feat(stock): histórico de precios por proveedor con gráfico de línea (recharts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Verificación end-to-end

**Files:** ninguno (verificación manual).

- [ ] **Step 1:** `pnpm tauri dev`.
- [ ] **Step 2 (Inicio):** 4 pilas = Total vendido, Ticket promedio, Total tarjeta, Total efectivo, con montos coherentes con las ventas del día.
- [ ] **Step 3 (Stock crítico):** un producto con flag crítico y bajo mínimo muestra el ★ Crítico tanto en Inicio como en el listado de stock.
- [ ] **Step 4 (CSV):** "Exportar stock (CSV)" abre el diálogo nativo para elegir carpeta; el archivo tiene columnas nombre/cantidad/precio. El export de críticos también abre el diálogo.
- [ ] **Step 5 (Selects):** en el alta de producto y en el descuento del cobro, los dropdowns tienen el mismo alto/estilo que los inputs.
- [ ] **Step 6 (Carrito):** el cliente y el botón de carritos guardados están en el panel del carrito; "Cliente no registrado" abre el picker; el ícono de guardadas muestra el conteo.
- [ ] **Step 7 (Histórico):** al editar un producto con compras registradas, la sección de histórico grafica el precio vs fecha y el filtro de proveedor cambia la serie.

---

## Self-Review

- **Spec coverage:** (1) carrito → Task 5; (2) pilas por método → Task 1; (3) crítico → Task 2; (4) CSV diálogo → Task 3; (5) export completo → Task 3; (6) selects → Task 4; (7) proveedor+histórico → Tasks 6 (quitar supplier_id) + 7 (gráfico). Verificación → Task 8.
- **Placeholder scan:** sin TBD/TODO; cada step con código o comando concreto.
- **Type consistency:** `summarizeSales` devuelve `card`/`cash` (Task 1) usados en Inicio; `CriticalStockRow.critical` (Task 2) usado en Inicio/Stock; `PricePoint`/`usePriceHistory` (Task 7) consumidos por `PriceHistory`; `CartProps` extendido (Task 5) coincide con el render en VentaScreen; `supplier_id` removido de forma consistente en tipo/select/inputs/tests/form (Task 6).
