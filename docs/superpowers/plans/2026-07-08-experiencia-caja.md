# Experiencia de caja / modos de venta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Enfocar la pantalla de Venta (ocultar el menú lateral con toggle), poner iconos en los botones de la barra, y ofrecer un modo "Lectura" tipo supermercado (lista sin imágenes, escaneo con cantidad-antes-de-marcar) junto al modo Catálogo.

**Architecture:** `AppLayout` colapsa el sidebar en `/venta` con un botón hamburguesa para revelarlo. `VentaScreen` gana un toggle Catálogo/Lectura; el modo Lectura usa el área completa con un input de escaneo enfocado, un control de cantidad y una tabla de ítems, reutilizando el estado del carrito, los totales y el cobro existentes.

**Tech Stack:** React + Vite + TS, lucide-react, Tailwind.

## Global Constraints

- Prosa español; código inglés. pnpm. Build `pnpm build`. Tests `pnpm test`.
- Commits: `Cromilakis <ipcromilakis@gmail.com>`; sin co-author.
- Sin migración (frontend puro). Reutiliza `findByBarcode`, `cart`, `totals`, `handleConfirmPay`.

## Decisiones de diseño (tomadas en modo autónomo)

- Sidebar oculto en `/venta` por defecto; botón hamburguesa (icono `Menu`) flotante arriba-izquierda lo muestra/oculta (toggle local). Fuera de `/venta` el sidebar siempre visible.
- Iconos (lucide): Guardadas → `Bookmark`; Nota de crédito → `Undo2`; Cerrar caja → `Lock`; toggle de modo → `Grid3x3`/`ScanLine`.
- Modo Lectura: oculta catálogo y el panel `Cart` lateral; usa el área completa con (a) barra de escaneo: input de código con **foco automático** + input **Cantidad** (default 1); al escanear/Enter agrega esa cantidad del producto con ese barcode y resetea Cantidad a 1; (b) tabla de ítems sin imágenes (Producto · P.unit · Cantidad ± · Subtotal · quitar); (c) barra inferior fija con Total y botón **Cobrar** grande. Reusa `PayDialog`/`handleConfirmPay`.

---

### Task 1: Ocultar el sidebar en Venta (AppLayout)

**Files:** Modify `src/shell/AppLayout.tsx`

- [ ] **Step 1: Estado y toggle**

- Import `Menu` de lucide-react.
- Añadir estado: `const [sidebarOpen, setSidebarOpen] = useState(false);`
- Calcular `const isVenta = location.pathname === "/venta";`
- El `<aside>` se muestra si `!isVenta || sidebarOpen`. Cuando `isVenta` y no `sidebarOpen`, no renderizar el aside.
- Añadir, cuando `isVenta`, un botón flotante hamburguesa (posición fija arriba-izquierda, z alto) que hace `setSidebarOpen((o) => !o)`.
- Al navegar (cambiar `location.pathname`), cerrar el sidebar: `useEffect(() => setSidebarOpen(false), [location.pathname]);`

Código (reemplazar el `return (<div className="h-full flex">…`):

```tsx
  const isVenta = location.pathname === "/venta";
  // (sidebarOpen y useEffect definidos arriba en el cuerpo del componente)

  return (
    <div className="h-full flex">
      {(!isVenta || sidebarOpen) && (
        <aside className="w-[236px] shrink-0 bg-white border-r border-[#E1E5EE] flex flex-col p-3.5">
          {/* …contenido actual del aside sin cambios… */}
        </aside>
      )}
      {isVenta && (
        <button
          type="button"
          onClick={() => setSidebarOpen((o) => !o)}
          title="Menú"
          className="fixed left-3 top-3 z-[60] flex size-[38px] items-center justify-center rounded-xl border border-[#E1E5EE] bg-white text-[#2A3A2E] shadow-sm"
        >
          <Menu className="size-[18px]" strokeWidth={1.9} />
        </button>
      )}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#F7F8FA]">
        <main className="flex-1 overflow-auto">
          <BranchGate businessId={profile.business_id}>
            <Outlet />
          </BranchGate>
        </main>
      </div>
    </div>
  );
```

(Añadir el `useState` y el `useEffect` cerca del inicio del componente `AppLayout`, tras los hooks existentes.)

