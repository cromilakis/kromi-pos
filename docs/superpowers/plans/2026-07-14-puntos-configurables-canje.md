# Puntos configurables + canje (F-A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer configurable la acumulación de puntos (tasa + multiplicador) y permitir canjearlos como descuento directo sobre el total de la boleta, reflejado en el comprobante impreso y en el DTE 39.

**Architecture:** Config de puntos en `business` (3 columnas). `_register_sale` calcula puntos con la tasa/multiplicador del negocio. `charge_sale` gana `p_points_redeem`: valida cliente+saldo, aplica el canje como descuento sobre el total (excluyente con descuento comercial), resta puntos y persiste `sale.points_redeemed/points_discount`. El descuento global (comercial o canje) se emite en el DTE como `DscRcgGlobal[]` (arregla un hueco preexistente) y se imprime como línea "Canje de puntos".

**Tech Stack:** Postgres/Supabase (migraciones SQL + tests psql), Deno edge function (issue-receipt), Rust (src-tauri/escpos.rs), React + TypeScript + Vite, Vitest.

## Global Constraints

- Prosa/UI en español; identificadores/claves/flags en inglés.
- Commits firmados SOLO como `Cromilakis <ipcromilakis@gmail.com>` (autor y committer). PROHIBIDO `Co-Authored-By` y atribuciones a Claude/Anthropic. Usar `git -c user.name=... -c user.email=... commit --author=...`.
- NUNCA `git add -A`; agregar solo los archivos tocados.
- La acumulación sigue aplicando solo con cliente (`p_customer is not null`).
- Canje **mutuamente excluyente** con `p_discount_id`/`p_total_disc`: si `p_points_redeem > 0` llega junto a un descuento comercial → excepción explícita.
- No editar migraciones históricas; migración nueva aditiva.
- Deploys a cloud (`supabase db push`, `functions deploy`) y verificación e2e que consuma folios SII → SOLO con confirmación del usuario.
- Rama de trabajo: `feature/notas-credito`. Supabase local (Docker `supabase_db_kromi-pos`) arriba.

## Referencias de código (verificadas)
- `_register_sale` cuerpo vigente: `supabase/migrations/20260714160000_product_service.sql` (función redefinida; acumulación hardcodeada `v_points := floor(v_total/1000)`).
- `charge_sale` cuerpo vigente (firma 8 args): `supabase/migrations/20260714150000_charge_sale_discount_id.sql` (drop firma + create + grant; exclusión mutua `p_discount_id` vs `p_total_disc`).
- `customer.points` + check `>= 0`: `supabase/migrations/20260707100000_catalog.sql:175`. Tabla `business`: líneas 42-59 (sin columnas de puntos).
- Edge boleta: `supabase/functions/issue-receipt/index.ts` (select :52-56 NO trae `sale.discount_amount`; Detalle con `DescuentoMonto` por línea :64-81; body :82-93).
- ESC/POS: `src-tauri/src/escpos.rs` (`ReceiptPayload` :21-37, `Item` :19, render totales :290-300; `sample()` de tests ~:595-612). Comando `print_receipt` en `src-tauri/src/lib.rs:11-20`.
- PayDialog: `src/modules/venta/PayDialog.tsx` (props :7-14, cálculo :32-38, selector descuento :73-89, confirm :160).
- VentaScreen: `handleConfirmPay` :345; chargeSale :349-357; render PayDialog :691; `selectedCustomer` :105 (CustomerRow trae `points`); payload impresión emisión :391-406 y reimpresión :322-337.
- `chargeSale`/`Sale`: `src/data/sales.ts:75-112`. Business: `src/data/business.ts` (`BusinessRow` :4-16, `COLS` :18, `updateBusiness` :32-35). Admin tabs: `src/modules/admin/AdminScreen.tsx`; patrón form: `DiscountsSettings.tsx`.

---

### Task 1: Migración DB — config de puntos, acumulación configurable, canje

