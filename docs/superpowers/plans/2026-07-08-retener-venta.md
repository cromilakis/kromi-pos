# Retener / recuperar venta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cajero puede guardar la venta en curso ("retener") para atender otra compra y recuperarla después, además de vaciar el carrito con confirmación desde un icono en el encabezado del carrito.

**Architecture:** Una tabla `held_sale` (no financiera: no mueve caja ni stock) guarda el carrito como `jsonb` con RLS por negocio, escribible por cualquier usuario del negocio (incluido cajero). El `Cart` gana en su encabezado un icono de escoba (vaciar, con confirmación) y uno de diskette (guardar). `VentaScreen` orquesta guardar y recuperar, con un botón "Guardadas (N)" en la barra superior que abre la lista para retomar o descartar.

**Tech Stack:** React + Vite + TypeScript, TanStack Query, Supabase JS/Postgres, Tailwind CSS v4, Vitest.

## Global Constraints

- Prosa en español; identificadores/código en inglés.
- Gestor de paquetes: **pnpm**. Tests front: `pnpm test`. Build: `pnpm build`. DB local: `pnpm db:reset` (recrea con migraciones + seed).
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; sin `Co-Authored-By` ni atribución a Claude.
- Helpers SQL existentes (no redefinir): `public.current_business_id()`, `public.is_kromi()`, `public.is_pos_admin()`.
- Patrón para tabla nueva (ver `supabase/migrations/20260707130000_purchases.sql`): `create table` con FKs a `business(id)`/`branch(id)`/`app_user(id)`/`customer(id)`; índices por `business_id`; `enable row level security`; políticas; y **`grant` explícito a `authenticated`** (el grant amplio de la migración de RLS no cubre tablas nuevas).
- El estado del carrito en `VentaScreen` es `CartItem[]` = `{ id: string; qty: number }`. La RPC helper `cartToLines` (en `@/data/sales`) mapea a `{ product_id, qty }`.

---

### Task 1: Migración de la tabla `held_sale`

**Files:**
- Create: `supabase/migrations/20260708100000_held_sale.sql`

**Interfaces:**
- Produces: tabla `public.held_sale` con columnas `id, business_id, branch_id, cashier_id, customer_id, label, cart (jsonb), total_snapshot, created_at`; RLS por negocio; grants a `authenticated`.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260708100000_held_sale.sql`:

```sql
-- ============================================================================
-- Migración: ventas retenidas (carrito guardado para retomar)
-- Contrato: docs/superpowers/specs/2026-07-08-modulo-ventas-full-design.md (sub-proyecto 5)
-- Tabla held_sale: NO es documento financiero (no mueve caja ni stock).
-- Escritura directa por cualquier usuario del negocio (incluido cajero) vía RLS.
-- ============================================================================

create table public.held_sale (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business(id) on delete cascade,
  branch_id      uuid not null references public.branch(id) on delete cascade,
  cashier_id     uuid references public.app_user(id) on delete set null,
  customer_id    uuid references public.customer(id) on delete set null,
  label          text,
  cart           jsonb not null,                       -- [{ product_id, qty }]
  total_snapshot int not null default 0 check (total_snapshot >= 0),
  created_at     timestamptz not null default now()
);

create index idx_held_sale_business_branch on public.held_sale(business_id, branch_id);

alter table public.held_sale enable row level security;

-- Lectura y escritura por cualquier usuario del negocio (cajero incluido); kromi ve todo.
create policy held_sale_all on public.held_sale for all
  using (business_id = public.current_business_id() or public.is_kromi())
  with check (business_id = public.current_business_id());

-- Tabla nueva: GRANT explícito (el grant amplio de la migración de RLS no la cubre).
grant select, insert, update, delete on public.held_sale to authenticated;
```

- [ ] **Step 2: Aplicar la migración a la base local**

Run: `pnpm db:reset`
Expected: recrea la base aplicando todas las migraciones (incluida la nueva) y el seed, sin errores.

- [ ] **Step 3: Verificar que la tabla y la política existen**

Run:
```bash
docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -c "\d public.held_sale" -c "select polname from pg_policy where polrelid = 'public.held_sale'::regclass;"
```
Expected: la descripción de la tabla muestra las columnas indicadas y aparece la política `held_sale_all`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260708100000_held_sale.sql
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): tabla held_sale para retener ventas (RLS por negocio)"
```

---

### Task 2: Capa de datos de ventas retenidas

**Files:**
- Create: `src/data/heldSales.ts`

