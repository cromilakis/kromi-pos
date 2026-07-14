# Productos tipo "servicio" (sin stock) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear/editar y vender productos tipo "servicio" (sin stock, a pedido del cliente), como "Visita domiciliaria" a $20.000.

**Architecture:** Bandera `product.is_service` en la base. La RPC `_register_sale` salta validación y descuento de `inventory` para líneas de servicio. El frontend (data, formulario, stock, venta) trata a los servicios como disponibilidad ilimitada y los muestra como "Servicio".

**Tech Stack:** Postgres/Supabase (migraciones SQL + tests psql), React + TypeScript + Vite, Vitest.

## Global Constraints

- Prosa en español; identificadores/claves/flags en inglés.
- Firma de commits: `Cromilakis <ipcromilakis@gmail.com>` (autor y committer). PROHIBIDO `Co-Authored-By` y atribuciones a Claude.
- Externalizar/consistencia de textos de UI; no romper patrones existentes.
- La firma de `charge_sale` NO cambia (sigue con `p_discount_id`). Solo cambia el cuerpo de `_register_sale`.
- Rama de trabajo: `feature/notas-credito`.

---

### Task 1: Migración DB — columna `is_service` + `_register_sale` salta stock

**Files:**
- Create: `supabase/migrations/20260714160000_product_service.sql`
- Modify (test): `supabase/tests/rpc_test.sql` (agregar bloque al final, antes del `rollback;`)

**Interfaces:**
- Produces: columna `public.product.is_service boolean not null default false`; `_register_sale` recreada con misma firma `(uuid, uuid, jsonb, public.sale_method, int, uuid, int)`.
- Consumes: cuerpo vigente de `_register_sale` en `supabase/migrations/20260714130000_rename_functions_english.sql:31-145`.

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/20260714160000_product_service.sql`:

```sql
-- ============================================================================
-- Migración: producto tipo "servicio" (sin stock).
-- Depende de: 20260714130000_rename_functions_english.sql (_register_sale)
-- Agrega product.is_service y recrea _register_sale para que las líneas de
-- servicio NO validen ni descuenten inventory. Firma de _register_sale sin cambios.
-- ============================================================================

alter table public.product
  add column if not exists is_service boolean not null default false;

-- _register_sale ← cuerpo vigente de
-- supabase/migrations/20260714130000_rename_functions_english.sql:31-145
-- Cambios: la validación de stock (loop 1) y el descuento de inventory (loop 2)
-- se saltan cuando el producto es servicio (is_service = true).
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
  v_business uuid;
  v_bruto    int := 0;
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
    -- Servicios: no rastrean stock, no se valida inventory.
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
  v_points := floor(v_total / 1000);
  v_recv   := case when p_method = 'efectivo' then p_recv else v_total end;
  if p_method = 'efectivo' and v_recv < v_total then
    raise exception 'el efectivo recibido es menor al total';
  end if;
  v_change := v_recv - v_total;

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

    -- Servicios: no descuentan inventory (no tienen fila). Guarda explícita.
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
```

- [ ] **Step 2: Escribir el test de RPC (falla primero)**

En `supabase/tests/rpc_test.sql`, justo ANTES de la línea `rollback;` final, agregar:

```sql
-- charge_sale: un servicio (is_service) se vende sin inventory y no descuenta stock
do $$
declare v_session uuid; v_sale public.sale; v_svc uuid := '11111111-0000-0000-0000-000000000001';
begin
  insert into public.product (id, business_id, name, category_id, price, is_service) values
    (v_svc,'aaaaaaaa-0000-0000-0000-000000000001','Visita domiciliaria',
     'dddddddd-0000-0000-0000-000000000001',20000,true);
  -- NO se inserta fila en inventory para el servicio.
  v_sale := public.charge_sale(
    'bbbbbbbb-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
    '[{"product_id":"11111111-0000-0000-0000-000000000001","qty":1}]'::jsonb,
    'efectivo', 20000, null);
  if v_sale.total <> 20000 then raise exception 'servicio: total incorrecto: %', v_sale.total; end if;
  if not exists (select 1 from public.sale_line where sale_id = v_sale.id and product_id = v_svc) then
    raise exception 'servicio: no se registró la línea';
  end if;
  if exists (select 1 from public.inventory where product_id = v_svc) then
    raise exception 'servicio: no debe tener fila de inventory';
  end if;
end $$;
```

- [ ] **Step 3: Correr el test contra el esquema viejo para verlo fallar**

Run: `pnpm test:db`
Expected: FAIL — el bloque nuevo lanza `stock insuficiente para el producto 11111111-...` (porque el esquema actual aún exige inventory; además `is_service` no existe → error de columna). Confirma que el test ejercita el caso.

- [ ] **Step 4: Aplicar la migración**

Run: `pnpm db:reset`
Expected: recrea la base con la nueva migración sin errores.

- [ ] **Step 5: Correr los tests de DB (pasan)**

Run: `pnpm test:db`
Expected: PASS (schema + rpc + rls). El bloque de servicio no lanza excepción.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260714160000_product_service.sql supabase/tests/rpc_test.sql
git commit -m "feat(db): product.is_service + _register_sale salta stock en servicios"
```