**Files:**
- Create: `supabase/migrations/20260714180000_points_config_redeem.sql`
- Modify (test): `supabase/tests/rpc_test.sql`; `supabase/tests/schema_test.sql` (solo si valida columnas de business/sale — verificar; hoy NO valida product, revisar business/sale)

**Interfaces:**
- Produces: columnas `business.points_clp_per_point`, `business.points_multiplier`, `business.points_redeem_clp_per_point`; `sale.points_redeemed`, `sale.points_discount`; `charge_sale` con 9º parámetro `p_points_redeem int default 0`.
- Consumes: cuerpos vigentes de `_register_sale` (`20260714160000`) y `charge_sale` (`20260714150000`).

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260714180000_points_config_redeem.sql` con:

1. Columnas de config en `business`:
```sql
alter table public.business
  add column if not exists points_clp_per_point        int not null default 1000 check (points_clp_per_point > 0),
  add column if not exists points_multiplier           int not null default 1    check (points_multiplier >= 1),
  add column if not exists points_redeem_clp_per_point  int not null default 1    check (points_redeem_clp_per_point > 0);
```

2. Columnas de canje en `sale`:
```sql
alter table public.sale
  add column if not exists points_redeemed int not null default 0 check (points_redeemed >= 0),
  add column if not exists points_discount int not null default 0 check (points_discount >= 0);
```

3. Recrear `_register_sale` (base: cuerpo vigente en `20260714160000_product_service.sql`, COPIAR VERBATIM salvo los deltas):
   - Agregar declaraciones: `v_clp_per_point int; v_multiplier int;`.
   - Tras obtener `v_business` (del `cash_session`), leer la config:
     ```sql
     select points_clp_per_point, points_multiplier
       into v_clp_per_point, v_multiplier
       from public.business where id = v_business;
     ```
   - Reemplazar `v_points := floor(v_total / 1000);` por:
     ```sql
     v_points := floor(v_total * v_multiplier / v_clp_per_point);
     ```
   - **Todo lo demás idéntico** (validación stock/servicios, inserts, update de puntos del cliente `points = points + v_points`, etc.). Mantener firma, `security definer`, `set search_path=''`.
   - Nota: `p_total_disc` (que ahora también transporta el monto del canje, ver charge_sale) ya baja `v_total`, así que los puntos se acumulan sobre el total final. Correcto.

4. Recrear `charge_sale` (base: `20260714150000_charge_sale_discount_id.sql`, `drop function` de la firma de 8 args + `create` con 9 + `grant`). Delta:
   - Nueva firma: agregar `p_points_redeem int default 0` como 9º parámetro.
   - Declarar `v_points_disc int := 0; v_cust_points int; v_redeem_rate int;`.
   - **Exclusión mutua** (tras validar caja y líneas): si `p_points_redeem > 0` y (`p_discount_id is not null` o (`v_tvalue > 0 and v_tkind is not null`)) → `raise exception 'el canje de puntos no se puede combinar con otro descuento';`.
   - Si `p_points_redeem > 0`:
     ```sql
     if p_customer is null then
       raise exception 'el canje de puntos requiere un cliente identificado';
     end if;
     select points into v_cust_points from public.customer where id = p_customer;
     if v_cust_points is null or v_cust_points < p_points_redeem then
       raise exception 'el cliente no tiene puntos suficientes';
     end if;
     select points_redeem_clp_per_point into v_redeem_rate from public.business where id = v_business;
     v_points_disc := least(v_bruto, p_points_redeem * v_redeem_rate);
     ```
   - Usar `v_points_disc` como el descuento total que se pasa a `_register_sale` cuando hay canje (es decir, `v_tot_disc := v_points_disc` en la rama de canje). El resto de la lógica de `v_tot_disc` (descuento predefinido/ad-hoc) queda en su rama else, intacta.
   - Tras `v_sale := public._register_sale(... v_tot_disc)`: si `p_points_redeem > 0`, restar puntos y persistir:
     ```sql
     update public.customer set points = points - p_points_redeem where id = p_customer;
     update public.sale set points_redeemed = p_points_redeem, points_discount = v_points_disc where id = v_sale.id;
     select * into v_sale from public.sale where id = v_sale.id;
     ```
     (Ojo con el orden: `_register_sale` ya sumó los puntos ganados sobre el total descontado; esta resta es de los canjeados. Neto correcto.)
   - `grant execute on function public.charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb, uuid, int) to authenticated;`
   - El canje NO exige `is_pos_admin()`.

- [ ] **Step 2: Escribir tests de RPC (fallan primero)**

En `supabase/tests/rpc_test.sql`, antes del `rollback;` final, agregar bloques `do $$ ... $$;`:
- **Acumulación configurable:** set `business.points_clp_per_point=100, points_multiplier=2`; cobra una venta con cliente por un total conocido; asserta `customer.points` sumó `floor(total*2/100)`.
- **Canje válido:** cliente con N puntos; `charge_sale(..., p_points_redeem => k)` con `business.points_redeem_clp_per_point` conocido; asserta: `sale.total` bajó por `k*rate` (capado), `sale.points_redeemed=k`, `sale.points_discount=min(bruto,k*rate)`, y `customer.points = N - k + floor(total_final*mult/clp)`.
- **Canje sin cliente → excepción**; **canje con saldo insuficiente → excepción**; **canje + p_discount_id → excepción** (exclusión mutua). Usar el patrón `begin ... exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;` ya presente en el archivo.

- [ ] **Step 3: Correr tests contra esquema viejo (ver fallar)**

Run: `pnpm test:db`
Expected: FAIL (columnas `points_*`/`p_points_redeem` inexistentes).

- [ ] **Step 4: Aplicar migración**

Run: `pnpm db:reset`
Expected: sin errores.

- [ ] **Step 5: Correr tests (pasan)**

Run: `pnpm test:db`
Expected: PASS (schema+rpc+rls). Si `schema_test.sql` valida columnas de `business`/`sale`, actualizarlo para incluir las nuevas.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260714180000_points_config_redeem.sql supabase/tests/rpc_test.sql
# + schema_test.sql si se tocó
git commit -m "feat(db): config de puntos (business) + acumulacion configurable + canje en charge_sale"
```

