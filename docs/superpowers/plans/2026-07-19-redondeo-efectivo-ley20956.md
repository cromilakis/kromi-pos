# Ley del redondeo en efectivo (Ley 20.956) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el redondeo legal (múltiplo de $10, 1–5 abajo / 6–9 arriba) a los cobros y devoluciones en **efectivo**, sin alterar los documentos tributarios (boleta/DTE y NC 61 con monto exacto), y reflejarlo en el ticket y en el arqueo del cierre.

**Architecture:** El redondeo es autoritativo en la BD: `_register_sale` redondea el monto a pagar en efectivo (guardando `total` fiscal exacto + `recv`/`change` sobre el redondeado); `close_cash_session` calcula el arqueo con lo realmente cobrado/pagado (ventas y NC) y expone el ajuste por redondeo. El frontend (PayDialog) muestra el redondeo; `escpos.rs` lo imprime en ticket de venta, NC y comprobante de cierre.

**Tech Stack:** PostgreSQL (Supabase, pgTAP), React + TS (Vitest), Rust (escpos).

## Global Constraints

- **Fórmula de redondeo:** decena, 1–5 abajo / 6–9 arriba (el 5 baja) = `floor((n+4)/10)*10` (TS) / `((v+4)/10)*10` (plpgsql int). Aplica SOLO a `method = 'efectivo'`.
- **Documentos tributarios intactos:** `sale.total` y el DTE (`issue-receipt`), y el DTE 61 (`issue-credit-note`), mantienen el monto EXACTO. El redondeo afecta solo `recv`/`change` (lo cobrado) y lo mostrado/arqueado.
- **Identidad del arqueo:** `expected_cash = float + cash − nc_cash − rounding`, donde `cash`/`nc_cash` son fiscales y `rounding = (cash − cobrado) − (nc_cash − pagado)`.
- Commit identity = `Cromilakis <ipcromilakis@gmail.com>`; prohibido `Co-Authored-By` y atribución a Claude. Nunca `git add -A`.
- Prosa español, identificadores inglés.
- **Producción:** la migración de BD se aplica a Supabase producción como paso aparte, con OK del usuario. Local: `pnpm db:reset` + `pnpm test:db`.

---

### Task 1: Helper `roundCashCLP` en money.ts

**Files:**
- Modify: `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Interfaces:**
- Produces: `roundCashCLP(n: number): number` — redondea al múltiplo de 10 (1–5 abajo, 6–9 arriba).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/lib/money.test.ts` (importar `roundCashCLP` desde `./money`, sumándolo al import existente si ya hay uno):

```ts
import { roundCashCLP } from "./money";

describe("roundCashCLP (Ley 20.956)", () => {
  it("1-5 redondea hacia abajo (el 5 baja)", () => {
    expect(roundCashCLP(16191)).toBe(16190);
    expect(roundCashCLP(16192)).toBe(16190);
    expect(roundCashCLP(16195)).toBe(16190);
  });
  it("6-9 redondea hacia arriba", () => {
    expect(roundCashCLP(16196)).toBe(16200);
    expect(roundCashCLP(16199)).toBe(16200);
  });
  it("múltiplos de 10 y 0 quedan igual", () => {
    expect(roundCashCLP(16190)).toBe(16190);
    expect(roundCashCLP(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- money.test`
Expected: FAIL — `roundCashCLP is not a function`.

- [ ] **Step 3: Implementar el helper**

Agregar en `src/lib/money.ts` (después de `resolveDiscount`):

```ts
/** Redondeo legal de efectivo (Ley 20.956): al múltiplo de $10, 1–5 hacia abajo
 *  y 6–9 hacia arriba (el 5 baja). Solo aplica a pagos en efectivo. */
export function roundCashCLP(n: number): number {
  return Math.floor((n + 4) / 10) * 10;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- money.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts
git commit -m "feat(caja): helper roundCashCLP (redondeo Ley 20.956)"
```

---

### Task 2: Migración BD — `_register_sale` + `close_cash_session` con redondeo

**Files:**
- Create: `supabase/migrations/20260719120000_cash_rounding_ley20956.sql`
- Modify: `supabase/tests/rpc_test.sql` (tests pgTAP)