---

### Task 2: Capa de datos frontend — `is_service` en `stock.ts`

**Files:**
- Modify: `src/data/stock.ts`
- Test: `src/data/stock.test.ts`

**Interfaces:**
- Produces: `ProductRow.is_service: boolean`; `createProduct`/`updateProduct` aceptan `is_service`.
- Consumes: nada nuevo.

- [ ] **Step 1: Actualizar el test (falla primero)**

En `src/data/stock.test.ts`, reemplazar el helper `p(...)` para incluir `is_service` y agregar un caso. Cambiar la función `p` (líneas 13-15) por:

```ts
function p(id: string, barcode: string | null): ProductRow {
  return { id, name: id, category_id: null, price: 0, min_stock: 0, critical: false, img_url: null, supplier_id: null, internal_code: null, barcode, discount_pct: 0, stock: 0, is_service: false };
}
```

Y agregar dentro de `describe("mapProductsWithStock", ...)` un caso:

```ts
  it("propaga is_service", () => {
    const products = [{ id: "s1", name: "Visita", category_id: null, price: 20000, min_stock: 0, critical: false, img_url: null, supplier_id: null, internal_code: null, barcode: null, discount_pct: 0, is_service: true }];
    expect(mapProductsWithStock(products as any, [] as any)[0].is_service).toBe(true);
  });
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm test -- src/data/stock.test.ts`
Expected: FAIL — TypeScript: `is_service` no existe en `ProductRow`.

- [ ] **Step 3: Implementar en `stock.ts`**

En `src/data/stock.ts`:

1. En `interface ProductRow` (después de `stock: number;`) agregar:
```ts
  is_service: boolean;
```

2. En `useProductsWithStock`, cambiar el `.select(...)` de `product` para incluir `is_service`:
```ts
          .select("id,name,category_id,price,min_stock,critical,img_url,supplier_id,internal_code,barcode,discount_pct,is_service")
```

3. En `mapProductsWithStock`, la firma usa `Omit<ProductRow, "stock">`, así que `is_service` ya viaja en `...p`. No requiere cambio de cuerpo.

4. En `createProduct`, agregar `is_service: boolean;` al tipo de `input` (después de `discount_pct: number;`).

5. En `updateProduct`, agregar `is_service: boolean;` al objeto `Partial<{...}>` (después de `discount_pct: number;`).

- [ ] **Step 4: Correr el test (pasa)**

Run: `pnpm test -- src/data/stock.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc -b`
Expected: `No errors found` (ProductForm aún compila porque `is_service` es opcional en llamadas hasta Task 3; si tsc marca falta de `is_service` en ProductForm, se resuelve en Task 3 — en ese caso, avanzar a Task 3 antes de commitear).

- [ ] **Step 6: Commit**

```bash
git add src/data/stock.ts src/data/stock.test.ts
git commit -m "feat(stock): is_service en ProductRow y create/updateProduct"
```

---

### Task 3: Formulario de producto — toggle "Es un servicio"

**Files:**
- Modify: `src/modules/stock/ProductForm.tsx`

**Interfaces:**
- Consumes: `ProductRow.is_service`, `createProduct`/`updateProduct` con `is_service` (Task 2).
- Produces: al guardar servicio, no llama `upsertInventory`.

- [ ] **Step 1: Estado y carga**

En `ProductForm.tsx`, agregar estado (después de `const [discountPct, setDiscountPct] = useState("");`):

```tsx
  const [isService, setIsService] = useState(false);
```

En el `useEffect`, rama `if (product)` agregar `setIsService(product.is_service);` y en la rama `else` agregar `setIsService(false);`.

- [ ] **Step 2: Persistir `is_service` y saltar inventory**

En `save()`:

1. En el objeto de `createProduct({...})` agregar `is_service: isService,` (después de `discount_pct: discountNum,`), y reemplazar `await upsertInventory(created.id, branchId, stockNum);` por:
```tsx
        if (!isService) await upsertInventory(created.id, branchId, stockNum);
```

2. En el objeto de `updateProduct(product.id, {...})` agregar `is_service: isService,` (después de `discount_pct: discountNum,`), y reemplazar `await upsertInventory(product.id, branchId, stockNum);` por:
```tsx
        if (!isService) await upsertInventory(product.id, branchId, stockNum);
```

- [ ] **Step 3: UI del toggle + ocultar campos de stock**