---

### Task 2: Capa de datos frontend — business.ts + sales.ts

**Files:**
- Modify: `src/data/business.ts`, `src/data/sales.ts`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `BusinessRow` con 3 campos de puntos; `chargeSale` acepta `p_points_redeem`; `Sale` expone `points_redeemed`/`points_discount`.

- [ ] **Step 1: business.ts**
- En `BusinessRow` (`:4-16`) agregar: `points_clp_per_point: number; points_multiplier: number; points_redeem_clp_per_point: number;`.
- En `COLS` (`:18`) añadir `,points_clp_per_point,points_multiplier,points_redeem_clp_per_point`.
- `updateBusiness` ya acepta `Partial<Omit<BusinessRow,"id">>` → sin cambios.

- [ ] **Step 2: sales.ts**
- En `chargeSale` args agregar `p_points_redeem?: number;` y en el objeto `supabase.rpc("charge_sale", {...})` agregar `p_points_redeem: args.p_points_redeem ?? 0,`.
- En `interface Sale` (`:75-86`) agregar `points_redeemed: number; points_discount: number;`.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc -b`
Expected: `No errors found` (consumidores de PayDialog/VentaScreen se ajustan en Task 4; si tsc rompe solo ahí, es esperado y se cierra en Task 4 — documentarlo).

- [ ] **Step 4: Commit**
```bash
git add src/data/business.ts src/data/sales.ts
git commit -m "feat(data): campos de puntos en business y p_points_redeem en chargeSale"
```

---

### Task 3: UI Administración — pestaña y sección "Puntos"

**Files:**
- Create: `src/modules/admin/PointsSettings.tsx`
- Modify: `src/modules/admin/AdminScreen.tsx`

**Interfaces:**
- Consumes: `BusinessRow` (Task 2), `useBusiness`, `updateBusiness`.

- [ ] **Step 1: PointsSettings.tsx**
Crear el componente replicando el patrón de `BusinessSettings`/`DiscountsSettings` (mismos estilos `inputCls`, encabezado, botón guardar `var(--brand)`):
- `useAuth()` → `businessId`; `useBusiness(businessId)` para precargar.
- Estado local con los 3 campos (strings numéricos, `.replace(/[^\d]/g,"")`).
- Validación: enteros; `points_clp_per_point > 0`, `points_redeem_clp_per_point > 0`, `points_multiplier >= 1` (si vacío/0 → error con toast).
- Guardar: `await updateBusiness(businessId, { points_clp_per_point, points_multiplier, points_redeem_clp_per_point })`, `toast.success`, `qc.invalidateQueries({ queryKey: ["business", businessId] })`, `notifyError` en catch.
- Copys en español: "Acumulación — cada $X = 1 punto", "Multiplicador de puntos (promociones)", "Valor de canje — 1 punto = $Y de descuento". Texto de ayuda explicando el multiplicador (subir a 2 para doble puntos).

- [ ] **Step 2: AdminScreen.tsx — pestaña "Puntos"**
- Ampliar el tipo del `useState` de tab a incluir `"puntos"`; ampliar el parámetro `id` de `tabBtn`.
- Agregar `{tabBtn("puntos", "Puntos")}`.
- Render: encadenar para renderizar `<PointsSettings />` cuando `tab === "puntos"`.

- [ ] **Step 3: Typecheck + verificación visual**
Run: `pnpm exec tsc -b` → limpio. Verificación en vivo (usuario): Admin → Puntos guarda y recarga los valores.

- [ ] **Step 4: Commit**
```bash
git add src/modules/admin/PointsSettings.tsx src/modules/admin/AdminScreen.tsx
git commit -m "feat(admin): seccion Puntos (acumulacion, multiplicador, valor de canje)"
```

---

### Task 4: UI Venta — canje de puntos en el cobro

**Files:**
- Modify: `src/modules/venta/PayDialog.tsx`, `src/modules/venta/VentaScreen.tsx`

**Interfaces:**
- Consumes: `chargeSale` con `p_points_redeem` (Task 2); `selectedCustomer.points`; `business.points_redeem_clp_per_point`.

- [ ] **Step 1: PayDialog — props + estado**
- Props nuevas: `customerPoints: number` y `pointsRedeemRate: number`; ampliar `onConfirm` a `(method, recv, discountId, pointsRedeem)`.
- Estado `const [pointsRedeem, setPointsRedeem] = useState(0)`; resetear en el `useEffect` de apertura.

- [ ] **Step 2: PayDialog — cálculo (exclusión mutua)**
En el bloque `:32-38`:
```ts
const selected = pointsRedeem > 0 ? null : (discounts.find((d) => d.id === discountId) ?? null);
const discAmount = selected ? resolveDiscount(total, "pct", selected.percent) : 0;
const pointsDiscount = pointsRedeem > 0 ? Math.min(total, pointsRedeem * pointsRedeemRate) : 0;
const effectiveTotal = total - discAmount - pointsDiscount;
const recv = method === "efectivo" ? Number(cashStr) || 0 : effectiveTotal;
const change = recv - effectiveTotal;
const canConfirm = method === "tarjeta" || recv >= effectiveTotal;
```

- [ ] **Step 3: PayDialog — control de canje + fila resumen**
- Solo si `customerPoints > 0`: bloque tras el selector de descuento (`:89`) con input numérico de puntos (tope `Math.min(customerPoints, Math.ceil(total / pointsRedeemRate))`) y atajo "Usar todos" que setea ese tope.
- Deshabilitar el `<select>` de descuento cuando `pointsRedeem > 0` (y el input de canje cuando hay `discountId`).
- Fila resumen (estilo de `:60-65`): "Canje de puntos (N pts) −$X".
- Confirmar (`:160`): `onConfirm(method, recv, discountId, pointsRedeem)`.

- [ ] **Step 4: VentaScreen — pasar props y p_points_redeem**
- `handleConfirmPay(method, recv, discountId, pointsRedeem = 0)`; en `chargeSale({...})` agregar `p_points_redeem: pointsRedeem`.
- En el render de `<PayDialog .../>` (`:691`) agregar `customerPoints={selectedCustomer?.points ?? 0}` y `pointsRedeemRate={business?.points_redeem_clp_per_point ?? 1}`.

- [ ] **Step 5: Typecheck + verificación visual**
Run: `pnpm exec tsc -b` → limpio. Verificación en vivo (usuario): con cliente con puntos, canjear baja el total; sin cliente no aparece el control; no se puede canjear + descuento a la vez.

- [ ] **Step 6: Commit**
```bash
git add src/modules/venta/PayDialog.tsx src/modules/venta/VentaScreen.tsx
git commit -m "feat(venta): canje de puntos en el cobro (excluyente con descuento)"
```

---

### Task 5: DTE 39 — emitir descuento global como `DscRcgGlobal`

**Files:**
- Modify: `supabase/functions/issue-receipt/index.ts`

**Interfaces:**
- Consumes: `sale.discount_amount` + `sale.points_discount` (Task 1).

- [ ] **Step 1: Leer el descuento global de la venta**
En el `select` de la venta (`:52-56`), agregar `discount_amount,points_discount,points_redeemed` a los campos de `sale`.

- [ ] **Step 2: Emitir `DscRcgGlobal` cuando hay descuento global**
Tras construir `detalle` y antes/dentro del `body` (`:82-93`), si `(sale.discount_amount ?? 0) > 0`, agregar a `Documento` el array:
```ts
const descGlobal = sale.discount_amount ?? 0;
const dscRcg = descGlobal > 0 ? [{ NroLinDR: 1, TpoMov: 1, TpoValor: 2, ValorDR: String(descGlobal),
  GlosaDR: (sale.points_redeemed ?? 0) > 0 ? `Canje de puntos (${sale.points_redeemed} pts)` : "Descuento" }] : undefined;