**Interfaces:**
- Produces: `_register_sale` (efectivo redondea; `total` exacto; `recv-change` = redondeado). `close_cash_session` devuelve el JSON con el nuevo campo `rounding` y `expected_cash` sobre lo cobrado/pagado.

- [ ] **Step 1: Crear la migración**

Crear `supabase/migrations/20260719120000_cash_rounding_ley20956.sql` con el cuerpo COMPLETO de las dos funciones (el de `_register_sale` es el vigente de `20260714180000_points_config_redeem.sql` con el bloque de efectivo cambiado; el de `close_cash_session` es el vigente `cerrar_caja` de `20260707100200_functions.sql`, ya renombrado, con el arqueo cambiado):

```sql
-- ============================================================================
-- Ley 20.956 (redondeo en efectivo): _register_sale redondea el monto a pagar
-- en efectivo (total fiscal exacto; recv/change sobre el redondeado).
-- close_cash_session calcula el arqueo con lo realmente cobrado/pagado
-- (ventas y NC) y expone el ajuste por redondeo.
-- ============================================================================

create or replace function public._register_sale(
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
  v_business      uuid;
  v_bruto         int := 0;
  v_total         int;
  v_pay           int;
  v_neto          int;
  v_iva           int;
  v_points        int;
  v_recv          int;
  v_change        int;
  v_folio         int;
  v_sale          public.sale;
  v_clp_per_point int;
  v_multiplier    int;
  ln              record;
begin
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  select points_clp_per_point, points_multiplier
    into v_clp_per_point, v_multiplier
    from public.business where id = v_business;

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
    if not exists (select 1 from public.product where id = ln.product_id and is_service) then
      perform 1 from public.inventory
        where product_id = ln.product_id and branch_id = p_branch and stock >= ln.qty;
      if not found then
        raise exception 'stock insuficiente para el producto %', ln.product_id;
      end if;
    end if;
    v_bruto := v_bruto + (ln.qty * ln.price - ln.discount);
  end loop;

  if p_total_disc > v_bruto then
    raise exception 'el descuento total supera el monto de la venta';
  end if;

  v_total  := v_bruto - p_total_disc;
  v_neto   := round(v_total / 1.19);
  v_iva    := v_total - v_neto;
  v_points := floor(v_total * v_multiplier / v_clp_per_point);

  -- Ley 20.956: en efectivo el monto A PAGAR se redondea a la decena (1-5 abajo,
  -- 6-9 arriba). El total (fiscal, para el DTE) NO se redondea. recv-change = pago.
  if p_method = 'efectivo' then
    v_pay    := ((v_total + 4) / 10) * 10;
    v_recv   := p_recv;
    if v_recv < v_pay then
      raise exception 'el efectivo recibido es menor al total a pagar';
    end if;
    v_change := v_recv - v_pay;
  else
    v_recv   := v_total;
    v_change := 0;
  end if;

  v_folio := public.next_folio(p_branch, 'sale');

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
     where product_id = ln.product_id and branch_id = p_branch
       and not exists (select 1 from public.product where id = ln.product_id and is_service);
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

create or replace function public.close_cash_session(p_session uuid, p_counted int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_float int;
  v_business uuid;
  v_cash  int;
  v_card  int;
  v_cash_collected int;
  v_nc_cash int;
  v_nc_card int;
  v_nc_paid int;
  v_rounding int;
  v_expected int;
begin
  select float_amount, business_id into v_float, v_business
    from public.cash_session where id = p_session and status = 'open'
    for update;
  if v_float is null then
    raise exception 'la sesión de caja no existe o ya está cerrada';
  end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  -- Ventas: cash fiscal (total) y cash cobrado (recv-change = redondeado en efectivo).
  select coalesce(sum(total) filter (where method = 'efectivo'), 0),
         coalesce(sum(total) filter (where method = 'tarjeta'), 0),
         coalesce(sum(recv - change) filter (where method = 'efectivo'), 0)
    into v_cash, v_card, v_cash_collected
    from public.sale where cash_session_id = p_session;

  -- Notas de crédito: nc fiscal (total) y nc pagado en efectivo (redondeado a la decena).
  select coalesce(sum(total) filter (where method = 'efectivo'), 0),
         coalesce(sum(total) filter (where method = 'tarjeta'), 0),
         coalesce(sum(((total + 4) / 10) * 10) filter (where method = 'efectivo'), 0)
    into v_nc_cash, v_nc_card, v_nc_paid
    from public.credit_note where cash_session_id = p_session;

  -- Ajuste neto por redondeo (Ley 20.956).
  v_rounding := (v_cash - v_cash_collected) - (v_nc_cash - v_nc_paid);
  v_expected := v_float + v_cash_collected - v_nc_paid;

  update public.cash_session
     set status = 'closed', closed_at = now(), counted = p_counted
   where id = p_session;

  return jsonb_build_object(
    'session_id', p_session,
    'float', v_float,
    'cash', v_cash, 'card', v_card,
    'nc_cash', v_nc_cash, 'nc_card', v_nc_card,
    'rounding', v_rounding,
    'expected_cash', v_expected,
    'counted', p_counted,
    'diff', p_counted - v_expected
  );
end;
$$;
```