**Interfaces:**
- Consumes: `supabase` de `@/lib/supabase`.
- Produces:
  - `interface HeldCartItem { product_id: string; qty: number; }`
  - `interface HeldSaleRow { id: string; customer_id: string | null; label: string | null; cart: HeldCartItem[]; total_snapshot: number; created_at: string; }`
  - `useHeldSales(branchId?: string)` → query con `data: HeldSaleRow[]`.
  - `holdSale(input: { business_id: string; branch_id: string; cashier_id: string | null; customer_id: string | null; cart: HeldCartItem[]; total_snapshot: number; label?: string | null }): Promise<void>`
  - `deleteHeldSale(id: string): Promise<void>`

- [ ] **Step 1: Implementar `src/data/heldSales.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface HeldCartItem { product_id: string; qty: number; }

export interface HeldSaleRow {
  id: string;
  customer_id: string | null;
  label: string | null;
  cart: HeldCartItem[];
  total_snapshot: number;
  created_at: string;
}

export function useHeldSales(branchId?: string) {
  return useQuery({
    queryKey: ["held-sales", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<HeldSaleRow[]> => {
      const { data, error } = await supabase
        .from("held_sale")
        .select("id,customer_id,label,cart,total_snapshot,created_at")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HeldSaleRow[];
    },
  });
}

export async function holdSale(input: {
  business_id: string;
  branch_id: string;
  cashier_id: string | null;
  customer_id: string | null;
  cart: HeldCartItem[];
  total_snapshot: number;
  label?: string | null;
}) {
  const { error } = await supabase.from("held_sale").insert({
    business_id: input.business_id,
    branch_id: input.branch_id,
    cashier_id: input.cashier_id,
    customer_id: input.customer_id,
    cart: input.cart,
    total_snapshot: input.total_snapshot,
    label: input.label ?? null,
  });
  if (error) throw error;
}

export async function deleteHeldSale(id: string) {
  const { error } = await supabase.from("held_sale").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/data/heldSales.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): capa de datos de ventas retenidas (useHeldSales, holdSale, deleteHeldSale)"
```

---

### Task 3: Rediseño del encabezado del carrito (escoba + diskette)

**Files:**
- Modify: `src/modules/venta/Cart.tsx`

**Interfaces:**
- Consumes: nada nuevo (componente presentacional).
- Produces: `CartProps` gana `onHold: () => void`. El botón papelera junto a "Cobrar" desaparece; "Cobrar" ocupa todo el ancho. El encabezado muestra dos iconos: escoba (🧹, vacía con confirmación) y diskette (💾, `onHold`). La confirmación de vaciado es estado local del `Cart`.

- [ ] **Step 1: Reescribir `Cart.tsx`**

Reemplazar el contenido completo de `src/modules/venta/Cart.tsx` por:

```tsx
import { useState } from "react";
import type { ProductRow } from "@/data/stock";
import { fmtCLP } from "@/lib/money";
import type { Totals } from "@/lib/money";

export interface CartLine {
  product: ProductRow;
  qty: number;
}

interface CartProps {
  lines: CartLine[];
  totals: Totals;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onClear: () => void;
  onHold: () => void;
  onPay: () => void;
}

/** Panel del carrito de la venta actual: líneas, totales (neto/IVA) y acciones.
 *  En el encabezado: escoba (vaciar, con confirmación) y diskette (guardar/retener). */
export function Cart({ lines, totals, onInc, onDec, onClear, onHold, onPay }: CartProps) {
  const hasCart = lines.length > 0;
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-[#E1E5EE] bg-white">
      <div className="border-b border-[#E1E5EE] p-5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[18px] font-black text-[#0F2A1B]">Venta actual</div>
            {hasCart && (
              <span className="rounded-full bg-[#E7EFE8] px-2.5 py-0.5 text-xs font-bold text-[#0F2A1B]">
                {totals.items}
              </span>
            )}
          </div>
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
              onClick={() => setConfirmClear(true)}
              disabled={!hasCart}
              title="Vaciar carrito"
              className="flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e] disabled:opacity-40"
            >
              🧹
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-1.5">
        {!hasCart && (
          <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center text-[#9aa8bd]">
            <div className="text-[15px] font-bold text-[#7C95A8]">Carrito vacío</div>
            <div className="text-[13px] text-[#9aa8bd]">Seleccione un producto para sumarlo a la venta.</div>
          </div>
        )}
        {lines.map(({ product, qty }) => (
          <div key={product.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[#0F2A1B]">{product.name}</div>
              <div className="text-xs text-[#7C95A8]">{fmtCLP(product.price)} c/u</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onDec(product.id)}
                className="flex size-[26px] items-center justify-center rounded-lg border border-[#E1E5EE] bg-white text-base text-[#7C95A8]"
              >
                –
              </button>
              <span className="min-w-4 text-center text-sm font-bold text-[#0F2A1B]">{qty}</span>
              <button
                onClick={() => onInc(product.id)}
                disabled={qty >= product.stock}
                className="flex size-[26px] items-center justify-center rounded-lg bg-[#D3F4E0] text-base disabled:opacity-40"
                style={{ color: "var(--brand)" }}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[#E1E5EE] p-5">
        <div className="mb-1.5 flex justify-between text-[13px] text-[#7C95A8]">
          <span>Subtotal</span>
          <span>{fmtCLP(totals.neto)}</span>
        </div>
        <div className="mb-2.5 flex justify-between text-[13px] text-[#7C95A8]">
          <span>IVA 19%</span>
          <span>{fmtCLP(totals.iva)}</span>
        </div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <span className="text-lg font-black text-[#0F2A1B]">Total</span>
          <span className="text-[28px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
        </div>
        <button
          onClick={onPay}
          disabled={!hasCart}
          className="w-full rounded-[14px] py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#EEF1F6] disabled:text-[#9aa8bd]"
          style={hasCart ? { background: "var(--brand)" } : undefined}
        >
          Cobrar
        </button>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setConfirmClear(false)}>
          <div className="w-[380px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[15px] font-extrabold text-[#0F2A1B]">¿Vaciar el carrito?</div>
            <div className="mb-4 text-[13px] text-[#7C95A8]">Se quitarán todos los productos de la venta actual.</div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]"
              >
                Cancelar
              </button>
              <button
                onClick={() => { onClear(); setConfirmClear(false); }}
                className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white"
              >
                Vaciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm build`