```
Incluir `DscRcgGlobal: dscRcg` en `Documento` cuando exista (no incluir la clave si es undefined). Enums numéricos: `TpoMov:1` (descuento→"D"), `TpoValor:2` (monto→"$"), verbatim del skill `simplefactura-dte`.
- **Importante:** con `DscRcgGlobal` el proveedor recalcula totales; verificar que `Totales.MntNeto/IVA/MntTotal` (que salen de `sale.neto/iva/total`, ya reducidos) cuadren con el Detalle menos el descuento global. Si el proveedor exige que `MntTotal` = suma Detalle − DscRcgGlobal, dejar los totales como están (ya reducidos) y confirmar en emisión real.

- [ ] **Step 3: Verificación**
- No hay test automatizado de la edge function. Verificación e2e (emisión real contra SimpleFactura) **la coordina el usuario** (consume folios). Documentar en el reporte el payload exacto emitido y el requisito de validar contra la EMISIÓN (no solo `/dte/preview`), según advierte el skill (`TpoMov` vacío rompe en emisión).
- Deno check si está disponible: `deno check supabase/functions/issue-receipt/index.ts` (si el entorno lo permite); si no, revisión de tipos manual.

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/issue-receipt/index.ts
git commit -m "feat(dte): descuento global (comercial/canje) como DscRcgGlobal en boleta 39"
```

