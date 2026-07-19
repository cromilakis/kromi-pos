# Diseño — Ley del redondeo (efectivo) + arqueo con redondeo

Fecha: 2026-07-19
Estado: aprobado (pendiente de plan de implementación)

## Problema / objetivo

Aplicar la **Ley N° 20.956** (regla de redondeo, vigente desde 2017-11-01) a los
cobros en **efectivo** de kromi-pos, y reflejarla en el arqueo del cierre de caja.

### Regla legal (fuente: BCN Ley 20.956 + Banco Central "Regla de Redondeo")
- Se redondea el **total final a pagar** al múltiplo de **$10** (la decena).
- Termina en **1–5 → hacia abajo**; termina en **6–9 → hacia arriba**. El **5 baja**.
  Equivale a `floor((n + 4) / 10) * 10`.
- Aplica **solo a efectivo**. NO a tarjeta, cheque, transferencia ni electrónico.
- **NO afecta los documentos tributarios**: la boleta/factura muestra el monto
  **exacto** (pre-redondeo). El redondeo es sobre el efectivo cobrado.
- Las monedas de $1/$5 siguen siendo de curso legal.

## Decisiones (confirmadas con el usuario)

1. **Boleta/DTE con monto EXACTO.** El redondeo afecta solo el efectivo cobrado y
   el vuelto; el DTE (`issue-receipt`) no se toca. (Enfoque estricto de la ley y
   de menor riesgo sobre la emisión ya certificada.)
2. **Ticket impreso (efectivo):** bajo el `TOTAL` fiscal, mostrar `Redondeo`,
   `Total a pagar`, `Paga con`, `Vuelto`.
3. **Cierre/arqueo:** el efectivo esperado se calcula con lo realmente cobrado y
   pagado (redondeado), **incluyendo las notas de crédito en efectivo**, y se
   muestra una línea **"Ajuste por redondeo"** para que la caja cuadre de forma
   transparente.
4. **Notas de crédito alineadas:** la NC en efectivo aplica el mismo redondeo (DTE
   61 con monto exacto; efectivo devuelto redondeado) en el ticket y en el arqueo.
   NC con tarjeta = exacta.

## Fórmula

`roundCashCLP(n) = Math.floor((n + 4) / 10) * 10` (TS) / `((v + 4) / 10) * 10`
(plpgsql int). Ej.: 16191→16190, 16195→16190, 16196→16200, 16190→16190.

## Cambios

### 1. `money.ts` — helper de UI
`export function roundCashCLP(n: number): number` = `Math.floor((n + 4) / 10) * 10`.
Con test (casos 1–5 abajo, 6–9 arriba, 5 abajo, múltiplos exactos, 0).

### 2. `charge_sale` (nueva migración) — autoritativo
Para `p_method = 'efectivo'`:
- `v_pay := ((v_total + 4) / 10) * 10;`  (redondeo)
- validar `p_recv >= v_pay` (antes era `>= v_total`);
- `v_recv := p_recv; v_change := v_recv - v_pay;`

Para tarjeta: `v_pay := v_total; v_recv := v_total; v_change := 0;` (igual que hoy).

Se guarda **`total = v_total` (EXACTO)**, `recv = v_recv`, `change = v_change`.
Invariante: `recv - change = v_pay` (lo que queda en caja) para efectivo.
`v_points` y `customer.spent` siguen sobre `v_total` (fiscal). El resto de la RPC
(descuentos, canje, líneas) sin cambios.

### 3. `close_cash_session` (misma migración) — arqueo con redondeo (ventas + NC)
Considera el redondeo tanto en las **ventas** (cash que entra) como en las **notas
de crédito** (cash que sale). Las NC no tienen `recv/change`, así que el efectivo
devuelto se redondea inline sobre su `total`.
- `v_cash` (ventas efectivo, fiscal) = `sum(total) filter (method='efectivo')`.
- `v_cash_collected` = `sum(recv - change) filter (method='efectivo')` (cash que
  ENTRA, ya redondeado).
- `v_nc_cash` (NC efectivo, fiscal) = `sum(total) filter (method='efectivo')` sobre
  `credit_note`.
- `v_nc_paid` = `sum(((total + 4) / 10) * 10) filter (method='efectivo')` sobre
  `credit_note` (cash que SALE, redondeado).
- `v_rounding` = `(v_cash - v_cash_collected) - (v_nc_cash - v_nc_paid)` (ajuste
  neto por redondeo; ±).
- `v_expected := v_float + v_cash_collected - v_nc_paid;`
- El JSON de retorno agrega **`rounding`** (= `v_rounding`). `cash` y `nc_cash`
  siguen siendo las cifras **fiscales**; `expected_cash` usa lo cobrado/pagado
  redondeado. Identidad: `expected = float + cash - nc_cash - rounding`. (`card`/
  `nc_card` sin cambios.)