- [ ] **Step 2: Recrear la BD local y correr los tests actuales (deben seguir pasando)**

Run: `pnpm db:reset && pnpm test:db`
Expected: PASS (sin regresiones; los tests actuales de `charge_sale`/cierre siguen verdes porque para montos ya múltiplos de 10 el redondeo es identidad, y `recv-change` = `total`).

- [ ] **Step 3: Agregar tests pgTAP del redondeo**

En `supabase/tests/rpc_test.sql`, siguiendo el patrón de setup existente (crear business/branch/cash_session/product como en los tests de `charge_sale` ya presentes — reutilizar el mismo andamiaje), agregar aserciones:

1. **Venta en efectivo redondea, total exacto.** Cobrar una venta cuyo `total` no sea múltiplo de 10 (p. ej. product price que dé total 16191, o construir con líneas que sumen 16191) con `p_method='efectivo'`, `p_recv` suficiente. Verificar:

```sql
-- total fiscal EXACTO (no redondeado)
select is( (select total from public.sale where id = v_sale.id), 16191, 'venta efectivo: total fiscal exacto' );
-- lo cobrado (recv-change) = total redondeado a la decena (16190)
select is( (select recv - change from public.sale where id = v_sale.id), 16190, 'venta efectivo: recv-change = redondeado' );
```

2. **Tarjeta NO redondea.** Misma venta con `p_method='tarjeta'`:

```sql
select is( (select total from public.sale where id = v_sale.id), 16191, 'venta tarjeta: total exacto' );
select is( (select recv - change from public.sale where id = v_sale.id), 16191, 'venta tarjeta: sin redondeo' );
```

3. **Arqueo con redondeo.** Con una o más ventas en efectivo en la sesión, cerrar con `close_cash_session` y verificar la identidad:

```sql
-- v_res := resultado jsonb de close_cash_session(...)
select is( (v_res->>'expected_cash')::int,
           (v_res->>'float')::int + (v_res->>'cash')::int - (v_res->>'nc_cash')::int - (v_res->>'rounding')::int,
           'arqueo: expected = float + cash - nc_cash - rounding' );
```

(Ajustar el `plan(N)` de pgTAP para incluir las nuevas aserciones. Seguir el estilo de declaración de variables y `perform`/`select ... into` del archivo.)

- [ ] **Step 4: Correr los tests de BD**