En el JSX, justo después del `<div style={{ gridColumn: "1 / -1" }}>` del **Nombre del producto** (cierra en línea ~149), insertar el toggle de servicio:

```tsx
          <div
            onClick={() => setIsService((s) => !s)}
            style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", border: "1px solid #E1E5EE", borderRadius: 12, padding: "11px 14px", gridColumn: "1 / -1" }}
          >
            <span
              style={{
                width: 20, height: 20, borderRadius: 6,
                border: isService ? "0" : "1px solid #cdd5e3",
                background: isService ? "var(--brand)" : "#fff",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none",
              }}
            >
              {isService ? "✓" : ""}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0F2A1B" }}>Es un servicio (a pedido, sin stock)</div>
              <div style={{ fontSize: 12, color: "#556A7C" }}>Los servicios no llevan inventario: se pueden vender siempre (ej. Visita domiciliaria).</div>
            </div>
          </div>
```

Envolver los campos **Stock**, **Stock mínimo** y **Producto crítico** para que no se muestren cuando `isService`:

- Envolver el `<div>` de "Stock (unidades)" (líneas ~176-179) así: `{!isService && (<div> ... </div>)}`.
- Envolver el `<div>` de "Stock mínimo (opcional)" (líneas ~180-183) así: `{!isService && (<div> ... </div>)}`.
- Envolver el `<div onClick={() => setCritical(...)}>` de "Producto crítico" (líneas ~195-220) así: `{!isService && (<div ...> ... </div>)}`.

- [ ] **Step 4: Typecheck + verificación visual**

Run: `pnpm exec tsc -b`
Expected: `No errors found`.