- [ ] **Step 2: Build** — `pnpm build`.
- [ ] **Step 3: Commit** — `feat(venta): ocultar menu lateral en Venta con toggle hamburguesa`.

---

### Task 2: Iconos en la barra de Venta

**Files:** Modify `src/modules/venta/VentaScreen.tsx`

- [ ] **Step 1: Importar iconos**

`import { Bookmark, Undo2, Lock } from "lucide-react";`

- [ ] **Step 2: Añadir el icono a cada botón**

- Botón "Guardadas": anteponer `<Bookmark className="size-4" strokeWidth={1.9} />` y envolver el contenido en `inline-flex items-center gap-1.5`.
- Botón "Nota de crédito": `<Undo2 className="size-4" strokeWidth={1.9} />`.
- Botón "Cerrar caja": `<Lock className="size-4" strokeWidth={1.9} />`.

Cada botón pasa a la forma:

```tsx
<button onClick={...} className="inline-flex items-center gap-1.5 rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]">
  <Bookmark className="size-4" strokeWidth={1.9} /> Guardadas{...}
</button>
```

- [ ] **Step 3: Build** — `pnpm build`.
- [ ] **Step 4: Commit** — `feat(venta): iconos en botones de la barra de venta`.

---

### Task 3: Modo Lectura (pistola) tipo supermercado

**Files:** Modify `src/modules/venta/VentaScreen.tsx`

**Interfaces:**
- Consumes: `findByBarcode`, `cart`, `addToCart`, `incCart`, `decCart`, `totals`, `fmtCLP`, `PayDialog`, `handleConfirmPay`.
- Produces: estado `mode: "catalogo" | "lectura"`; helper `addToCartQty(product, qty)`.

- [ ] **Step 1: Estado y helper de cantidad**

En `VentaScreen`:

```tsx
const [mode, setMode] = useState<"catalogo" | "lectura">("catalogo");
const [scanQty, setScanQty] = useState(1);
const scanRef = useRef<HTMLInputElement>(null);
```

(Importar `useRef` de react e iconos `Grid3x3`, `ScanLine` de lucide.)

Helper que agrega N unidades respetando stock:

```tsx
function addToCartQty(p: ProductRow, qty: number) {
  const current = cart.find((c) => c.id === p.id)?.qty ?? 0;
  const next = Math.min(current + qty, p.stock);
  if (next <= 0) { toast.error(`${p.name}: sin stock disponible.`); return; }
  setCart((c) => {
    const i = c.findIndex((x) => x.id === p.id);
    if (i >= 0) { const n = c.slice(); n[i] = { ...n[i], qty: next }; return n; }
    return [...c, { id: p.id, qty: next }];
  });
}

function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  const match = findByBarcode(allProducts, query);
  if (match) { addToCartQty(match, Math.max(1, scanQty)); setQuery(""); setScanQty(1); scanRef.current?.focus(); }
}
```

(Reusar el mismo `query`/`setQuery` del buscador.)

- [ ] **Step 2: Toggle de modo en la barra**

Junto al buscador de la barra de Venta, añadir un toggle:

```tsx
<div className="inline-flex gap-1 rounded-full bg-[#F0F2F7] p-1">
  <button onClick={() => setMode("catalogo")} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold" style={mode === "catalogo" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}>
    <Grid3x3 className="size-4" strokeWidth={1.9} /> Catálogo
  </button>
  <button onClick={() => setMode("lectura")} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold" style={mode === "lectura" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}>
    <ScanLine className="size-4" strokeWidth={1.9} /> Lectura
  </button>
</div>
```

- [ ] **Step 3: Render del modo Lectura**

Cuando `mode === "lectura"`, en lugar del catálogo + Cart lateral, renderizar el área completa. Estructura: barra de escaneo (input cantidad + input barcode con `ref={scanRef}` y `autoFocus`), tabla de ítems (usa `cartLines`), y barra inferior con total + Cobrar. El modo `catalogo` mantiene el layout actual (catálogo + `<Cart>`).

Envolver el contenido: si `mode === "lectura"` renderizar el bloque de lectura (código abajo); si no, el actual. El `<Cart>` lateral solo se renderiza en modo catálogo.

Bloque de lectura (dentro del contenedor principal, ocupando el ancho completo):