Run: `pnpm db:reset && pnpm test:db`
Expected: PASS, incluyendo las nuevas aserciones.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260719120000_cash_rounding_ley20956.sql supabase/tests/rpc_test.sql
git commit -m "feat(caja): redondeo Ley 20.956 en _register_sale y arqueo de close_cash_session"
```

---

### Task 3: `escpos.rs` — ticket de venta/NC y comprobante de cierre

**Files:**
- Modify: `src-tauri/src/escpos.rs` (structs + `build`, `build_credit_note`, `build_cierre`, tests)

**Interfaces:**
- Produces: `ReceiptPayload` gana `recv: i64`, `change: i64`; `CierrePayload` gana `rounding: i64`. Bloques de efectivo/redondeo en los tres tickets.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar en `mod tests` de `src-tauri/src/escpos.rs` (usa `sample`, `sample_cierre`, `sample_nc`, `contains`, `build`, `build_cierre`, `build_credit_note`):

```rust
    #[test]
    fn boleta_efectivo_muestra_redondeo_y_vuelto() {
        let mut p = sample("efectivo", true);
        p.total = 16191; p.neto = 13606; p.iva = 2585;
        p.recv = 20000; p.change = 3810; // paga 16190 (redondeado), vuelto 3810
        let b = build(&p);
        assert!(contains(&b, b"Total a pagar"));
        assert!(contains(&b, b"Paga con"));
        assert!(contains(&b, b"Vuelto"));
        assert!(contains(&b, b"Redondeo"));
        // el TOTAL fiscal exacto sigue presente
        assert!(contains(&b, b"16.191"));
    }

    #[test]
    fn boleta_tarjeta_no_muestra_bloque_efectivo() {
        let mut p = sample("tarjeta", false);
        p.recv = 0; p.change = 0;
        let b = build(&p);
        assert!(!contains(&b, b"Paga con"));
    }

    #[test]
    fn cierre_muestra_ajuste_por_redondeo() {
        let mut p = sample_cierre(192282);
        p.rounding = 18;
        let b = build_cierre(&p);
        assert!(contains(&b, b"Ajuste por redondeo"));
    }
```

(Para la NC en efectivo, `sample_nc` usa `metodo: "efectivo"`; agregar:)

```rust
    #[test]
    fn nc_efectivo_muestra_redondeo() {
        let mut p = sample_nc();
        p.total = 9991; p.neto = 8396; p.iva = 1595; p.metodo = "efectivo".into();
        let b = build_credit_note(&p);
        assert!(contains(&b, b"Efectivo devuelto"));
        assert!(contains(&b, b"9.991")); // DEVOLUCION fiscal exacta
    }
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd src-tauri && cargo test escpos::tests::boleta_efectivo escpos::tests::cierre_muestra escpos::tests::nc_efectivo escpos::tests::boleta_tarjeta`
Expected: FAIL (campos `recv`/`change`/`rounding` no existen aún; textos ausentes).

- [ ] **Step 3: Agregar los campos a los structs y a los `sample`**

En `ReceiptPayload` (struct), agregar tras `pub total: i64`:

```rust
    #[serde(default)] pub recv: i64,
    #[serde(default)] pub change: i64,
```

En `CierrePayload`, agregar tras `pub nc_card: i64,`:

```rust
    #[serde(default)] pub rounding: i64,
```

En el helper de test `sample(...)` (dentro de `mod tests`), agregar `recv: 0, change: 0,` al construir `ReceiptPayload`. En `sample_cierre(...)`, agregar `rounding: 0,`.

- [ ] **Step 4: Implementar el bloque de efectivo en `build()`**

En `build()`, JUSTO DESPUÉS del bloque del TOTAL en doble tamaño y su `nl`, y ANTES de `line_lr(&mut b, "Forma de pago", ...)`, insertar:

```rust
    // Ley 20.956: en efectivo, el monto a pagar se redondea a la decena. El TOTAL
    // fiscal (arriba) NO cambia; acá se muestra el redondeo, lo pagado y el vuelto.
    if p.metodo == "efectivo" && p.recv > 0 {
        let pagado = p.recv - p.change; // = total redondeado
        let redondeo = p.total - pagado;
        if redondeo != 0 {
            line_lr(&mut b, "Redondeo", &format!("-{}", money(redondeo)), COL);
        }
        line_lr(&mut b, "Total a pagar", &money(pagado), COL);
        line_lr(&mut b, "Paga con", &money(p.recv), COL);
        line_lr(&mut b, "Vuelto", &money(p.change), COL);
    }
```

- [ ] **Step 5: Implementar el bloque de efectivo en `build_credit_note()`**

En `build_credit_note()`, después de `line_lr(&mut b, "Medio de devolucion", &metodo_label(&p.metodo), COL);` y antes de `rule(&mut b, b'-');`, insertar:

```rust
    // Ley 20.956: la devolución en efectivo se paga redondeada a la decena; la
    // DEVOLUCION (fiscal) de arriba NO cambia.
    if p.metodo == "efectivo" {
        let round = ((p.total + 4) / 10) * 10;
        if p.total != round {
            line_lr(&mut b, "Redondeo", &format!("-{}", money(p.total - round)), COL);
        }
        line_lr(&mut b, "Efectivo devuelto", &money(round), COL);
    }