Expected: `tsc -b` falla en `VentaScreen.tsx` por falta de la prop `onHold` en `<Cart>` (se resuelve en Task 4). Confirmar que el único error es ese; si es así, continuar.

- [ ] **Step 3: Commit**

```bash
git add src/modules/venta/Cart.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): encabezado del carrito con escoba (vaciar+confirmar) y diskette (guardar)"
```

---

### Task 4: Guardar y recuperar ventas retenidas en VentaScreen

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`

**Interfaces:**
- Consumes: `useHeldSales`, `holdSale`, `deleteHeldSale`, `type HeldSaleRow` de `@/data/heldSales` (Task 2); `cartToLines` de `@/data/sales`; el `Cart` con prop `onHold` (Task 3).
- Produces: `VentaScreen` guarda la venta en curso y la recupera desde un botón "Guardadas (N)".

- [ ] **Step 1: Imports y hook de guardadas**

En `src/modules/venta/VentaScreen.tsx` agregar el import (junto a los otros de datos):

```tsx
import { useHeldSales, holdSale, deleteHeldSale, type HeldSaleRow } from "@/data/heldSales";
```

Y dentro de `VentaScreen()`, junto a los otros hooks de datos:

```tsx
const { data: heldSales } = useHeldSales(branchId);
```

- [ ] **Step 2: Estado del modal de guardadas**

Junto a los otros `useState` de `VentaScreen`, agregar:

```tsx
const [heldOpen, setHeldOpen] = useState(false);
```

- [ ] **Step 3: Handlers de guardar y recuperar**

Agregar dentro de `VentaScreen()` (junto a los otros handlers como `clearCart`):

```tsx
async function handleHold() {
  if (!businessId || !branchId || cart.length === 0) return;
  try {
    await holdSale({
      business_id: businessId,
      branch_id: branchId,
      cashier_id: profile?.id ?? null,
      customer_id: customerId,
      cart: cartToLines(cart),
      total_snapshot: totals.total,
    });
    setCart([]);
    setCustomerId(null);
    toast.success("Venta guardada.");
    qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
  } catch (e) {
    toast.error(`No se pudo guardar la venta: ${e instanceof Error ? e.message : e}`);
  }
}

async function resumeHeld(h: HeldSaleRow) {
  // Reconstruye el carrito con los productos que aún existen, ajustando al stock actual.
  let ajustes = 0;
  const next: CartItem[] = [];
  for (const item of h.cart) {
    const p = productById.get(item.product_id);
    if (!p) { ajustes++; continue; }
    const qty = Math.min(item.qty, p.stock);
    if (qty <= 0) { ajustes++; continue; }
    if (qty !== item.qty) ajustes++;
    next.push({ id: item.product_id, qty });
  }
  setCart(next);
  setCustomerId(h.customer_id);
  setHeldOpen(false);
  try {
    await deleteHeldSale(h.id);
    qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
  } catch (e) {
    toast.error(`No se pudo quitar la venta guardada: ${e instanceof Error ? e.message : e}`);
  }
  if (ajustes > 0) toast.warning("Algunas líneas se ajustaron por stock o productos no disponibles.");
}

