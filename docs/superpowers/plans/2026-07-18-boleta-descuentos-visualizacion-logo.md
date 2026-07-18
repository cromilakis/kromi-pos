# Boleta: visualización de descuentos + DTE sin reparo + logo reducido — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar correctamente los descuentos en la boleta impresa, emitir el DTE de forma que el SII no ponga reparos (descuento prorrateado en líneas, sin `DscRcgGlobal`), y reducir el logo para evitar el corte por saturación del cabezal.

**Architecture:** Tres frentes independientes: (1) frontend — armar el payload de impresión con el descuento global correcto; (2) render ESC/POS en Rust — nuevo bloque de totales (Subtotal → Descuento global → Neto/IVA/Total) y logo más chico; (3) Edge Function `issue-receipt` — prorratear el descuento global entre las líneas del `Detalle`. La boleta impresa y el DTE son independientes: el ticket muestra el descuento como línea; el DTE lo distribuye en los ítems.

**Tech Stack:** React + TypeScript (Vitest) en `src/`; Rust en `src-tauri/` (crate `image` 0.25); Deno Edge Functions en `supabase/functions/`; SimpleFactura API.

## Global Constraints

- **Identidad de commits (NO NEGOCIABLE):** autor y committer = `Cromilakis <ipcromilakis@gmail.com>`. Prohibido `Co-Authored-By` y cualquier atribución a Claude/Anthropic. Antes de commitear, asegurar `git config user.name "Cromilakis"` y `git config user.email "ipcromilakis@gmail.com"`.
- **Producción:** la app está en producción. NO emitir DTE reales para probar ni cambiar `SIMPLEFACTURA_AMBIENTE`. Toda emisión de validación va a la cuenta **demo** (ambiente 0): `demo@chilesystems.com` / `Rv8Il4eV`, emisor `78181331-1`, sucursal `Casa_Matriz`, con script aparte.
- **Prosa en español; identificadores/código en inglés.**
- **Semántica del payload de impresión:** el campo `descuento` = descuento **global** (comercial) = `discount_amount − points_discount`; `canje_monto` = `points_discount`; `items[].descuento` = descuento por línea. Descuento comercial y canje son mutuamente excluyentes.
- **Ancho del ticket:** `COL = 48` columnas (constante en `escpos.rs`).

---

### Task 1: Helper `globalDiscount()` en money.ts

**Files:**
- Modify: `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Interfaces:**
- Produces: `globalDiscount(discountAmount: number, pointsDiscount: number): number` — devuelve el descuento global comercial (el total menos el canje), nunca negativo.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `src/lib/money.test.ts` (dentro del archivo, respetando el estilo de imports existente — importar `globalDiscount` desde `./money`):

```ts
import { globalDiscount } from "./money";

describe("globalDiscount", () => {
  it("descuento comercial sin canje", () => {
    expect(globalDiscount(1799, 0)).toBe(1799);
  });
  it("canje: el global comercial es 0 (discount_amount == points_discount)", () => {
    expect(globalDiscount(2000, 2000)).toBe(0);
  });
  it("nunca negativo", () => {
    expect(globalDiscount(0, 0)).toBe(0);
  });
});
```

(Si ya existe un `import { ... } from "./money";` al inicio, agregar `globalDiscount` a ese import en vez de duplicarlo.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- money.test`
Expected: FAIL — `globalDiscount is not a function` / export no encontrado.

- [ ] **Step 3: Implementar el helper**

Agregar en `src/lib/money.ts` (después de `resolveDiscount`):

```ts
/** Descuento global comercial de una venta: el total del descuento global
 *  (`discount_amount`) menos el canje de puntos (`points_discount`), que son
 *  mutuamente excluyentes. Nunca negativo. */
export function globalDiscount(discountAmount: number, pointsDiscount: number): number {
  return Math.max(0, (discountAmount ?? 0) - (pointsDiscount ?? 0));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- money.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts
git commit -m "feat(money): helper globalDiscount (descuento global comercial)"
```

---

### Task 2: Armar el payload con el descuento global en los 3 puntos de impresión

**Files:**
- Modify: `src/data/sales.ts` (tipo `SaleDteRow` + `select`)
- Modify: `src/modules/venta/VentaScreen.tsx:353` y `:443`
- Modify: `src/modules/historial/HistorialScreen.tsx:153`
- Modify: `src/modules/cotizaciones/CotizacionesScreen.tsx:154` y `:180`

