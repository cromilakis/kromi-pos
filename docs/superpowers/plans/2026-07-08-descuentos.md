# Descuentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir descuentos por línea y sobre el total de la venta (en % o monto), aplicables solo por administradores, recalculados y validados en el servidor, y reflejados en la boleta.

**Architecture:** El cliente ingresa descuentos como `{kind: 'pct'|'amount', value}` por línea y para el total; un helper puro resuelve el monto en pesos para mostrar. La RPC `cobrar_venta` recibe esos descuentos, valida que el usuario sea admin, **resuelve los montos con el precio del servidor** (nunca confía en montos del cliente) y delega en `_registrar_venta`, que persiste `discount_amount` en `sale`/`sale_line` y recalcula neto/IVA sobre el total ya descontado. La boleta muestra una línea de descuento.

**Tech Stack:** React + Vite + TypeScript, Supabase/Postgres (plpgsql), Rust (ESC/POS), Vitest.

## Global Constraints

- Prosa en español; identificadores/código en inglés.
- Gestor de paquetes: **pnpm**. Tests: `pnpm test`. Build: `pnpm build`.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; sin `Co-Authored-By` ni atribución a Claude.
- **La app usa el Supabase REMOTO** (`immuembrvocwbdpprypk`); migraciones con `supabase db push`. **Esta migración reescribe la RPC de cobro** → pedir confirmación explícita del usuario antes de aplicar al remoto (producción).
- Precios con IVA incluido: `neto = round(total/1.19)`, `iva = total - neto`.
- Rol admin en SQL: `public.is_pos_admin()` (admin o kromi). En cliente: `profile.role === "admin" || "kromi"`.
- **Decisión de modelo**: se guarda solo el **monto** de descuento resuelto (`discount_amount` en `sale` y `sale_line`); no se guardan kind/value (suficiente para boleta y cuadre de caja).
- El descuento total se aplica sobre el subtotal **después** de los descuentos de línea.

---

### Task 1: Migración — columnas de descuento y RPC con descuentos

**Files:**
- Create: `supabase/migrations/20260708120000_descuentos.sql`

**Interfaces:**
- Produces:
  - `sale.discount_amount int not null default 0`, `sale_line.discount_amount int not null default 0`.
  - `cobrar_venta(p_branch uuid, p_session uuid, p_lines jsonb, p_method public.sale_method, p_recv int, p_customer uuid default null, p_total_disc jsonb default null)` — `p_lines = [{product_id, qty, disc_kind, disc_value}]`; `p_total_disc = {kind, value}` o null.
  - `_registrar_venta(..., p_total_disc int default 0)` — `p_lines` acepta `discount` (monto) por línea.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260708120000_descuentos.sql`:

```sql
-- ============================================================================
-- Migración: descuentos por línea y total (solo admin), recalculados en servidor
-- Contrato: docs/superpowers/specs/2026-07-08-modulo-ventas-full-design.md (sub-proyecto 4)
-- Guarda el MONTO resuelto en sale.discount_amount y sale_line.discount_amount.
-- ============================================================================

alter table public.sale add column discount_amount int not null default 0 check (discount_amount >= 0);
alter table public.sale_line add column discount_amount int not null default 0 check (discount_amount >= 0);