Verificación manual (app ya corriendo con HMR): Stock → Agregar producto → activar "Es un servicio"; confirmar que desaparecen Stock, Stock mínimo y Producto crítico. Guardar un servicio de prueba y confirmar que se crea sin fila de inventory.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock/ProductForm.tsx
git commit -m "feat(stock): toggle 'Es un servicio' en el formulario de producto"
```

---

### Task 4: Pantalla de stock — etiqueta "Servicio" y sin ajuste de stock

**Files:**
- Modify: `src/modules/stock/StockScreen.tsx`

**Interfaces:**
- Consumes: `ProductRow.is_service`.

- [ ] **Step 1: Excluir servicios de "stock bajo"**

En `StockScreen.tsx`, cambiar `isLowStock` (líneas 16-18) por:

```tsx
function isLowStock(p: ProductRow): boolean {
  if (p.is_service) return false;
  return p.min_stock > 0 && p.stock <= p.min_stock;
}
```

- [ ] **Step 2: Vista tabla — celda de stock y acciones**

En la vista tabla, reemplazar la celda de stock (línea 497):

```tsx
                    <td className="px-4 py-2 text-right font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                      {p.is_service ? <span className="text-[12px] font-bold text-[#556A7C]">Servicio</span> : p.stock}
                    </td>
```

Y en la celda de acciones (dentro del `<div className="flex items-center justify-end gap-1.5">`, líneas 500-505), envolver los dos botones de ajuste para ocultarlos en servicios:

```tsx
                          {!p.is_service && (
                            <>
                              <button onClick={() => adjustStock(p, -1)} title="Restar 1" className="flex size-[28px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[17px] text-[#556A7C]">–</button>
                              <button onClick={() => adjustStock(p, 1)} title="Sumar 1" className="flex size-[28px] items-center justify-center rounded-[9px] bg-[#D3F4E0] text-[17px]" style={{ color: "var(--brand)" }}>+</button>
                            </>
                          )}
```

(Los botones ✎ Editar y 🗑 Eliminar se mantienen fuera de esa condición.)

- [ ] **Step 3: Vista bloques — mostrar "Servicio"**

En la vista bloques, el bloque `canManage ? (...) : (...)` (líneas 551-603). Reemplazar el contenido de la sección de stock para servicios. Envolver el grupo de ajuste `+/-` (líneas 572-589, el `<div className="flex items-center gap-2">`) con `!p.is_service && (...)` y, cuando sea servicio, mostrar una etiqueta. La forma más simple: dentro de la rama `canManage`, reemplazar el segundo `<div className="flex items-center gap-2">...</div>` por:

```tsx
                        {p.is_service ? (
                          <span className="rounded-full bg-[#EEF1F6] px-2.5 py-1 text-[12px] font-bold text-[#556A7C]">Servicio</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => adjustStock(p, -1)}
                              className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[18px] text-[#556A7C]"
                            >
                              –
                            </button>
                            <span className="min-w-[24px] text-center text-[15px] font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                              {p.stock}
                            </span>
                            <button
                              onClick={() => adjustStock(p, 1)}
                              className="flex size-[30px] items-center justify-center rounded-[9px] bg-[#D3F4E0] text-[18px]"
                              style={{ color: "var(--brand)" }}
                            >
                              +
                            </button>
                          </div>
                        )}
```

Y en la rama `else` (no `canManage`, líneas 592-602), reemplazar el bloque de stock por:

```tsx
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {p.is_service ? (
                          <span className="text-[11.5px] font-bold text-[#556A7C]">Servicio</span>
                        ) : (
                          <>
                            <span className="text-[11.5px] font-bold" style={{ color: low ? "#D02E2E" : "#5E6E7E" }}>
                              {low ? "Stock bajo" : "Stock"}
                            </span>
                            <span className="flex items-baseline gap-1">
                              <span className="text-[15px] font-black" style={{ color: low ? "#D02E2E" : "#0F2A1B" }}>
                                {p.stock}
                              </span>
                              <span className="text-xs font-semibold text-[#5E6E7E]">u.</span>
                            </span>
                          </>
                        )}
                      </div>
```

- [ ] **Step 4: Typecheck + verificación visual**

Run: `pnpm exec tsc -b`
Expected: `No errors found`.

Verificación manual: en Stock, un servicio muestra "Servicio" (tabla y bloques) sin botones `+/-`, y no aparece en la alerta de stock crítico.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock/StockScreen.tsx
git commit -m "feat(stock): servicios se muestran como 'Servicio' sin ajuste de stock"
```

---

### Task 5: Pantalla de venta — servicios con disponibilidad ilimitada

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`

**Interfaces:**
- Consumes: `ProductRow.is_service`.

- [ ] **Step 1: Helper de capacidad**

En `VentaScreen.tsx`, agregar un helper junto a `inCart`/`avail` (líneas 151-156). Reemplazar `avail` por:

```tsx
  function capacity(p: ProductRow): number {
    return p.is_service ? Infinity : p.stock;
  }
  function avail(p: ProductRow): number {
    return capacity(p) - inCart(p.id);
  }
```

- [ ] **Step 2: Usar capacity en incCart y addToCartQty**

- En `incCart` (línea 192), cambiar `if (!p || c[i].qty + 1 > p.stock) return c;` por:
```tsx
      if (!p || c[i].qty + 1 > capacity(p)) return c;
```
- En `addToCartQty` (línea 220), cambiar `const next = Math.min(current + qty, p.stock);` por:
```tsx
    const next = Math.min(current + qty, capacity(p));
```

- [ ] **Step 3: resumeHeld respeta servicios**

En `resumeHeld` (línea 271), cambiar `const qty = Math.min(item.qty, p.stock);` por:

```tsx
      const qty = Math.min(item.qty, p.is_service ? item.qty : p.stock);
```

- [ ] **Step 4: Botón + del carrito y etiqueta de disponibilidad**

- En el botón `+` del carrito (línea 560), cambiar `disabled={qty >= product.stock}` por:
```tsx
disabled={qty >= capacity(product)}
```
- En la tarjeta del producto (línea 660-662), cambiar la etiqueta:
```tsx
                          <span className="text-xs font-bold" style={{ color: disabled ? "#D02E2E" : "#556A7C" }}>
                            {p.is_service ? "Servicio" : disabled ? "Sin stock" : `${available} disp.`}
                          </span>
```

- [ ] **Step 5: Typecheck + verificación visual**

Run: `pnpm exec tsc -b`
Expected: `No errors found`.

Verificación manual: en Venta, la tarjeta del servicio muestra "Servicio", nunca "Sin stock"; se puede agregar varias veces sin toparse; el cobro se completa y la venta queda registrada.

- [ ] **Step 6: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
git commit -m "feat(venta): servicios con disponibilidad ilimitada"
```

---

### Task 6: Crear el servicio "Visita domiciliaria" ($20.000)

**Files:** ninguno (dato real, vía la app).

- [ ] **Step 1: Crear el servicio desde la app**

Con la app corriendo, ir a Stock → Agregar producto: nombre "Visita domiciliaria", precio 20000, activar "Es un servicio", categoría a elección. Guardar.

- [ ] **Step 2: Verificar de punta a punta**

- En Stock aparece "Visita domiciliaria" con etiqueta "Servicio".
- En Venta aparece con "Servicio"; agregar 2 unidades y cobrar.
- Confirmar en Historial/Ventas del día que la venta quedó registrada con el monto correcto y que ningún inventario se alteró por el servicio.

- [ ] **Step 3: (Opcional) Registrar en memoria del proyecto**

Si procede, dejar una nota de que existe el tipo "servicio" y el dato "Visita domiciliaria".

---

## Notas de ejecución

- Requiere Supabase local (Docker) corriendo para `pnpm db:reset` y `pnpm test:db`.
- `schema_test.sql` NO valida la lista de columnas de `product` (solo verifica que la tabla exista e inserta usando defaults), así que agregar `is_service` no lo rompe. Confirmado el 2026-07-14.