**Interfaces:**
- Consumes: `globalDiscount()` (Task 1).

- [ ] **Step 1: Agregar `discount_amount` a `SaleDteRow` y su query**

En `src/data/sales.ts`, en la interfaz `SaleDteRow` (líneas ~40-47) agregar el campo:

```ts
export interface SaleDteRow {
  id: string; folio: number; total: number; sold_at: string; method: string;
  dte_status: string; dte_folio: number | null; dte_timbre: string | null;
  discount_amount: number;
  points_redeemed: number; points_discount: number;
  doc_type: string;
  printed_at: string | null;
  lines: { name_snapshot: string; price_snapshot: number; qty: number; discount_amount: number }[];
}
```

En el `select(...)` de `useSalesTodayDte` (línea ~59) agregar `discount_amount`:

```ts
        .select("id,folio,total,discount_amount,sold_at,method,dte_status,dte_folio,dte_timbre,points_redeemed,points_discount,doc_type,printed_at,sale_line(name_snapshot,price_snapshot,qty,discount_amount)")
```

En el `map` (línea ~65-70) agregar el campo al objeto devuelto:

```ts
        id: s.id, folio: s.folio, total: s.total, discount_amount: s.discount_amount ?? 0, sold_at: s.sold_at, method: s.method,
```

- [ ] **Step 2: Corregir `VentaScreen.tsx` — reimpresión (línea ~353)**

Importar el helper: en el import existente de `@/lib/money` (línea 17) agregar `globalDiscount`:

```ts
import { computeTotals, resolveDiscount, discountedPrice, fmtCLP, globalDiscount } from "@/lib/money";
```

Reemplazar la línea 353:

```ts
      descuento: h.lines.reduce((s, l) => s + (l.discount_amount ?? 0), 0),
```

por:

```ts
      descuento: globalDiscount(h.discount_amount, h.points_discount),
```

- [ ] **Step 3: Corregir `VentaScreen.tsx` — venta en vivo (línea ~443)**

Reemplazar la línea 443:

```ts
            descuento: soldLines.reduce((s, l) => s + resolveDiscount(l.qty * l.product.price, "pct", l.product.discount_pct ?? 0), 0),
```

por:

```ts
            descuento: globalDiscount(sale.discount_amount, sale.points_discount),
```

- [ ] **Step 4: Corregir `HistorialScreen.tsx` (línea ~153)**

Importar `globalDiscount` desde `@/lib/money` (agregar al import existente o crear uno). Reemplazar la línea 153:

```ts
      descuento: row.lines.reduce((s, l) => s + (l.discount_amount ?? 0), 0),
```

por:

```ts
      descuento: globalDiscount(row.discount_amount, row.points_discount),
```

- [ ] **Step 5: Corregir `CotizacionesScreen.tsx` (líneas ~154 y ~180) — solo el global**

La cotización no tiene canje; su descuento global es `discount_amount`. Reemplazar en la línea ~154:

```ts
            descuento: itemsSnap.reduce((s, i) => s + (i.descuento ?? 0), 0) + globalSnap,
```

por:

```ts
            descuento: globalSnap,
```

Y en la línea ~180:

```ts
        descuento: q.lines.reduce((s, l) => s + (l.discount_amount ?? 0), 0) + q.discount_amount,
```

por:

```ts
        descuento: q.discount_amount,
```

(La línea ~239 ya pasa `descuento: quoteSnap.discount_amount` — dejar como está.)

- [ ] **Step 6: Verificar compilación y tests**

Run: `pnpm build`
Expected: compila sin errores de tipos (el nuevo campo `discount_amount` de `SaleDteRow` resuelve).

Run: `pnpm test`
Expected: PASS (sin regresiones).

- [ ] **Step 7: Commit**

```bash
git add src/data/sales.ts src/modules/venta/VentaScreen.tsx src/modules/historial/HistorialScreen.tsx src/modules/cotizaciones/CotizacionesScreen.tsx
git commit -m "fix(boleta): pasar el descuento global al payload de impresion (venta/historial/cotizacion)"
```

---

### Task 3: Nuevo bloque de totales en `escpos.rs` (boleta + cotización)

**Files:**
- Modify: `src-tauri/src/escpos.rs` (helper `totales_block`, `build`, `build_quote`, tests)