-- Núcleo interno: ahora acepta descuento por línea (dentro de p_lines) y total (p_total_disc, monto).
drop function if exists public._registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid);
create function public._registrar_venta(
  p_branch     uuid,
  p_session    uuid,
  p_lines      jsonb,
  p_method     public.sale_method,
  p_recv       int,
  p_customer   uuid,
  p_total_disc int default 0
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_bruto    int := 0;   -- suma de (qty*price - discount_line)
  v_total    int;
  v_neto     int;
  v_iva      int;
  v_points   int;
  v_recv     int;
  v_change   int;
  v_folio    int;
  v_sale     public.sale;
  ln         record;
begin
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la venta no tiene líneas';
  end if;
  if p_total_disc < 0 then
    raise exception 'descuento total inválido';
  end if;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           (e->>'price')::int as price,
           coalesce((e->>'discount')::int, 0) as discount
      from jsonb_array_elements(p_lines) e
  loop
    if ln.qty is null or ln.qty <= 0 then
      raise exception 'cantidad inválida en una línea';
    end if;
    if ln.price is null or ln.price < 0 then
      raise exception 'precio inválido en una línea';
    end if;
    if ln.discount < 0 or ln.discount > ln.qty * ln.price then
      raise exception 'descuento de línea inválido';
    end if;
    perform 1 from public.inventory
      where product_id = ln.product_id and branch_id = p_branch and stock >= ln.qty;
    if not found then
      raise exception 'stock insuficiente para el producto %', ln.product_id;
    end if;
    v_bruto := v_bruto + (ln.qty * ln.price - ln.discount);
  end loop;

  if p_total_disc > v_bruto then
    raise exception 'el descuento total supera el monto de la venta';
  end if;

  v_total  := v_bruto - p_total_disc;
  v_neto   := round(v_total / 1.19);
  v_iva    := v_total - v_neto;
  v_points := floor(v_total / 1000);
  v_recv   := case when p_method = 'efectivo' then p_recv else v_total end;
  if p_method = 'efectivo' and v_recv < v_total then
    raise exception 'el efectivo recibido es menor al total';
  end if;
  v_change := v_recv - v_total;

  v_folio := public.siguiente_folio(p_branch, 'sale');

  insert into public.sale (business_id, branch_id, cash_session_id, folio, method,
                           total, neto, iva, recv, change, points, customer_id, cashier_id, discount_amount)
  values (v_business, p_branch, p_session, v_folio, p_method,
          v_total, v_neto, v_iva, v_recv, v_change, v_points, p_customer, auth.uid(), p_total_disc)
  returning * into v_sale;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           (e->>'price')::int as price,
           coalesce((e->>'discount')::int, 0) as discount
      from jsonb_array_elements(p_lines) e
  loop
    insert into public.sale_line (sale_id, product_id, name_snapshot, price_snapshot, category_snapshot, qty, discount_amount)
    select v_sale.id, p.id, p.name, ln.price,
           (select key from public.category c where c.id = p.category_id), ln.qty, ln.discount
      from public.product p where p.id = ln.product_id;

    update public.inventory
       set stock = stock - ln.qty
     where product_id = ln.product_id and branch_id = p_branch;
  end loop;

  if p_customer is not null then
    update public.customer
       set points = points + v_points,
           spent  = spent + v_total,
           visits = visits + 1
     where id = p_customer;
  end if;

  return v_sale;
end;
$$;

revoke execute on function public._registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, int)
  from public, anon, authenticated;