---

### Task 6: Impresión — línea "Canje de puntos" en el ticket

**Files:**
- Modify: `src-tauri/src/escpos.rs`, `src/modules/venta/VentaScreen.tsx`, `src/modules/historial/HistorialScreen.tsx`

**Interfaces:**
- Consumes: `sale.points_redeemed`/`points_discount`.

- [ ] **Step 1: escpos.rs — struct + render**
- En `ReceiptPayload` (`:21-37`), tras `descuento`, agregar (con `#[serde(default)]` para no romper otros payloads):
```rust
#[serde(default)] pub canje_pts: i64,
#[serde(default)] pub canje_monto: i64,
```
- En el render de totales (entre `:294` y `:295`, tras el bloque `Descuento`), agregar:
```rust
if p.canje_monto > 0 {
    line_lr(&mut b, &format!("Canje de puntos ({} pts)", p.canje_pts), &format!("-{}", money(p.canje_monto)), COL);
}
```
- Actualizar el `sample(...)` de tests (`~:595-612`) agregando `canje_pts: 0, canje_monto: 0` para que compile. `cargo test` en `src-tauri` para verificar.

- [ ] **Step 2: Poblar el payload en el frontend**
- VentaScreen emisión (`:391-406`): agregar `canje_pts: sale.points_redeemed ?? 0, canje_monto: sale.points_discount ?? 0`.
- VentaScreen reimpresión (`:322-337`): la `SaleDteRow` debe traer `points_redeemed/points_discount` (agregar al select en `sales.ts` `useSalesTodayDte`), y poblarlos aquí.
- HistorialScreen reimpresión (`:92-96`): idem, con los campos de la fila del historial (agregar al select de `salesHistory.ts` si falta).