**Interfaces:**
- Produces: `fn totales_block(b: &mut Vec<u8>, items: &[Item], descuento: i64, canje_pts: i64, canje_monto: i64, neto: i64, iva: i64, total: i64)` — imprime Subtotal (si hay descuento), Descuento global, Canje, regla, Neto, IVA, TOTAL.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar dentro de `mod tests` en `src-tauri/src/escpos.rs` (usa los helpers existentes `sample`, `contains`, `build`):

```rust
    #[test]
    fn boleta_descuento_global_muestra_subtotal_y_descuento() {
        let mut p = sample("efectivo", true);
        p.items = vec![Item { nombre: "Marantha".into(), qty: 1, precio: 17990, descuento: 0 }];
        p.descuento = 1799;
        p.neto = 13606; p.iva = 2585; p.total = 16191;
        let b = build(&p);
        assert!(contains(&b, b"Subtotal"));
        assert!(contains(&b, b"Descuento global"));
    }

    #[test]
    fn boleta_canje_muestra_linea() {
        let mut p = sample("efectivo", true);
        p.items = vec![Item { nombre: "Marantha".into(), qty: 1, precio: 10000, descuento: 0 }];
        p.canje_pts = 5; p.canje_monto = 1000;
        p.neto = 7563; p.iva = 1437; p.total = 9000;
        let b = build(&p);
        assert!(contains(&b, b"Canje de puntos (5 pts)"));
        assert!(contains(&b, b"Subtotal"));
    }

    #[test]
    fn boleta_sin_descuento_no_muestra_subtotal() {
        let b = build(&sample("efectivo", true)); // descuento 0, canje 0
        assert!(!contains(&b, b"Subtotal"));
    }
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd src-tauri && cargo test escpos::tests::boleta_ -- --nocapture`
Expected: FAIL (los sample no producen "Subtotal"; hoy el label es "Total descuentos").

- [ ] **Step 3: Implementar el helper `totales_block`**

Agregar en `src-tauri/src/escpos.rs` (junto a los otros helpers, antes de `pub fn build`):

```rust
/// Bloque de totales del ticket: Subtotal (Σ precio*qty − dcto de línea) y las
/// líneas de descuento GLOBAL/canje se muestran solo si hay algún descuento;
/// luego siempre Neto, IVA y TOTAL (doble tamaño). Cuadra:
/// Subtotal − descuento − canje = total = neto + iva.
fn totales_block(b: &mut Vec<u8>, items: &[Item], descuento: i64, canje_pts: i64, canje_monto: i64, neto: i64, iva: i64, total: i64) {
    let subtotal: i64 = items.iter().map(|it| it.precio * it.qty as i64 - it.descuento).sum();
    let hay_desc = items.iter().any(|it| it.descuento > 0) || descuento > 0 || canje_monto > 0;
    if hay_desc {
        line_lr(b, "Subtotal", &money(subtotal), COL);
        if descuento > 0 {
            let pct = if subtotal > 0 { ((descuento as f64 * 100.0) / subtotal as f64).round() as i64 } else { 0 };
            line_lr(b, &format!("Descuento global {}%", pct), &format!("-{}", money(descuento)), COL);
        }
        if canje_monto > 0 {
            line_lr(b, &format!("Canje de puntos ({} pts)", canje_pts), &format!("-{}", money(canje_monto)), COL);
        }
        rule(b, b'-');
    }
    line_lr(b, "Neto", &money(neto), COL);
    line_lr(b, "IVA 19%", &money(iva), COL);
    nl(b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]); // doble tamano
    line_lr(b, "TOTAL", &money(total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(b);
}
```

- [ ] **Step 4: Usar el helper en `build()`**

En `pub fn build`, reemplazar el bloque de totales actual (desde `// totales — orden:` hasta el `nl(&mut b);` posterior al `TOTAL`, es decir las líneas ~308-321) por una llamada al helper. El resultado debe quedar:

```rust
    rule(&mut b, b'=');

    totales_block(&mut b, &p.items, p.descuento, p.canje_pts, p.canje_monto, p.neto, p.iva, p.total);

    line_lr(&mut b, "Forma de pago", &metodo_label(&p.metodo), COL);
    rule(&mut b, b'-');
```

(Es decir: se elimina el bloque manual `line_lr("Neto"...) / if p.descuento>0 { "Total descuentos" } / if canje / "IVA 19%" / doble tamaño / "TOTAL" / reset / nl` y se reemplaza por la única llamada a `totales_block`. La regla `====` previa y la línea `Forma de pago` posterior se mantienen.)