async function discardHeld(id: string) {
  try {
    await deleteHeldSale(id);
    qc.invalidateQueries({ queryKey: ["held-sales", branchId] });
  } catch (e) {
    toast.error(`No se pudo descartar: ${e instanceof Error ? e.message : e}`);
  }
}
```

- [ ] **Step 4: Botón "Guardadas (N)" en la barra**

En la barra superior de `VentaScreen` (junto a los botones "Nota de crédito" y "Cerrar caja"), agregar antes de "Nota de crédito":

```tsx
<button
  onClick={() => setHeldOpen(true)}
  className="rounded-xl border border-[#E1E5EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#5a6b7e]"
>
  Guardadas{heldSales && heldSales.length > 0 ? ` (${heldSales.length})` : ""}
</button>
```

- [ ] **Step 5: Pasar `onHold` al `Cart`**

En el `<Cart ... />` de `VentaScreen`, agregar la prop:

```tsx
onHold={handleHold}
```

(El `<Cart>` ya recibe `onClear={clearCart}`; se mantiene.)

- [ ] **Step 6: Modal de ventas guardadas**

Agregar antes del cierre del fragmento de retorno (junto a los otros diálogos como `PayDialog`/`CreditNoteDialog`):

```tsx
{heldOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setHeldOpen(false)}>
    <div className="max-h-[80vh] w-[480px] max-w-full overflow-auto rounded-[22px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[18px] font-black text-[#0F2A1B]">Ventas guardadas</div>
        <button onClick={() => setHeldOpen(false)} className="rounded-lg border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] font-bold text-[#5a6b7e]">Cerrar</button>
      </div>
      {(!heldSales || heldSales.length === 0) ? (
        <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">No hay ventas guardadas.</div>
      ) : (
        heldSales.map((h) => {
          const cliente = h.customer_id ? (allCustomers.find((c) => c.id === h.customer_id)?.name ?? "Cliente") : "Sin cliente";
          const items = h.cart.reduce((s, it) => s + it.qty, 0);
          const hora = new Date(h.created_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={h.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-[#0F2A1B]">{cliente}</div>
                <div className="text-xs text-[#7C95A8]">{hora} · {items} {items === 1 ? "ítem" : "ítems"} · {fmtCLP(h.total_snapshot)}</div>
              </div>
              <button
                onClick={() => resumeHeld(h)}
                className="rounded-[10px] px-3.5 py-2 text-[13px] font-bold text-white"
                style={{ background: "var(--brand)" }}
              >
                Retomar
              </button>
              <button
                onClick={() => discardHeld(h.id)}
                title="Descartar"
                className="flex size-[34px] items-center justify-center rounded-[10px] border border-[#F5C2C2] bg-white text-[#D02E2E]"
              >
                🗑
              </button>
            </div>
          );
        })
      )}
    </div>
  </div>
)}
```

- [ ] **Step 7: Verificar tipos y build**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 8: Verificación manual**

Run: `pnpm dev` (o `pnpm tauri dev`). Con caja abierta:
- Agregar productos, tocar 💾: el carrito se vacía y "Guardadas" muestra el conteo.
- Abrir "Guardadas", **Retomar**: el carrito se restaura con cliente y cantidades; la entrada desaparece de la lista.
- Tocar 🧹 con carrito lleno: aparece la confirmación; "Vaciar" limpia, "Cancelar" no.
- **Descartar** una guardada la elimina de la lista.

Expected: todo el ciclo guardar → recuperar/descartar funciona; el vaciar pide confirmación.

- [ ] **Step 9: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): guardar y recuperar ventas retenidas desde la barra de Venta"
```

---

## Self-review (cobertura del spec + pedido del usuario)

- Guardar carrito para atender otra compra (diskette) → Tasks 1-4.
- Recuperación desde "Guardadas (N)" en la barra de Venta → Task 4.
- Persistencia en base de datos (tabla `held_sale`, RLS por negocio) → Task 1.
- Escoba en el encabezado del carrito con popup de confirmación; se quita la papelera junto a "Cobrar" → Task 3.
- Revalidación de stock al recuperar → `resumeHeld` en Task 4.
- Descuentos aún no existen: `cart` guarda sólo `{ product_id, qty }`; se extenderá cuando se implemente el sub-proyecto 4.