```

- [ ] **Step 6: Ajustar `build_cierre()` (esperado + línea de ajuste)**

En `build_cierre()`, cambiar la línea del esperado:

```rust
    let esperado = p.fondo + p.cash - p.nc_cash;
```

por:

```rust
    let esperado = p.fondo + p.cash - p.nc_cash - p.rounding;
```

Y en el bloque de arqueo, después de la línea de `"Reversos tarjeta"` (o de `"Notas de credito (efectivo)"`) y antes de `line_lr(&mut b, "Esperado en caja", ...)`, insertar:

```rust
    if p.rounding != 0 {
        line_lr(&mut b, "Ajuste por redondeo", &format!("-{}", money(p.rounding)), COL);
    }
```

- [ ] **Step 7: Correr todos los tests de escpos**

Run: `cd src-tauri && cargo test escpos`
Expected: PASS (nuevos + existentes; los tests que construyen `ReceiptPayload`/`CierrePayload` compilan por los `#[serde(default)]` y los `sample` actualizados).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/escpos.rs
git commit -m "feat(escpos): mostrar redondeo/efectivo/vuelto en ticket, NC y cierre"
```

---

### Task 4: `PayDialog` — mostrar el redondeo en efectivo

**Files:**
- Modify: `src/modules/venta/PayDialog.tsx`

**Interfaces:**
- Consumes: `roundCashCLP` (Task 1).

- [ ] **Step 1: Importar el helper y calcular el total a pagar**

En `src/modules/venta/PayDialog.tsx`, agregar `roundCashCLP` al import de `@/lib/money`:

```ts
import { fmtCLP, resolveDiscount, roundCashCLP } from "@/lib/money";
```

Reemplazar el cálculo actual de `recv`/`change`/`canConfirm`:

```ts
  const recv = method === "efectivo" ? Number(cashStr) || 0 : effectiveTotal;
  const change = recv - effectiveTotal;
  const canConfirm = method === "tarjeta" || recv >= effectiveTotal;
```

por (redondeo solo en efectivo):

```ts
  const payTotal = method === "efectivo" ? roundCashCLP(effectiveTotal) : effectiveTotal;
  const recv = method === "efectivo" ? Number(cashStr) || 0 : effectiveTotal;
  const change = recv - payTotal;
  const canConfirm = method === "tarjeta" || recv >= payTotal;
```

- [ ] **Step 2: Mostrar la línea de redondeo / total a pagar**

Debajo del recuadro "Total a cobrar" (el que muestra `fmtCLP(effectiveTotal)`), agregar, solo cuando hay redondeo en efectivo:

```tsx
          {method === "efectivo" && payTotal !== effectiveTotal && (
            <div className="mt-2 flex items-baseline justify-between px-1 text-[13px] font-bold text-[#556A7C]">
              <span>Redondeo (efectivo) · Total a pagar</span>
              <span>{fmtCLP(payTotal)}</span>
            </div>
          )}
```

(El "Total a cobrar" grande sigue mostrando `effectiveTotal` = monto fiscal; el vuelto ya se calcula sobre `payTotal` por el Step 1.)

- [ ] **Step 3: Verificar build + tests**

Run: `pnpm build`
Expected: compila.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/venta/PayDialog.tsx
git commit -m "feat(venta): PayDialog muestra el redondeo y vuelto sobre el total a pagar en efectivo"
```

---

### Task 5: Cablear datos — `recv`/`change` en tickets y `rounding` en el cierre

**Files:**
- Modify: `src/data/sales.ts` (`SaleDteRow` + `select`)
- Modify: `src/data/salesHistory.ts` (`SaleHistoryRow` + `select`)
- Modify: `src/data/cash.ts` (`CierreResumen`)
- Modify: `src/modules/venta/VentaScreen.tsx` (payload venta en vivo + reimpresión)
- Modify: `src/modules/historial/HistorialScreen.tsx` (payload reimpresión)
- Modify: `src/modules/cierre/CierrePanel.tsx` (mostrar ajuste + pasar `rounding`)