- [ ] **Step 5: Usar el helper en `build_quote()`**

En `pub fn build_quote`, reemplazar el bloque de totales (líneas ~512-521: `line_lr("Neto"...)`, `if p.descuento>0 {...}`, `line_lr("IVA 19%"...)`, doble tamaño, `TOTAL`, reset, `nl`) por:

```rust
    totales_block(&mut b, &p.items, p.descuento, 0, 0, p.neto, p.iva, p.total);
```

(La cotización no tiene canje → `canje_pts` y `canje_monto` en 0. La regla `====` previa y la `rule('-')` posterior se mantienen.)

- [ ] **Step 6: Correr todos los tests de escpos**

Run: `cd src-tauri && cargo test escpos`
Expected: PASS (los 3 nuevos + los existentes; `incluye_textos_y_qr` sigue verde porque "TOTAL" persiste).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/escpos.rs
git commit -m "feat(escpos): bloque de totales con Subtotal + descuento global (boleta y cotizacion)"
```

---

### Task 4: `buildDetalle` — prorrateo del descuento global en las líneas (pure)

**Files:**
- Create: `supabase/functions/issue-receipt/detalle.ts`
- Test: `supabase/functions/issue-receipt/detalle.test.ts`

**Interfaces:**
- Produces:
  - `interface DteLine { name_snapshot: string; price_snapshot: number; qty: number; discount_amount?: number }`
  - `interface DetalleItem { NroLinDet: string; NmbItem: string; QtyItem: string; UnmdItem: string; PrcItem: string; MontoItem: string; DescuentoMonto?: number }`
  - `buildDetalle(lines: DteLine[], globalDiscount: number, esFactura: boolean): DetalleItem[]` — distribuye `globalDiscount` entre las líneas por base (precio×qty − dcto de línea); el remanente de redondeo va a la última línea; `Σ MontoItem = Σ(precio×qty) − Σ dcto − global`. Boleta trabaja en bruto; factura en neto (÷1,19).

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/functions/issue-receipt/detalle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDetalle } from "./detalle.ts";

const sum = (d: { MontoItem: string }[]) => d.reduce((s, x) => s + Number(x.MontoItem), 0);

describe("buildDetalle (boleta, bruto)", () => {
  it("una línea con descuento global: Σ MontoItem = total", () => {
    const d = buildDetalle([{ name_snapshot: "A", price_snapshot: 8990, qty: 1 }], 899, false);
    expect(sum(d)).toBe(8091);
    expect(d[0].DescuentoMonto).toBe(899);
  });

  it("varias líneas + descuento que no divide exacto: cuadra al peso", () => {
    const lines = [
      { name_snapshot: "A", price_snapshot: 5000, qty: 2, discount_amount: 1000 },
      { name_snapshot: "B", price_snapshot: 8990, qty: 1 },
    ];
    const d = buildDetalle(lines, 1799, false);
    // Σ bruto = 10000 + 8990 = 18990; Σ dcto línea = 1000; base = 17990; − global 1799 = 16191
    expect(sum(d)).toBe(16191);
  });

  it("sin descuento global: MontoItem = bruto − dcto de línea", () => {
    const d = buildDetalle([{ name_snapshot: "A", price_snapshot: 5000, qty: 2, discount_amount: 1000 }], 0, false);
    expect(sum(d)).toBe(9000);
    expect(d[0].DescuentoMonto).toBe(1000);
  });
});

describe("buildDetalle (factura, neto)", () => {
  it("lleva a neto y distribuye el global neto", () => {
    const d = buildDetalle([{ name_snapshot: "A", price_snapshot: 11900, qty: 1 }], 1190, true);
    // prc neto = round(11900/1.19)=10000; global neto = round(1190/1.19)=1000; monto = 9000
    expect(d[0].PrcItem).toBe("10000");
    expect(sum(d)).toBe(9000);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- detalle.test`
Expected: FAIL — no existe `./detalle.ts`.

- [ ] **Step 3: Implementar `buildDetalle`**

Crear `supabase/functions/issue-receipt/detalle.ts`:

```ts
export interface DteLine {
  name_snapshot: string;
  price_snapshot: number;
  qty: number;
  discount_amount?: number;
}

export interface DetalleItem {
  NroLinDet: string;
  NmbItem: string;
  QtyItem: string;
  UnmdItem: string;
  PrcItem: string;
  MontoItem: string;
  DescuentoMonto?: number;
}

/**
 * Construye el Detalle del DTE distribuyendo el descuento GLOBAL entre las
 * líneas (sin DscRcgGlobal), de modo que Σ MontoItem = Σ(precio×qty) − Σ dcto
 * de línea − descuento global. El SII no reconcilia un DscRcgGlobal en boleta
 * bruta (genera reparo "Monto Total No Cuadra con Parciales"); distribuir en
 * líneas hace la cuadratura trivial.
 *
 * Unidad de trabajo: boleta = bruto (IVA incluido); factura = neto (÷1,19).
 * El remanente de redondeo del prorrateo se ajusta en la última línea para que
 * Σ extra = descuento global exacto.
 */
export function buildDetalle(lines: DteLine[], globalDiscount: number, esFactura: boolean): DetalleItem[] {
  const toWork = (n: number) => (esFactura ? Math.round(n / 1.19) : n);
  const globalWork = toWork(globalDiscount);

  const calc = lines.map((l) => {
    const prc = toWork(l.price_snapshot);
    const lineDesc = toWork(l.discount_amount ?? 0);
    return { l, prc, lineDesc, base: prc * l.qty - lineDesc };
  });
  const sumBase = calc.reduce((s, c) => s + c.base, 0);

  let asignado = 0;
  return calc.map((c, i) => {
    const extra = i === calc.length - 1
      ? globalWork - asignado
      : (sumBase > 0 ? Math.round((globalWork * c.base) / sumBase) : 0);
    if (i < calc.length - 1) asignado += extra;

    const desc = c.lineDesc + extra;
    const monto = c.prc * c.l.qty - desc;
    const d: DetalleItem = {
      NroLinDet: String(i + 1),
      NmbItem: c.l.name_snapshot,
      QtyItem: String(c.l.qty),
      UnmdItem: "un",
      PrcItem: String(c.prc),
      MontoItem: String(monto),
    };
    if (desc > 0) d.DescuentoMonto = desc;
    return d;
  });
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- detalle.test`
Expected: PASS (los 4 casos).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/issue-receipt/detalle.ts supabase/functions/issue-receipt/detalle.test.ts
git commit -m "feat(dte): buildDetalle prorratea el descuento global en lineas (sin DscRcgGlobal)"
```

---

### Task 5: Integrar `buildDetalle` en `issue-receipt/index.ts` (quitar `DscRcgGlobal`)

**Files:**
- Modify: `supabase/functions/issue-receipt/index.ts`

**Interfaces:**
- Consumes: `buildDetalle` (Task 4).

- [ ] **Step 1: Importar `buildDetalle`**

Al inicio de `supabase/functions/issue-receipt/index.ts`, junto al import de supabase-js:

```ts
import { buildDetalle } from "./detalle.ts";
```

- [ ] **Step 2: Reemplazar la construcción del `Detalle` y quitar `DscRcgGlobal`**

Reemplazar todo el bloque que hoy arma `const detalle = lines.map(...)` (líneas ~109-131) **y** el bloque `descuentoGlobalBruto/descuentoGlobal/dscRcgGlobal` (líneas ~132-149) por:

```ts
    const detalle = buildDetalle(lines, sale.discount_amount ?? 0, esFactura);
```

- [ ] **Step 3: Ajustar los totales de factura y el body**

En el bloque `if (esFactura) { ... }` (línea ~159), como el descuento global ya está prorrateado en las líneas, `MntNeto` es la suma de los `MontoItem` (ya sin restar el global). Reemplazar:

```ts
      const mntNeto = detalle.reduce((acc, d) => acc + Number(d.MontoItem), 0) - descuentoGlobal;
```

por:

```ts
      const mntNeto = detalle.reduce((acc, d) => acc + Number(d.MontoItem), 0);
```

En el `const body = { Documento: { ... } }` (línea ~181-192), quitar el spread de `DscRcgGlobal`:

```ts
    const body = {
      Documento: {
        Encabezado: {
          IdDoc: idDoc,
          Emisor: emisor,
          Receptor: receptor,
          Totales: totales,
        },
        Detalle: detalle,
      },
    };