-- RPC pública: recibe descuentos del cliente (kind+value), valida admin, resuelve
-- montos con el PRECIO DEL SERVIDOR y delega en el núcleo.
drop function if exists public.cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid);
create function public.cobrar_venta(
  p_branch     uuid,
  p_session    uuid,
  p_lines      jsonb,
  p_method     public.sale_method,
  p_recv       int,
  p_customer   uuid default null,
  p_total_disc jsonb default null
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business  uuid;
  v_lines     jsonb;
  v_bruto     int := 0;
  v_has_disc  boolean := false;
  v_tot_disc  int := 0;
  v_tkind     text := p_total_disc->>'kind';
  v_tvalue    int  := coalesce((p_total_disc->>'value')::int, 0);
  ln          record;
begin
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la venta no tiene líneas';
  end if;

  -- Resuelve el precio del servidor y el descuento (monto) de cada línea.
  select jsonb_agg(jsonb_build_object(
           'product_id', x.product_id,
           'qty',        x.qty,
           'price',      x.price,
           'discount',   x.disc)),
         sum(x.qty * x.price - x.disc),
         bool_or(x.disc > 0)
    into v_lines, v_bruto, v_has_disc
    from (
      select e.product_id,
             e.qty,
             (select price from public.product where id = e.product_id) as price,
             case
               when e.disc_kind = 'pct'    then least((select price from public.product where id = e.product_id) * e.qty,
                                                       round((select price from public.product where id = e.product_id) * e.qty * coalesce(e.disc_value,0) / 100.0))
               when e.disc_kind = 'amount' then least((select price from public.product where id = e.product_id) * e.qty, coalesce(e.disc_value,0))
               else 0
             end as disc
        from jsonb_to_recordset(p_lines)
          as e(product_id uuid, qty int, disc_kind text, disc_value int)
    ) x;

  -- Descuento total (monto), resuelto sobre el subtotal ya descontado por línea.
  if v_tvalue > 0 and v_tkind is not null then
    v_tot_disc := case
      when v_tkind = 'pct'    then least(v_bruto, round(v_bruto * v_tvalue / 100.0))
      when v_tkind = 'amount' then least(v_bruto, v_tvalue)
      else 0
    end;
  end if;

  -- Autorización: cualquier descuento (línea o total) requiere admin.
  if (v_has_disc or v_tot_disc > 0) and not public.is_pos_admin() then
    raise exception 'los descuentos requieren rol administrador';
  end if;

  return public._registrar_venta(p_branch, p_session, v_lines, p_method, p_recv, p_customer, v_tot_disc);
end;
$$;

grant execute on function public.cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb)
  to authenticated;
```

- [ ] **Step 2: Aplicar al LOCAL y probar la RPC**

Run: `npx supabase migration up --local`
Expected: aplica `20260708120000_descuentos.sql` sin error.

- [ ] **Step 3: Aplicar al REMOTO (requiere confirmación explícita del usuario)**

Confirmar con el usuario que se aplica a producción (reescribe la RPC de cobro). Tras el OK:

Run: `echo "y" | npx supabase db push`
Expected: "Applying migration 20260708120000_descuentos.sql..." y "Finished".

Verificar:

Run: `npx supabase migration list --linked`
Expected: `"local":"20260708120000","remote":"20260708120000"`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260708120000_descuentos.sql
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): descuentos por linea y total en la RPC de cobro (solo admin, recalculo en servidor)"
```

---

### Task 2: `computeTotals` y `resolveDiscount` con descuentos

**Files:**
- Modify: `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Interfaces:**
- Produces:
  - `resolveDiscount(base: number, kind: "pct" | "amount" | null, value: number): number` — monto en pesos, capado a `base`.
  - `Line` gana `discount?: number` (monto en pesos de la línea).
  - `Totals` gana `discount: number` (descuento total aplicado).
  - `computeTotals(lines: Line[], totalDiscount?: number): Totals`.

- [ ] **Step 1: Escribir los tests**

Añadir a `src/lib/money.test.ts`:

```ts
import { computeTotals, resolveDiscount } from "./money";

describe("resolveDiscount", () => {
  it("resuelve porcentaje y monto, capado a la base", () => {
    expect(resolveDiscount(10000, "pct", 10)).toBe(1000);
    expect(resolveDiscount(10000, "amount", 3000)).toBe(3000);
    expect(resolveDiscount(10000, "amount", 99999)).toBe(10000); // capado
    expect(resolveDiscount(10000, null, 50)).toBe(0);
    expect(resolveDiscount(10000, "pct", 0)).toBe(0);
  });
});