**Interfaces:**
- Consumes: `sale.recv`/`sale.change` (ya en `Sale`), el campo `rounding` del JSON de `close_cash_session` (Task 2), y los campos `recv`/`change`/`rounding` del payload de escpos (Task 3).

- [ ] **Step 1: `CierreResumen` gana `rounding`**

En `src/data/cash.ts`, en `interface CierreResumen`, agregar tras `nc_card: number;`:

```ts
  rounding: number;
```

- [ ] **Step 2: `SaleDteRow` y `SaleHistoryRow` ganan `recv`/`change`**

En `src/data/sales.ts`, en `interface SaleDteRow` agregar `recv: number; change: number;`; en el `select(...)` de `useSalesTodayDte` agregar `recv,change`; en el `.map(...)` agregar `recv: s.recv ?? 0, change: s.change ?? 0,`.

En `src/data/salesHistory.ts`, en `interface SaleHistoryRow` agregar `recv: number; change: number;`; en su `select(...)` agregar `recv,change`; en el `.map(...)` agregar `recv: s.recv ?? 0, change: s.change ?? 0,`.

- [ ] **Step 3: Pasar `recv`/`change` en los payloads de impresión de VentaScreen**

En `src/modules/venta/VentaScreen.tsx`, en el payload de la **venta en vivo** (donde se arma con `sale.total`, ~línea 442), agregar:

```ts
            recv: sale.recv,
            change: sale.change,
```

En el payload de **reimpresión** (`reimprimirBoleta(h: SaleDteRow)`, donde está `total: h.total`), agregar:

```ts
      recv: h.recv,
      change: h.change,
```

- [ ] **Step 4: Pasar `recv`/`change` en el payload de HistorialScreen**

En `src/modules/historial/HistorialScreen.tsx`, en `reimprimirBoleta(row)`, junto a `total: row.total`, agregar:

```ts
      recv: row.recv,
      change: row.change,
```

- [ ] **Step 5: `CierrePanel` muestra el ajuste y lo pasa al ticket**

En `src/modules/cierre/CierrePanel.tsx`:
- En el bloque de arqueo, después de la fila "Notas de crédito (efectivo)" y antes de "Esperado en caja", agregar (solo si `resumen.rounding !== 0`):

```tsx
                {resumen.rounding !== 0 && (
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span>Ajuste por redondeo</span>
                    <span>-{fmtCLP(resumen.rounding)}</span>
                  </div>
                )}
```

- En el objeto que se pasa a `printCierre({...})` (donde están `cash: r.cash`, `nc_cash: r.nc_cash`, etc.), agregar:

```ts
          rounding: r.rounding,
```

- [ ] **Step 6: Verificar build + tests**

Run: `pnpm build`
Expected: compila (los nuevos campos de `SaleDteRow`/`SaleHistoryRow`/`CierreResumen` resuelven).

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/sales.ts src/data/salesHistory.ts src/data/cash.ts src/modules/venta/VentaScreen.tsx src/modules/historial/HistorialScreen.tsx src/modules/cierre/CierrePanel.tsx
git commit -m "feat(caja): cablear recv/change en tickets y ajuste por redondeo en el cierre"
```

---

## Notas de verificación final

- `pnpm db:reset && pnpm test:db` (redondeo en efectivo, tarjeta sin redondeo, identidad del arqueo).
- `cd src-tauri && cargo test escpos` (bloques de efectivo/redondeo/ajuste; TOTAL/DEVOLUCION fiscales intactos).
- `pnpm build` y `pnpm test` verdes.
- Manejo real / demo opcional: cobro en efectivo con monto no múltiplo de 10 → ticket muestra Redondeo/Total a pagar/Paga con/Vuelto y el TOTAL fiscal exacto; cierre muestra "Ajuste por redondeo" y cuadra.
- **Producción:** aplicar la migración `20260719120000_cash_rounding_ley20956.sql` a Supabase producción como paso aparte, con OK del usuario (los cambios de frontend/escpos no sirven sin la migración, y viceversa la migración es retrocompatible con el frontend actual porque solo agrega un campo al JSON y ajusta recv/change).