```

(La boleta sigue usando `totales = { MntNeto: sale.neto, IVA: sale.iva, MntTotal: sale.total }`; como `Σ MontoItem = sale.total` tras el prorrateo, la cuadratura del SII pasa.)

- [ ] **Step 4: Verificar que no quedan referencias colgantes**

Run: `cd supabase/functions/issue-receipt && grep -n "DscRcgGlobal\|descuentoGlobal\|dscRcgGlobal" index.ts`
Expected: sin resultados (todas las referencias eliminadas).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/issue-receipt/index.ts
git commit -m "fix(dte): emitir con descuento prorrateado en lineas; quitar DscRcgGlobal (evita reparo SII)"
```

---

### Task 6: Validación end-to-end del DTE contra la cuenta demo

**Files:**
- Create: `scripts/validate_dte_demo.ts`

**Interfaces:**
- Consumes: `buildDetalle` (Task 4) — importado para armar un body idéntico al de `index.ts`.

- [ ] **Step 1: Crear el script de validación**

Crear `scripts/validate_dte_demo.ts`. Emite en la cuenta DEMO (ambiente 0) una boleta con descuento usando exactamente `buildDetalle`, baja el XML y consulta el estado SII. NO toca producción.

```ts
// Validación del DTE contra la cuenta DEMO (ambiente 0). NO usar en producción.
// Ejecutar: npx tsx scripts/validate_dte_demo.ts
import { buildDetalle } from "../supabase/functions/issue-receipt/detalle.ts";

const SF = "https://api.simplefactura.cl";
const EMAIL = "demo@chilesystems.com", PASS = "Rv8Il4eV";
const SUC = "Casa_Matriz", RUT = "78181331-1";

async function token(): Promise<string> {
  const r = await fetch(`${SF}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const t = (await r.text()).trim();
  const o = JSON.parse(t);
  return o.accessToken ?? o.token ?? o.data;
}

