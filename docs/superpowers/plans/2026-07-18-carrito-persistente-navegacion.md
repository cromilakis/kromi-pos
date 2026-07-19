# Carrito de venta persistente al navegar — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el carrito de Venta (ítems + cliente seleccionado) sobreviva la navegación entre menús, sin perderse al ir a Cotizaciones/Stock y volver.

**Architecture:** Se sube el estado "venta en curso" (`cart` + `customerId`) de `VentaScreen` a un React Context (`SaleDraftContext`) montado dentro de `AppLayout`, que persiste entre cambios de ruta y se limpia al hacer logout. `VentaScreen` deja de tener ese estado local y lo consume del contexto.

**Tech Stack:** React + TypeScript, react-router-dom, Vitest (jsdom) + @testing-library/react (ya instalado).

**Nota (desviación del spec, justificada por YAGNI):** el spec mencionaba un helper `resetDraft()`. Se omite: los puntos de limpieza existentes en `VentaScreen` (`setCart([])` + `setCustomerId(null)` tras cobrar/hold) ya funcionan a través del contexto sin cambios, así que `resetDraft` sería código muerto. El contexto expone solo `cart/setCart/customerId/setCustomerId`.

## Global Constraints

- Estado del carrito **en memoria** (no se persiste a disco): sobrevive navegación, se limpia al reiniciar la app o hacer logout.
- Alcance: `cart` (`{ id, qty }[]`) + `customerId` (`string | null`). El resto del estado de UI de `VentaScreen` (query, filtros, modales, mode, scanQty, askedForCustomer) sigue local y transitorio.
- Commit identity = `Cromilakis <ipcromilakis@gmail.com>`; prohibido `Co-Authored-By` y atribución a Claude/Anthropic. Nunca `git add -A` — stage solo los archivos de cada tarea.
- Prosa en español, identificadores en inglés. Marca de color con `var(--brand)` (no aplica aquí, pero no romperla).

---

### Task 1: `SaleDraftContext` (contexto de venta en curso)

**Files:**
- Create: `src/session/SaleDraftContext.tsx`
- Test: `src/session/SaleDraftContext.test.tsx`

**Interfaces:**
- Produces:
  - `export interface CartItem { id: string; qty: number }`
  - `export function SaleDraftProvider({ children }: { children: ReactNode }): JSX.Element`
  - `export function useSaleDraft(): { cart: CartItem[]; setCart: Dispatch<SetStateAction<CartItem[]>>; customerId: string | null; setCustomerId: Dispatch<SetStateAction<string | null>> }`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/session/SaleDraftContext.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaleDraftProvider, useSaleDraft } from "./SaleDraftContext";

function Adder() {
  const { setCart, setCustomerId } = useSaleDraft();
  return (
    <button onClick={() => { setCart([{ id: "p1", qty: 2 }]); setCustomerId("c1"); }}>
      add
    </button>
  );
}
function Viewer() {
  const { cart, customerId } = useSaleDraft();
  return <div>qty:{cart.reduce((s, c) => s + c.qty, 0)} cust:{customerId ?? "none"}</div>;
}