### 4. `data/cash.ts` — tipo
`CierreResumen` agrega `rounding: number`.

### 5. `PayDialog.tsx`
- `payTotal = method === 'efectivo' ? roundCashCLP(effectiveTotal) : effectiveTotal`.
- Mostrar el `effectiveTotal` (fiscal) y, si es efectivo y `payTotal !== effectiveTotal`,
  una línea "Redondeo" y "Total a pagar" (= `payTotal`).
- `change = recv - payTotal`; `canConfirm = tarjeta || recv >= payTotal`.
- `onConfirm` sigue enviando `recv` (el servidor redondea y valida por su cuenta).

### 6. `escpos.rs` — ticket de venta (efectivo)
- `ReceiptPayload` agrega `recv: i64` y `change: i64`.
- En `build()`, si `metodo == "efectivo"` y `recv > 0`, bajo el `TOTAL` (fiscal,
  exacto) imprimir:
  - `Redondeo` = `-(total - (recv - change))` (solo si != 0),
  - `Total a pagar` = `recv - change`,
  - `Paga con` = `recv`,
  - `Vuelto` = `change`.
  El `TOTAL` grande fiscal **no cambia**. Tarjeta: sin bloque (como hoy).

### 7. `escpos.rs` — comprobante de cierre + panel
- `CierrePayload` agrega `rounding: i64`.
- `build_cierre()`: hoy recalcula `esperado = fondo + cash - nc_cash`; pasa a
  `esperado = fondo + cash - nc_cash - rounding` (así coincide con `expected_cash`
  de la RPC). En el arqueo, imprimir la línea "Ajuste por redondeo" = `-rounding`
  (si != 0), entre "Notas de crédito (efectivo)" y "Esperado en caja".
- `CierrePanel.tsx`: mostrar la línea "Ajuste por redondeo" (`resumen.rounding`) en
  el bloque de arqueo, y pasar `rounding` al `build_cierre`.

### 7b. `escpos.rs` — ticket de nota de crédito (efectivo)
- `build_credit_note()`: si `metodo == "efectivo"`, bajo la `DEVOLUCION` (fiscal,
  exacta) mostrar `Redondeo` = `-(total - round)` (si != 0) y `Efectivo devuelto`
  = `round`, donde `round = ((total + 4) / 10) * 10` (mismo redondeo, calculado en
  Rust; la NC no tiene `recv/change`). La `DEVOLUCION` grande fiscal no cambia.
  Tarjeta: sin bloque. No se agregan campos al `CreditNotePayload` (se deriva de
  `total`).
- El DTE 61 (`issue-credit-note`) NO se toca: mantiene el monto exacto.

### 8. Payloads de impresión — pasar `recv`/`change`
- Venta en vivo (`VentaScreen`): pasar `recv`/`change` del `sale` devuelto.
- Reimpresión (`VentaScreen` `SaleDteRow`, `HistorialScreen` `SaleHistoryRow`):
  agregar `recv`/`change` a los tipos y a los `select(...)`, y pasarlos al payload.

## Testing / verificación
- `money.test`: `roundCashCLP` (1–5 abajo, 6–9 arriba, 5 abajo, exactos, 0).
- `test:db` (pgTAP): `charge_sale` efectivo redondea (`recv-change` = pago
  redondeado, `total` exacto), tarjeta no redondea; `close_cash_session` con ventas
  Y notas de crédito en efectivo redondeadas → `expected_cash` usa lo
  cobrado/pagado redondeado y se cumple `expected = float + cash - nc_cash -
  rounding`.
- `escpos` (Rust): venta efectivo → bloque Redondeo/Total a pagar/Paga con/Vuelto
  con `TOTAL` fiscal intacto; tarjeta → sin bloque; NC efectivo → Redondeo/Efectivo
  devuelto con `DEVOLUCION` fiscal intacta; cierre → línea "Ajuste por redondeo".
- Verificación manejando la app (opcional) y validación de emisión solo en demo.

## Nota de producción
Incluye una **migración de base de datos** (`charge_sale` + `close_cash_session`).
Debe aplicarse a la BD productiva (Supabase) como **paso de despliegue aparte**; se
avisa al usuario y NO se aplica sin su OK. Localmente se valida con `pnpm db:reset`
+ `pnpm test:db`.

## Fuera de alcance
- Redondeo en tarjeta u otros medios electrónicos (no aplica por ley), tanto en
  ventas como en NC (reversos de tarjeta = exactos).
- Cotizaciones (no son cobro en efectivo).