async function main() {
  // Venta de ejemplo: 2 líneas, una con dcto de línea, + descuento global 1799.
  const lines = [
    { name_snapshot: "Suculenta grande", price_snapshot: 5000, qty: 2, discount_amount: 1000 },
    { name_snapshot: "Marantha", price_snapshot: 8990, qty: 1 },
  ];
  const discountAmount = 1799;
  const detalle = buildDetalle(lines, discountAmount, false);
  const total = detalle.reduce((s, d) => s + Number(d.MontoItem), 0);
  const neto = Math.round(total / 1.19);
  const iva = total - neto;

  const body = {
    Documento: {
      Encabezado: {
        IdDoc: { TipoDTE: 39, FchEmis: "2026-07-18", FchVenc: "2026-07-18", IndServicioBoleta: 3 },
        Emisor: { RUTEmisor: RUT, RznSocEmisor: "CHILESYSTEMS SPA", GiroEmisor: "Desarrollo de software", DirOrigen: "Calle 7 numero 3", CmnaOrigen: "Santiago" },
        Receptor: { RUTRecep: "66666666-6", RznSocRecep: "Consumidor Final", DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago" },
        Totales: { MntNeto: String(neto), IVA: String(iva), MntTotal: String(total) },
      },
      Detalle: detalle,
    },
  };

  const tk = await token();
  const emit = await fetch(`${SF}/invoiceV2/${SUC}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  const ej = JSON.parse(await emit.text());
  const folio = ej?.data?.folio;
  console.log("emit", emit.status, "folio", folio, "total", total, "msg", ej?.message);
  if (!folio) return;
  console.log("Revisar estado SII con la traza (dte/trazasIssued) en unos minutos; esperar 'Aceptado' SIN reparo.");
}

main();
```

- [ ] **Step 2: Ejecutar la validación (demo)**

Run: `npx tsx scripts/validate_dte_demo.ts`
Expected: `emit 200 folio <n> total 16191 ...`. Anotar el folio.

> Nota: el `/token` de la demo tiene límite estricto (429 "Has superado el límite de solicitudes de token") con cooldown de varios minutos. Si da 429, esperar y reintentar UNA vez; no en loop.

- [ ] **Step 3: Confirmar el estado SII sin reparo**

Esperar ~3-5 min y consultar la traza (reutilizar el patrón de `dte/trazasIssued` del folio emitido). Verificar que el estado sea **"Aceptado"** y **NO** aparezca "REPARO- Monto Total No Cuadra con Parciales".

Expected: Aceptado, sin reparo (como el folio 6373 de la investigación previa).

- [ ] **Step 4: Commit**

```bash
git add scripts/validate_dte_demo.ts
git commit -m "test(dte): script de validacion del DTE contra cuenta demo"
```

---

### Task 7: Reducir el logo (regenerar `logo.escpos`)

**Files:**
- Modify: `src-tauri/Cargo.toml` (dev-dependency `image` con feature `jpeg`)
- Create: `src-tauri/examples/gen_logo.rs`
- Modify: `src-tauri/assets/logo.escpos` (regenerado)

**Interfaces:** N/A (herramienta de generación de asset).

- [ ] **Step 1: Habilitar `jpeg` para el build de ejemplos**

En `src-tauri/Cargo.toml`, agregar una sección `[dev-dependencies]` (o ampliar la existente) para que los ejemplos puedan decodificar el JPEG fuente sin agregar `jpeg` al binario de producción (resolver v2 no unifica features de dev-deps en el build normal):

```toml
[dev-dependencies]
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }
```

(La entrada de `[dependencies]` de `image` con solo `png` se mantiene igual — el binario de producción no incluye jpeg.)

- [ ] **Step 2: Crear el generador `gen_logo.rs`**

Crear `src-tauri/examples/gen_logo.rs`. Regenera `assets/logo.escpos` a 160 px de ancho (≈mitad del actual → ~¼ de bytes), monocromo por umbral, centrado (`ESC a 1` … `ESC a 0`), y además guarda `assets/logo_preview.png` para eyeball. Se corre con CWD = `src-tauri/`.

```rust
use std::fs::File;
use std::io::Write;

fn main() {
    // public/logo.png es en realidad JPEG; with_guessed_format() lo detecta por magic bytes.
    let reader = image::ImageReader::open("../public/logo.png")
        .expect("abrir ../public/logo.png")
        .with_guessed_format()
        .expect("detectar formato");
    let src = reader.decode().expect("decodificar").to_luma8();
    let (w, h) = src.dimensions();

    let target_w: u32 = 160;
    let target_h: u32 = (h as f32 * target_w as f32 / w as f32).round() as u32;
    let small = image::imageops::resize(&src, target_w, target_h, image::imageops::FilterType::Lanczos3);

    let bpr = ((target_w + 7) / 8) as usize;
    let mut bits = vec![0u8; bpr * target_h as usize];
    for y in 0..target_h {
        for x in 0..target_w {
            if small.get_pixel(x, y).0[0] < 128 {
                bits[y as usize * bpr + (x / 8) as usize] |= 0x80 >> (x % 8);
            }
        }
    }

    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(&[0x1B, 0x61, 0x01]); // ESC a 1 (centrar)
    let mut y0 = 0u32;
    while y0 < target_h {
        let band = (target_h - y0).min(255);
        out.extend_from_slice(&[0x1D, 0x76, 0x30, 0x00]);
        out.push((bpr & 0xFF) as u8);
        out.push((bpr >> 8) as u8);
        out.push((band & 0xFF) as u8);
        out.push((band >> 8) as u8);
        let start = y0 as usize * bpr;
        let end = start + band as usize * bpr;
        out.extend_from_slice(&bits[start..end]);
        y0 += band;
    }
    out.extend_from_slice(&[0x1B, 0x61, 0x00]); // ESC a 0

    File::create("assets/logo.escpos").expect("crear logo.escpos").write_all(&out).expect("escribir");
    small.save("assets/logo_preview.png").expect("guardar preview");
    eprintln!("logo.escpos: {}x{} px, {} bytes (antes ~12.5KB)", target_w, target_h, out.len());
}
```

- [ ] **Step 3: Regenerar el asset**

Run: `cd src-tauri && cargo run --example gen_logo`
Expected: imprime `logo.escpos: 160x160 px, ~3-4KB bytes ...` y crea `assets/logo_preview.png`.

- [ ] **Step 4: Revisar el preview del logo**

Abrir `src-tauri/assets/logo_preview.png` (Read/visor) y verificar que el logo se lee bien a 160 px. Si se ve muy chico/grande, ajustar `target_w` en `gen_logo.rs` y volver al Step 3.

- [ ] **Step 5: Verificar que la app compila con el nuevo asset y no se rompen tests**

Run: `cd src-tauri && cargo test escpos`
Expected: PASS (el `include_bytes!` toma el nuevo `logo.escpos`).

- [ ] **Step 6: Ignorar el preview y commitear**

Agregar `src-tauri/assets/logo_preview.png` a `.gitignore` (no es asset de la app):

```
src-tauri/assets/logo_preview.png
```

```bash
git add src-tauri/Cargo.toml src-tauri/examples/gen_logo.rs src-tauri/assets/logo.escpos .gitignore
git commit -m "perf(escpos): reducir logo a 160px para evitar corte por buffer del cabezal"
```

---

### Task 8: Vista previa de la boleta (verificación visual del layout)

**Files:**
- Modify: `src-tauri/src/lib.rs` (hacer público el módulo: `mod escpos;` → `pub mod escpos;`)
- Create: `src-tauri/examples/preview_receipt.rs`

**Interfaces:**
- Consumes: `escpos::build` (Task 3). El crate de librería se llama `_kromi_tauri_scaffold_lib` (ver `[lib] name` en `src-tauri/Cargo.toml`).

- [ ] **Step 1: Hacer público el módulo `escpos`**

En `src-tauri/src/lib.rs`, línea 1, cambiar `mod escpos;` por `pub mod escpos;` (los structs `Item/Negocio/ReceiptPayload/Social` y `build` ya son `pub`).

- [ ] **Step 2: Crear el ejemplo de preview**

Crear `src-tauri/examples/preview_receipt.rs`. Arma una boleta de ejemplo con descuento global + dcto de línea y vuelca el ticket como texto (filtrando comandos de control), para revisar el layout de totales sin impresora.

```rust
// Vista previa en texto del ticket (layout de totales). Corre con CWD=src-tauri/.
// cargo run --example preview_receipt
use _kromi_tauri_scaffold_lib::escpos::{build, Item, Negocio, ReceiptPayload, Social};

fn main() {
    let p = ReceiptPayload {
        negocio: Negocio {
            nombre_comercial: "Planta con Mati".into(),
            razon_social: "San Jose SpA".into(),
            rut: "78.444.692-1".into(),
            giro: "Venta al por menor de plantas".into(),
            direccion: "General Urrutia 630 local 104".into(),
            footer: "Gracias por tu compra!".into(),
            printer_name: "preview".into(),
            social: Some(Social { red: "Instagram".into(), url: "https://instagram.com/plantaconmati".into(), etiqueta: "@plantaconmati".into() }),
        },
        folio: 5012,
        fecha: "18/07/2026".into(), hora: "16:05".into(),
        items: vec![
            Item { nombre: "Suculenta grande".into(), qty: 2, precio: 5000, descuento: 1000 },
            Item { nombre: "Marantha".into(), qty: 1, precio: 8990, descuento: 0 },
        ],
        neto: 13606, iva: 2585, total: 16191, descuento: 1799,
        canje_pts: 0, canje_monto: 0,
        dte_folio: Some(5012), timbre_png: None, reimpresion: false,
        metodo: "tarjeta".into(), open_drawer: false,
        doc_type: "boleta".into(),
        recep_rut: None, recep_razon: None, recep_giro: None, recep_dir: None,
    };
    let bytes = build(&p);
    // Volcar solo texto imprimible + saltos de línea.
    for &c in &bytes {
        if c == 0x0A { println!(); }
        else if (0x20..0x7F).contains(&c) { print!("{}", c as char); }
    }
    println!();
}
```

- [ ] **Step 3: Correr el preview**

Run: `cd src-tauri && cargo run --example preview_receipt`
Expected: imprime el ticket en texto; verificar que aparezca el bloque:

```
Subtotal                                  $17.990
Descuento global 10%                       -$1.799
------------------------------------------------
Neto                                      $13.606
IVA 19%                                    $2.585
        TOTAL            $16.191
```

y que el descuento de línea "Descuento 10%  -$1.000" salga bajo "Suculenta grande" (2×5.000=10.000, dcto 1.000 = 10%).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/examples/preview_receipt.rs src-tauri/src/lib.rs
git commit -m "test(escpos): ejemplo de vista previa del ticket para validar layout"
```

---

## Notas de verificación final

- `pnpm test` (Vitest: money + detalle) y `cd src-tauri && cargo test` (escpos) en verde.
- `pnpm build` sin errores de tipos.
- Preview del ticket (Task 8) muestra el layout aprobado; preview del logo (Task 7) legible.
- Validación demo (Task 6): boleta con descuento **Aceptada sin reparo** en el SII (ambiente 0).
- Producción intacta: no se emitió ningún DTE real ni se tocó `SIMPLEFACTURA_AMBIENTE`.