describe("SaleDraftContext", () => {
  it("comparte el carrito y el cliente entre consumidores del mismo provider", () => {
    render(
      <SaleDraftProvider>
        <Adder />
        <Viewer />
      </SaleDraftProvider>,
    );
    expect(screen.getByText("qty:0 cust:none")).toBeTruthy();
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("qty:2 cust:c1")).toBeTruthy();
  });

  it("useSaleDraft fuera del provider lanza error", () => {
    function Bare() { useSaleDraft(); return null; }
    expect(() => render(<Bare />)).toThrow(/SaleDraftProvider/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- SaleDraftContext`
Expected: FAIL — no existe `./SaleDraftContext`.

- [ ] **Step 3: Implementar el contexto**

Crear `src/session/SaleDraftContext.tsx` (mismo patrón que `src/session/WorkContext.tsx`):

```tsx
import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";

/** Ítem del carrito de venta: referencia al producto por id + cantidad.
 *  El precio/nombre se derivan en vivo del catálogo, no se guardan aquí. */
export interface CartItem { id: string; qty: number }

interface SaleDraftCtx {
  cart: CartItem[]; setCart: Dispatch<SetStateAction<CartItem[]>>;
  customerId: string | null; setCustomerId: Dispatch<SetStateAction<string | null>>;
}
const Ctx = createContext<SaleDraftCtx | null>(null);

/** Mantiene la "venta en curso" (carrito + cliente) en memoria, por encima de
 *  las rutas, para que sobreviva la navegación entre menús. Se limpia al
 *  desmontarse (logout) o al reiniciar la app. */
export function SaleDraftProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  return <Ctx.Provider value={{ cart, setCart, customerId, setCustomerId }}>{children}</Ctx.Provider>;
}

export function useSaleDraft() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSaleDraft fuera de SaleDraftProvider");
  return c;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- SaleDraftContext`
Expected: PASS (los 2 casos).

- [ ] **Step 5: Commit**

```bash
git add src/session/SaleDraftContext.tsx src/session/SaleDraftContext.test.tsx
git commit -m "feat(venta): SaleDraftContext para mantener carrito + cliente entre navegaciones"
```

---

### Task 2: Montar el provider y consumirlo desde VentaScreen

**Files:**
- Modify: `src/shell/AppLayout.tsx` (envolver el `<Outlet/>` con `SaleDraftProvider`)
- Modify: `src/modules/venta/VentaScreen.tsx` (consumir el contexto en vez de `useState` local)

**Interfaces:**
- Consumes: `SaleDraftProvider`, `useSaleDraft`, `CartItem` de `@/session/SaleDraftContext` (Task 1).

- [ ] **Step 1: Montar `SaleDraftProvider` en `AppLayout`**

En `src/shell/AppLayout.tsx`:

1. Agregar el import (junto a los otros de `@/session/...`):

```tsx
import { SaleDraftProvider } from "@/session/SaleDraftContext";
```

2. Envolver el bloque `<BranchGate>…<Outlet/>…</BranchGate>` (actualmente líneas ~173-175) con el provider, de modo que quede:

```tsx
        <main className="flex-1 overflow-auto">
          <SaleDraftProvider>
            <BranchGate businessId={profile.business_id}>
              <Outlet />
            </BranchGate>
          </SaleDraftProvider>
        </main>
```

(El provider vive dentro de `AppLayout`, que NO se desmonta al navegar entre rutas → el carrito persiste; al hacer logout `AppLayout` se desmonta → el carrito se limpia.)

- [ ] **Step 2: Consumir el contexto en `VentaScreen`**

En `src/modules/venta/VentaScreen.tsx`:

1. Agregar el import (junto a `useWork`):

```tsx
import { useSaleDraft, type CartItem } from "@/session/SaleDraftContext";
```

2. Eliminar la interfaz local `CartItem` (actualmente líneas ~32-35):

```tsx
interface CartItem {
  id: string;
  qty: number;
}
```

(se borra; ahora viene del contexto).

3. Reemplazar las dos líneas de estado local (actualmente ~91 y ~95):

```tsx
  const [cart, setCart] = useState<CartItem[]>([]);
  ...
  const [customerId, setCustomerId] = useState<string | null>(null);
```

por el consumo del contexto. Poner, donde estaba la línea 91:

```tsx
  const { cart, setCart, customerId, setCustomerId } = useSaleDraft();
```

y **eliminar** la línea 95 (el `useState` de `customerId`). El resto de los `useState` (query, catFilter, payOpen, busy, etc.) se mantienen.

> Todos los usos existentes siguen igual: `setCart((c) => …)`, `setCart([])`, `setCustomerId(null)`, `setCustomerId(h.customer_id)`, `setCart(next)` funcionan sin cambios porque el contexto expone los mismos setters de `useState` (`Dispatch<SetStateAction<…>>`). No se toca `askedForCustomer` ni la lógica de limpieza (post-cobro, hold, `clearCart`) — solo cambia de dónde vienen `cart`/`customerId`.

- [ ] **Step 3: Verificar tipos y tests**

Run: `pnpm build`
Expected: compila sin errores (el `CartItem` importado y el contexto resuelven; `setCart` acepta las actualizaciones funcionales existentes).

Run: `pnpm test`
Expected: PASS (sin regresiones; incluye el test de Task 1).

- [ ] **Step 4: Verificación manejando la app (persistencia real)**

Levantar el frontend y comprobar el comportamiento de punta a punta:

Run: `pnpm dev` (Vite en el navegador) — o `pnpm tauri dev` para la ventana nativa.

Pasos a comprobar (requiere sesión iniciada y caja abierta en la sucursal):
1. En **Venta**, agregar 1-2 productos al carrito y (opcional) seleccionar un cliente.
2. Navegar a **Cotizaciones** (o Stock).
3. Volver a **Venta**.
4. **Esperado:** el carrito y el cliente siguen tal cual estaban.
5. Cobrar una venta → el carrito queda vacío. Hacer logout y volver a entrar → el carrito está vacío.

Si no hay una sesión/caja disponible para manejarlo en vivo, dejar constancia en el reporte de que la verificación de build + test pasó y que la prueba manejada queda pendiente de confirmación del usuario.

- [ ] **Step 5: Commit**

```bash
git add src/shell/AppLayout.tsx src/modules/venta/VentaScreen.tsx
git commit -m "feat(venta): carrito + cliente persisten al navegar (consume SaleDraftContext)"
```

---

## Notas de verificación final

- `pnpm build` sin errores; `pnpm test` verde (incluye `SaleDraftContext.test`).
- Manejo real: carrito + cliente sobreviven navegar a otro módulo y volver; se limpian al cobrar y al hacer logout.
- Sin persistencia a disco (reiniciar la app deja el carrito vacío, según lo acordado).