```tsx
<div className="flex min-h-0 flex-1 flex-col px-[22px] pb-4 pt-2">
  <div className="mb-3 flex items-center gap-3">
    <div className="flex items-center gap-2 rounded-xl border border-[#E1E5EE] bg-white px-3.5 py-2.5">
      <span className="text-[12.5px] font-bold text-[#7C95A8]">Cantidad</span>
      <input value={scanQty || ""} onChange={(e) => setScanQty(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} inputMode="numeric" className="w-16 border-0 bg-transparent text-center text-lg font-black text-[#0F2A1B] outline-none" />
    </div>
    <div className="flex flex-1 items-center gap-2.5 rounded-xl border-2 border-[var(--brand)] bg-white px-4 py-2.5">
      <ScanLine className="size-5 text-[var(--brand)]" strokeWidth={1.9} />
      <input ref={scanRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleScan} placeholder="Escanea o escribe el código y presiona Enter…" className="min-w-0 flex-1 border-0 bg-transparent text-base text-[#0F2A1B] outline-none" />
    </div>
  </div>

  <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[#E1E5EE] bg-white">
    <table className="w-full border-collapse text-[15px]">
      <thead>
        <tr className="bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">
          <th className="px-4 py-3">Producto</th>
          <th className="px-4 py-3 text-right">P. unit</th>
          <th className="px-4 py-3 text-center">Cantidad</th>
          <th className="px-4 py-3 text-right">Subtotal</th>
          <th className="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        {cartLines.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-12 text-center text-[14px] text-[#9aa8bd]">Escanea productos para agregarlos a la venta.</td></tr>
        )}
        {cartLines.map(({ product, qty }) => (
          <tr key={product.id} className="border-t border-[#EEF1F6]">
            <td className="px-4 py-3 font-bold text-[#0F2A1B]">{product.name}</td>
            <td className="px-4 py-3 text-right text-[#7C95A8]">{fmtCLP(product.price)}</td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => decCart(product.id)} className="flex size-7 items-center justify-center rounded-lg border border-[#E1E5EE] bg-white text-[#7C95A8]">–</button>
                <span className="min-w-6 text-center font-black text-[#0F2A1B]">{qty}</span>
                <button onClick={() => incCart(product.id)} disabled={qty >= product.stock} className="flex size-7 items-center justify-center rounded-lg bg-[#D3F4E0] disabled:opacity-40" style={{ color: "var(--brand)" }}>+</button>
              </div>
            </td>
            <td className="px-4 py-3 text-right font-black text-[#0F2A1B]">{fmtCLP(product.price * qty)}</td>
            <td className="px-4 py-3 text-right"><button onClick={() => decCartAll(product.id)} title="Quitar" className="text-[#D02E2E]">🗑</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  <div className="mt-3 flex items-center justify-between rounded-2xl border border-[#E1E5EE] bg-white px-5 py-4">
    <div className="flex items-baseline gap-2">
      <span className="text-[15px] font-bold text-[#7C95A8]">Total</span>
      <span className="text-[32px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
    </div>
    <button onClick={() => setPayOpen(true)} disabled={cartLines.length === 0} className="rounded-[14px] px-8 py-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-[#EEF1F6] disabled:text-[#9aa8bd]" style={cartLines.length > 0 ? { background: "var(--brand)" } : undefined}>
      Cobrar
    </button>
  </div>
</div>
```

Añadir el helper `decCartAll` (quitar toda la línea):

```tsx
function decCartAll(id: string) { setCart((c) => c.filter((x) => x.id !== id)); }
```

- [ ] **Step 4: Build y tests** — `pnpm build && pnpm test`.

- [ ] **Step 5: Verificación manual**

`pnpm dev` → Venta: el menú lateral está oculto (botón hamburguesa lo muestra). Toggle Catálogo/Lectura. En Lectura: escribir/escanear un código con cantidad 30 agrega 30 unidades; la tabla se ve sin imágenes; Cobrar funciona. Iconos visibles en los botones.

- [ ] **Step 6: Commit** — `feat(venta): modo lectura (pistola) con cantidad-antes-de-marcar`.

---

## Self-review

- Ocultar sidebar en Venta → Task 1. Iconos → Task 2. Modo lectura con cantidad → Task 3.
- Reusa carrito/totales/cobro existentes; sin migración.