describe("computeTotals con descuentos", () => {
  it("descuenta por línea y sobre el total (IVA incluido)", () => {
    // 2×5000 = 10000, con 1000 de descuento de línea → 9000 subtotal
    const t = computeTotals([{ qty: 2, price: 5000, discount: 1000 }], 900);
    expect(t.total).toBe(8100);          // 9000 - 900
    expect(t.discount).toBe(1900);       // 1000 línea + 900 total
    expect(t.neto).toBe(Math.round(8100 / 1.19));
    expect(t.iva).toBe(8100 - Math.round(8100 / 1.19));
    expect(t.items).toBe(2);
  });

  it("sin descuentos se comporta como antes", () => {
    const t = computeTotals([{ qty: 1, price: 11900 }]);
    expect(t.total).toBe(11900);
    expect(t.discount).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar para verlo fallar**

Run: `pnpm test -- src/lib/money.test.ts`
Expected: FAIL (`resolveDiscount` no existe / `discount` no está en `Totals`).

- [ ] **Step 3: Implementar en `src/lib/money.ts`**

Reemplazar el contenido de las interfaces y `computeTotals`, y añadir `resolveDiscount`:

```ts
export interface Line { qty: number; price: number; discount?: number; }
export interface Totals { total: number; neto: number; iva: number; items: number; discount: number; }

/** Monto en pesos de un descuento, capado a `base`. kind null/valor<=0 → 0. */
export function resolveDiscount(base: number, kind: "pct" | "amount" | null, value: number): number {
  if (!kind || !value || value <= 0) return 0;
  const raw = kind === "pct" ? Math.round((base * value) / 100) : value;
  return Math.max(0, Math.min(base, raw));
}

export function computeTotals(lines: Line[], totalDiscount = 0): Totals {
  const bruto = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const lineDisc = lines.reduce((s, l) => s + (l.discount ?? 0), 0);
  const items = lines.reduce((s, l) => s + l.qty, 0);
  const sub = Math.max(0, bruto - lineDisc);
  const appliedTotalDisc = Math.min(totalDiscount, sub);
  const total = sub - appliedTotalDisc;
  const neto = Math.round(total / 1.19);
  return { total, neto, iva: total - neto, items, discount: lineDisc + appliedTotalDisc };
}
```

(El resto de `money.ts` — `fmtCLP` — se mantiene igual.)

- [ ] **Step 4: Ejecutar para verlo pasar**

Run: `pnpm test -- src/lib/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar tipos del resto del código**

Run: `pnpm build`
Expected: `tsc -b` compila (el campo `discount` de `Totals` es nuevo pero no rompe consumidores; si algún consumidor desestructura `Totals` exhaustivamente, ajustarlo). Confirmar sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): computeTotals y resolveDiscount con descuentos"
```

---

### Task 3: `cobrarVenta` (capa de datos) con descuentos

**Files:**
- Modify: `src/data/sales.ts`

**Interfaces:**
- Consumes: RPC `cobrar_venta` con `p_total_disc` (Task 1).
- Produces:
  - `DiscountInput = { kind: "pct" | "amount"; value: number } | null`
  - `CartItem` gana `disc_kind?: "pct" | "amount" | null; disc_value?: number`.
  - `cobrarVenta` acepta `p_lines` con descuento por línea y `p_total_disc?: DiscountInput`.

- [ ] **Step 1: Actualizar tipos y `cobrarVenta` en `src/data/sales.ts`**

Reemplazar `CartItem` y `cobrarVenta`:

```ts
export interface CartItem { product_id: string; qty: number; disc_kind?: "pct" | "amount" | null; disc_value?: number; }

export type DiscountInput = { kind: "pct" | "amount"; value: number } | null;

/** Cobra la venta de forma atómica vía RPC. Descuentos (línea y total) los recalcula
 *  y valida el servidor (solo admin); el cliente solo envía kind/value. */
export async function cobrarVenta(args: {
  p_branch: string;
  p_session: string;
  p_lines: CartItem[];
  p_method: "efectivo" | "tarjeta";
  p_recv: number;
  p_customer?: string | null;
  p_total_disc?: DiscountInput;
}): Promise<Sale> {
  const { data, error } = await supabase.rpc("cobrar_venta", {
    p_branch: args.p_branch,
    p_session: args.p_session,
    p_lines: args.p_lines,
    p_method: args.p_method,
    p_recv: args.p_recv,
    p_customer: args.p_customer ?? null,
    p_total_disc: args.p_total_disc ?? null,
  });
  if (error) throw error;
  return data;
}
```

Actualizar `cartToLines` para propagar el descuento por línea:

```ts
export function cartToLines(cart: { id: string; qty: number; disc_kind?: "pct" | "amount" | null; disc_value?: number }[]): CartItem[] {
  return cart.map((c) => ({ product_id: c.id, qty: c.qty, disc_kind: c.disc_kind ?? null, disc_value: c.disc_value ?? 0 }));
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm build`
Expected: `tsc -b` sin errores (los consumidores actuales pasan `cart` sin descuento; opcionales, compatibles).

- [ ] **Step 3: Commit**

```bash
git add src/data/sales.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): cobrarVenta acepta descuentos por linea y total"
```

---

### Task 4: Estado de descuentos y UI en VentaScreen + Cart

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`
- Modify: `src/modules/venta/Cart.tsx`

**Interfaces:**
- Consumes: `resolveDiscount`, `computeTotals` (Task 2); `cobrarVenta`/`cartToLines` con descuentos (Task 3).
- Produces: `CartItem` de VentaScreen gana `disc_kind`/`disc_value`; `Cart` recibe descuento total y callbacks para editar descuentos (solo admin).

Este task se implementa con estas piezas concretas:

- [ ] **Step 1: Extender el estado del carrito en `VentaScreen`**

En `VentaScreen`, la interfaz local `CartItem` (`{ id, qty }`) pasa a:

```tsx
interface CartItem { id: string; qty: number; disc_kind?: "pct" | "amount" | null; disc_value?: number; }
```

Añadir estado para el descuento total y flag admin:

```tsx
const [totalDisc, setTotalDisc] = useState<{ kind: "pct" | "amount"; value: number } | null>(null);
const canDiscount = profile?.role === "admin" || profile?.role === "kromi";
```

- [ ] **Step 2: Calcular `cartLines` y `totals` con descuentos**

Reemplazar el cálculo de `totals` para incluir descuentos resueltos:

```tsx
const cartLines: CartLine[] = useMemo(
  () => cart.map((c) => ({ product: productById.get(c.id)!, qty: c.qty, disc_kind: c.disc_kind ?? null, disc_value: c.disc_value ?? 0 })).filter((l) => l.product),
  [cart, productById],
);
const totals = useMemo(() => {
  const lines = cartLines.map((l) => ({
    qty: l.qty,
    price: l.product.price,
    discount: resolveDiscount(l.qty * l.product.price, l.disc_kind ?? null, l.disc_value ?? 0),
  }));
  const sub = lines.reduce((s, l) => s + l.qty * l.price - (l.discount ?? 0), 0);
  const totalDiscMonto = totalDisc ? resolveDiscount(sub, totalDisc.kind, totalDisc.value) : 0;
  return computeTotals(lines, totalDiscMonto);
}, [cartLines, totalDisc]);
```

(`CartLine` en `Cart.tsx` gana `disc_kind?`/`disc_value?` — ver Step 5. Importar `resolveDiscount` de `@/lib/money`.)

- [ ] **Step 3: Pasar descuentos al cobro**

En `handleConfirmPay`, cambiar la llamada a `cobrarVenta` para incluir descuentos:

```tsx
const sale = await cobrarVenta({
  p_branch: branchId,
  p_session: openSession.id,
  p_lines: cartToLines(cart),
  p_method: method,
  p_recv: recv,
  p_customer: customerId,
  p_total_disc: totalDisc,
});
```

Tras cobrar con éxito, limpiar el descuento total: añadir `setTotalDisc(null);` junto a `setCart([])`.

- [ ] **Step 4: Callbacks para editar descuentos (solo admin)**

Añadir en `VentaScreen`:

```tsx
function setLineDiscount(id: string, kind: "pct" | "amount" | null, value: number) {
  setCart((c) => c.map((x) => (x.id === id ? { ...x, disc_kind: kind, disc_value: value } : x)));
}
```

- [ ] **Step 5: `Cart` muestra y edita descuentos**

En `src/modules/venta/Cart.tsx`:
- `CartLine` gana `disc_kind?: "pct" | "amount" | null; disc_value?: number;`.
- `CartProps` gana: `canDiscount: boolean; totalDisc: { kind: "pct" | "amount"; value: number } | null; onSetTotalDisc: (d: { kind: "pct" | "amount"; value: number } | null) => void; onSetLineDisc: (id: string, kind: "pct" | "amount" | null, value: number) => void;`.
- Importar `resolveDiscount` de `@/lib/money`.
- En cada línea, si `canDiscount`, bajo el nombre mostrar un control compacto: un `<select>` de kind (`—` / `%` / `$`) y un `<input>` numérico de valor; al cambiar llaman `onSetLineDisc(product.id, kind, value)`. Si hay descuento, mostrar el monto resuelto en rojo (`-{fmtCLP(resolveDiscount(product.price*qty, disc_kind, disc_value))}`).
- En el bloque de totales, si `canDiscount`, sobre "Subtotal" añadir una fila "Descuento" con el mismo control (kind select + value input) que llama `onSetTotalDisc`. Mostrar `totals.discount` como `-{fmtCLP(totals.discount)}` si es > 0.

Código del control reutilizable (definir dentro de `Cart.tsx`):

```tsx
function DiscountControl({ kind, value, onChange }: {
  kind: "pct" | "amount" | null;
  value: number;
  onChange: (k: "pct" | "amount" | null, v: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={kind ?? ""}
        onChange={(e) => onChange((e.target.value || null) as "pct" | "amount" | null, value)}
        className="rounded-md border border-[#E1E5EE] bg-white px-1.5 py-1 text-xs font-bold text-[#5a6b7e]"
      >
        <option value="">—</option>
        <option value="pct">%</option>
        <option value="amount">$</option>
      </select>
      <input
        value={value || ""}
        onChange={(e) => onChange(kind, Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        inputMode="numeric"
        placeholder="0"
        disabled={!kind}
        className="w-16 rounded-md border border-[#E1E5EE] bg-white px-2 py-1 text-xs text-[#0F2A1B] outline-none disabled:opacity-50"
      />
    </span>
  );
}
```

En cada línea del carrito (dentro del `.map`), tras el nombre/precio, si `canDiscount`:

```tsx
{canDiscount && (
  <div className="mt-1 flex items-center gap-2">
    <span className="text-[11px] font-semibold text-[#9aa8bd]">Desc.</span>
    <DiscountControl
      kind={disc_kind ?? null}
      value={disc_value ?? 0}
      onChange={(k, v) => onSetLineDisc(product.id, k, v)}
    />
  </div>
)}
```

En el bloque de totales, antes de "Subtotal":

```tsx
{canDiscount && (
  <div className="mb-1.5 flex items-center justify-between text-[13px] text-[#7C95A8]">
    <span className="inline-flex items-center gap-2">Descuento total <DiscountControl kind={totalDisc?.kind ?? null} value={totalDisc?.value ?? 0} onChange={(k, v) => onSetTotalDisc(k ? { kind: k, value: v } : null)} /></span>
    <span className="font-bold text-[#D02E2E]">{totals.discount > 0 ? `-${fmtCLP(totals.discount)}` : ""}</span>
  </div>
)}
```

Actualizar la instancia de `<Cart .../>` en `VentaScreen` para pasar las nuevas props: `canDiscount={canDiscount}`, `totalDisc={totalDisc}`, `onSetTotalDisc={setTotalDisc}`, `onSetLineDisc={setLineDiscount}`.

- [ ] **Step 6: Verificar tipos y tests**

Run: `pnpm build && pnpm test`
Expected: `tsc -b` sin errores; tests verdes.

- [ ] **Step 7: Verificación manual**

Run: `pnpm dev`. Como **admin**, con caja abierta: agregar productos, poner un descuento a una línea (% o $) y un descuento total; ver que el total baja y aparece "Descuento -$…". Cobrar: la boleta/total reflejan el descuento; la venta queda registrada. Como **cajero**: los controles de descuento no aparecen; si se fuerza (no debería poder), el servidor rechaza.

Expected: descuentos correctos y solo-admin.

- [ ] **Step 8: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx src/modules/venta/Cart.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): UI de descuentos por linea y total en el carrito (solo admin)"
```

---

### Task 5: Descuento en la boleta ESC/POS

**Files:**
- Modify: `src-tauri/src/escpos.rs`
- Modify: `src/modules/venta/VentaScreen.tsx` (payload)

**Interfaces:**
- Consumes: `totals.discount` (Task 2).
- Produces: `ReceiptPayload` gana `descuento: i64`; la boleta imprime una línea "Descuento" si es > 0.

- [ ] **Step 1: Añadir el campo al payload en Rust**

En `src-tauri/src/escpos.rs`, en `struct ReceiptPayload`, añadir tras `total`:

```rust
    pub total: i64,
    pub descuento: i64,
    pub metodo: String,
```

- [ ] **Step 2: Imprimir la línea de descuento**

En `build`, entre el bloque de totales `Neto`/`IVA` y el `TOTAL`, añadir (después de `line_lr IVA`):

```rust
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    if p.descuento > 0 {
        line_lr(&mut b, "Descuento", &format!("-{}", money(p.descuento)), COL);
    }
    nl(&mut b);
```

(Reemplaza el `nl` que sigue a la línea de IVA; el `line_lr IVA` ya existe, se añade el `if` en medio.)

- [ ] **Step 3: Actualizar el test de Rust y el sample**

En el módulo `tests` de `escpos.rs`, la función `sample(...)` que construye un `ReceiptPayload` debe incluir `descuento: 0` para compilar.

- [ ] **Step 4: Compilar Rust**

Run: `cd src-tauri && cargo test escpos`
Expected: compila y los tests pasan.

- [ ] **Step 5: Incluir `descuento` en el payload del frontend**

En `VentaScreen.handleConfirmPay`, en el objeto `payload`, añadir tras `total`:

```tsx
  total: sale.total,
  descuento: sale.discount_amount + soldLines.reduce((s, l) => s + resolveDiscount(l.qty * l.product.price, l.disc_kind ?? null, l.disc_value ?? 0), 0),
  metodo: sale.method,
```

Añadir `discount_amount: number;` a la interfaz `Sale` en `src/data/sales.ts` (viene de la RPC).

(Nota: `soldLines` es `cartLines` capturado antes de limpiar; ya existe en `handleConfirmPay`.)

- [ ] **Step 6: Verificar build y tests**

Run: `pnpm build && pnpm test`
Expected: sin errores; tests verdes.

- [ ] **Step 7: Verificación manual**

Run: `pnpm tauri dev`. Cobrar una venta con descuento (como admin): la boleta impresa muestra la línea "Descuento -$…" y el total correcto.

Expected: boleta con descuento.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/escpos.rs src/modules/venta/VentaScreen.tsx src/data/sales.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(boleta): mostrar linea de descuento en la boleta"
```

---

## Self-review (cobertura del spec)

- Descuentos por línea y total, % y monto → Task 1 (RPC) + Task 2 (helpers) + Task 4 (UI).
- Solo admin, validado en servidor → `is_pos_admin()` en `cobrar_venta` (Task 1) + `canDiscount` en UI (Task 4).
- Precio base fijado por el servidor → `cobrar_venta` resuelve precio y descuento con datos del servidor (Task 1).
- neto/IVA sobre el total descontado → `_registrar_venta` (Task 1) y `computeTotals` (Task 2).
- Registrado en la venta → columnas `discount_amount` (Task 1).
- Reflejado en la boleta → Task 5.
- Migración al remoto con confirmación → Task 1 Step 3.
- Desviación documentada: se guarda solo el monto (no kind/value).
