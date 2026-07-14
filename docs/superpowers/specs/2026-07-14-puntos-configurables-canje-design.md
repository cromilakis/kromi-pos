# F-A: Puntos configurables + canje — Diseño

**Fecha:** 2026-07-14
**Rama:** feature/notas-credito (rama de trabajo actual)

## Objetivo

Hacer configurable la acumulación de puntos de fidelización y permitir canjearlos
como descuento directo sobre el total de la boleta.

Hoy `_register_sale` acumula `floor(v_total / 1000)` (1 punto por cada $1.000,
**hardcodeado**) en `customer.points`. No existe canje. El descuento total ya se
persiste en `sale.discount_amount` y el DTE 39 se emite desde el servidor
(`issue-receipt`) leyendo la venta.

## Decisiones (aprobadas)

1. **Valor de canje propio:** la tasa de acumulación y la de canje se configuran por
   separado (ej. acumular 1 punto cada $100; canjear 1 punto = $1).
2. **Multiplicador manual:** un campo editable a mano en Administración (ej. 2×) para
   promociones; no hay promos por fecha (YAGNI).
3. **Canje etiquetado "Canje de puntos"** en la boleta, distinguible del descuento
   comercial.
4. **Canje mutuamente excluyente** con el descuento comercial/predefinido en un mismo
   cobro (como ya lo son `p_discount_id` vs `p_total_disc`).

## Cambios por capa

### 1. Base de datos (nueva migración aditiva)

En `public.business`, tres columnas de configuración de puntos:
- `points_clp_per_point int not null default 1000 check (points_clp_per_point > 0)`
  — pesos por 1 punto acumulado.
- `points_multiplier int not null default 1 check (points_multiplier >= 1)`
  — multiplicador de acumulación.
- `points_redeem_clp_per_point int not null default 1 check (points_redeem_clp_per_point > 0)`
  — pesos de descuento por punto al canjear.

En `public.sale`, dos columnas para registrar el canje:
- `points_redeemed int not null default 0 check (points_redeemed >= 0)`
- `points_discount int not null default 0 check (points_discount >= 0)`

### 2. Acumulación — `_register_sale`

Reemplazar `v_points := floor(v_total / 1000)` por
`v_points := floor(v_total * v_multiplier / v_clp_per_point)`, leyendo
`points_clp_per_point` y `points_multiplier` del negocio (`business`). Los puntos se
acumulan sobre el **total final pagado** (después de descuentos y canje). La
acumulación sigue aplicando solo cuando hay cliente (`p_customer is not null`).

### 3. Canje — `charge_sale` / `_register_sale`

- Nuevo parámetro `p_points_redeem int default 0` en `charge_sale` (cambio de firma:
  drop de la firma vigente + create + grant, patrón de
  `20260714150000_charge_sale_discount_id.sql`).
- Validaciones en el servidor:
  - Si `p_points_redeem > 0`: exige `p_customer is not null` y
    `customer.points >= p_points_redeem`; de lo contrario, excepción.
  - Mutuamente excluyente con `p_discount_id` y `p_total_disc`: si `p_points_redeem > 0`
    llega junto a `p_discount_id` no nulo o `p_total_disc` con valor, se lanza excepción
    explícita ("el canje de puntos no se puede combinar con otro descuento"). La UI ya
    impide activarlos a la vez; esta es la validación de servidor.
- Cálculo: `v_points_discount = least(v_bruto, p_points_redeem * redeem_clp_per_point)`.
  Se aplica como descuento sobre el total (mismo lugar que `v_tot_disc`).
- Efecto en puntos del cliente: `points = points − p_points_redeem + v_points`
  (resta los canjeados, suma los ganados sobre el total ya descontado).
- Persistir `sale.points_redeemed = p_points_redeem` y
  `sale.points_discount = v_points_discount`.
- El canje **no** requiere rol admin (lo autoriza el dueño de los puntos, el cliente).

### 4. Capa de datos frontend

- `src/data/business.ts` (`BusinessRow`): agregar los tres campos de puntos;
  `updateBusiness` acepta escribirlos.
- `src/data/sales.ts`: `chargeSale` acepta `p_points_redeem`; `Sale`/consultas
  relevantes exponen `points_redeemed`/`points_discount` donde se necesiten (detalle,
  historial).

### 5. UI Administración

Sección/pestaña **"Puntos"** (patrón `DiscountsSettings`/pestañas de `AdminScreen`):
- Acumulación: "cada $X = 1 punto" (`points_clp_per_point`).
- Multiplicador actual (`points_multiplier`).
- Valor de canje: "1 punto = $Y" (`points_redeem_clp_per_point`).
Validación de rango (enteros > 0; multiplicador ≥ 1) en doble capa (UI + check DB).

### 6. UI Venta (PayDialog)

- Si hay **cliente seleccionado con `points > 0`**: control "Canjear puntos" (input de
  cantidad, con atajo "usar todos" acotado a lo que cubra el total). Muestra en vivo el
  descuento equivalente (`puntos × redeem_clp_per_point`, capado al total) y el total
  resultante.
- Sin cliente, o cliente sin puntos: el control no se ofrece.
- El canje y el selector de descuento comercial no se habilitan simultáneamente (regla
  de exclusión mutua, coherente con el backend).
- `handleConfirmPay` pasa `p_points_redeem` a `chargeSale`.

### 7. Reflejo en la boleta

- **Impresión (escpos, Rust `src-tauri`):** el payload de `printReceipt` gana
  `puntos_canjeados` (N) y `canje_puntos` (monto). El comprobante muestra una línea
  `Canje de puntos (N pts)  −$X` sobre el total. Se modifica el struct del payload y el
  render en `escpos.rs` (o equivalente).
- **DTE 39 (`issue-receipt`):** el canje reduce el total de la venta, que es lo que
  emite `issue-receipt`. El detalle exacto de cómo se representa el descuento en el DTE
  (descuento global vs línea) se afinará en el plan **consultando el skill
  `simplefactura-dte`**, para que el monto emitido cuadre con el impreso y con la
  certificación SII.

### 8. Historial / detalle

En el detalle de una venta (HistorialScreen), mostrar "Canje de puntos" y los puntos
usados cuando `points_redeemed > 0`.

## Tests

- `pnpm test:db`: acumulación con config del negocio (tasa + multiplicador); canje
  válido (resta puntos, aplica descuento, persiste columnas); canje sin cliente o con
  saldo insuficiente → excepción; canje + descuento comercial → excepción (exclusión
  mutua).
- Unit (frontend): cálculo del descuento por canje en PayDialog (puntos × tasa, capado
  al total); helper de negocio para puntos si se extrae.

## Fuera de alcance (YAGNI)

- Promos de puntos por fecha (el multiplicador es manual).
- Canje parcial por línea; caducidad/expiración de puntos.
- Historial de movimientos de puntos por cliente.

## Criterios de aceptación

1. En Administración se configura tasa de acumulación, multiplicador y valor de canje.
2. Una venta con cliente acumula puntos según `floor(total * multiplicador / clp_per_point)`.
3. Con cliente con puntos, en el cobro se pueden canjear puntos como descuento directo
   sobre el total; el total baja, los puntos se restan del cliente.
4. El canje aparece etiquetado "Canje de puntos (N pts)" en la boleta impresa y el DTE
   emitido cuadra con ese total.
5. Canje sin cliente / con saldo insuficiente / junto a descuento comercial se rechaza.