- [ ] **Step 3: Verificación**
Run: `pnpm exec tsc -b` → limpio; `cargo test` en `src-tauri` (si disponible) o `cargo check`. Verificación visual del ticket (usuario) en una venta con canje.

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/escpos.rs src/modules/venta/VentaScreen.tsx src/modules/historial/HistorialScreen.tsx src/data/sales.ts src/data/salesHistory.ts
git commit -m "feat(print): linea 'Canje de puntos' en el comprobante termico"
```

---

### Task 7: Historial/detalle — mostrar canje

**Files:**
- Modify: `src/modules/historial/HistorialScreen.tsx`, `src/data/salesHistory.ts`

**Interfaces:**
- Consumes: `sale.points_redeemed`/`points_discount`.

- [ ] **Step 1: Traer los campos en el historial**
En `salesHistory.ts` (`useSalesHistory`), agregar `points_redeemed,points_discount` al `select` y al tipo `SaleHistoryRow`.

- [ ] **Step 2: Mostrar en el detalle**
En el modal de detalle de `HistorialScreen`, cuando `points_redeemed > 0`, mostrar una fila "Canje de puntos (N pts) −$X".

- [ ] **Step 3: Typecheck + verificación**
Run: `pnpm exec tsc -b` → limpio. (Verificación visual: usuario.)

- [ ] **Step 4: Commit**
```bash
git add src/modules/historial/HistorialScreen.tsx src/data/salesHistory.ts
git commit -m "feat(historial): mostrar canje de puntos en el detalle de venta"
```

---

## Notas de ejecución

- Requiere Supabase local (Docker) para `pnpm db:reset` y `pnpm test:db`.
- **Orden de deploy a producción (con confirmación del usuario):** `supabase db push` (Task 1) → `supabase functions deploy issue-receipt` (Task 5) → build/deploy frontend. La verificación e2e del DTE con canje consume folios SII reales.
- El cambio del DTE (Task 5) además corrige un hueco preexistente: hoy el descuento comercial global NO se representa en el DTE. Validar contra la EMISIÓN real (no solo preview), por la advertencia de `TpoMov` del skill `simplefactura-dte`.
- La representación exacta de totales con `DscRcgGlobal` puede requerir un ajuste fino según lo que exija SimpleFactura; es el punto de mayor riesgo y se valida en la emisión real (usuario).
