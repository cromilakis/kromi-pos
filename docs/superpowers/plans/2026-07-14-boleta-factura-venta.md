# Boleta (39) vs Factura (33) en la venta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elegir boleta (39) o factura (33) en la venta; la factura se emite a un cliente-empresa con datos tributarios y detalle en netos derivados.

**Architecture:** `customer` gana datos tributarios (empresa). `sale` gana `doc_type`; `charge_sale` lo persiste y valida factura⇒cliente-empresa (cálculo IVA sin cambios, precios con IVA incluido). `issue-receipt` se generaliza para ramificar 39/33 leyendo `sale.doc_type`. La UI del cobro ofrece boleta/factura; la impresión y el historial distinguen el tipo.

**Tech Stack:** Postgres/Supabase (migraciones + tests psql), Deno edge function (issue-receipt), Rust (src-tauri/escpos.rs), React+TS+Vite, Vitest.

## Global Constraints
- Prosa/UI español; identificadores inglés.
- Commits SOLO `Cromilakis <ipcromilakis@gmail.com>` (autor y committer), sin `Co-Authored-By` ni atribución a Claude. Usar `git -c user.name=... -c user.email=... commit --author=...`.
- NUNCA `git add -A`; solo archivos tocados.
- No editar migraciones históricas; migraciones nuevas aditivas.
- Precios del catálogo con IVA incluido; la factura DERIVA el neto (no hay doble precio).
- Deploys cloud (`db push`, `functions deploy`) y verificación e2e que consuma folios SII → SOLO con confirmación del usuario.
- Rama: `feature/notas-credito`. Supabase local (Docker `supabase_db_kromi-pos`) arriba.

## Referencias de código (verificadas)
- `customer`: `supabase/migrations/20260707100000_catalog.sql:169-182`. Data: `src/data/customers.ts` (CustomerRow :4-12, select :28, createCustomer :38-52, updateCustomer :54). Form: `src/modules/clientes/CustomerForm.tsx` (estado :30-32, inputs :110-121, save :50-82). Helper RUT: `src/lib/rut.ts` (`normalize_rut` en BD, migración 20260714130000:19).
- `sale`: `supabase/migrations/20260707100100_operations.sql:47-65`. `dte_*`: `20260708150000_sale_dte.sql`.
- `charge_sale`/`_register_sale` vigentes: `charge_sale` en `20260714180000_points_config_redeem.sql` (última recreación con `p_points_redeem`); `_register_sale` idem. (Usar SIEMPRE la última recreación como base.)
- Emisión: `src/data/sii.ts` (`issueReceipt(saleId)` :12-13). Edge: `supabase/functions/issue-receipt/index.ts` (EMISOR :10-16, select venta :52-55, IdDoc :103, Receptor :106, Totales :109, Detalle :65-81, DscRcgGlobal :87-98, timbre :136-144, persistencia :147-149).
- Venta: `VentaScreen.tsx` (handleConfirmPay :347, chargeSale :351-360, issueReceipt :380, render PayDialog :~692, selectedCustomer). PayDialog: `src/modules/venta/PayDialog.tsx`.
- Skill: `.claude/skills/simplefactura-dte/SKILL.md` (factura 33: Emisor con Acteco, FmaPago, Receptor completo, detalle neto).

---

### Task 1: Migración cliente-empresa + data layer

**Files:** Create `supabase/migrations/20260714190000_customer_empresa.sql`; Modify `src/data/customers.ts`.

**Interfaces:** Produces `customer.is_company/rut/razon_social/giro/direccion/comuna`; `CustomerRow` + create/update con esos campos.

- [ ] **Step 1: Migración**
```sql
alter table public.customer
  add column if not exists is_company   boolean not null default false,
  add column if not exists rut          text,
  add column if not exists razon_social text,
  add column if not exists giro         text,
  add column if not exists direccion    text,
  add column if not exists comuna       text;
```
- [ ] **Step 2: Aplicar** — `pnpm db:reset` (sin errores).
- [ ] **Step 3: `customers.ts`** — agregar los 6 campos a `CustomerRow`; al `select` (:28) `,is_company,rut,razon_social,giro,direccion,comuna`; a `createCustomer` y `updateCustomer` los campos (todos opcionales/nullable). Mapear en el resultado.
- [ ] **Step 4: Typecheck** — `pnpm exec tsc -b` (si rompe solo en CustomerForm por campos nuevos, es Task 2; documentar).
- [ ] **Step 5: Commit** — `feat(clientes): datos tributarios de empresa en customer (migracion + data)`.

---

### Task 2: CustomerForm — toggle Empresa + datos tributarios

**Files:** Modify `src/modules/clientes/CustomerForm.tsx`.

**Interfaces:** Consumes CustomerRow/create/update (Task 1). Usa validación de RUT de `src/lib/rut.ts`.

- [ ] **Step 1:** Estado nuevo: `isCompany`, `rut`, `razonSocial`, `giro`, `direccion`, `comuna`. Cargar del `customer` al editar.
- [ ] **Step 2:** Toggle "Empresa (factura)". Cuando `isCompany`, mostrar inputs RUT/Razón social/Giro/Dirección/Comuna.
- [ ] **Step 3:** Validación en `save()`: si `isCompany`, exigir RUT válido (helper de `rut.ts`), razón social, giro, dirección, comuna no vacíos; toast.error si falta. Pasar los campos a create/update (si no es empresa, enviarlos null).
- [ ] **Step 4:** `pnpm exec tsc -b` limpio.
- [ ] **Step 5: Commit** — `feat(clientes): formulario de cliente empresa (RUT, razon social, giro, direccion, comuna)`.

---

### Task 3: Migración `sale.doc_type` + `charge_sale` p_doc_type

**Files:** Create `supabase/migrations/20260714200000_sale_doc_type.sql`; Modify `supabase/tests/rpc_test.sql`.

**Interfaces:** Produces `sale.doc_type`; `charge_sale` con `p_doc_type text default 'boleta'` (10º parámetro).

- [ ] **Step 1: Migración** — columna + recrear charge_sale:
```sql
alter table public.sale
  add column if not exists doc_type text not null default 'boleta'
    check (doc_type in ('boleta','factura'));
```
Recrear `charge_sale` (base: cuerpo vigente en `20260714180000_points_config_redeem.sql`, COPIAR VERBATIM salvo el delta): `drop function` de la firma vigente (9 args: ...,p_points_redeem) + `create` con 10º parámetro `p_doc_type text default 'boleta'` + `grant`. Delta de cuerpo:
  - Tras validar caja/negocio, si `p_doc_type = 'factura'`:
    ```sql
    if p_customer is null then raise exception 'la factura requiere un cliente'; end if;
    perform 1 from public.customer where id = p_customer and is_company = true and rut is not null and rut <> '';
    if not found then raise exception 'la factura requiere un cliente empresa con RUT'; end if;
    ```
  - `p_doc_type` debe validarse en `('boleta','factura')` (o dejar que el check de columna lo haga al insertar).
  - Persistir el tipo: pasar a `_register_sale` NO cambia (no calcula distinto); tras crear la venta, `update public.sale set doc_type = p_doc_type where id = v_sale.id; select * into v_sale ...;` (o insertar el doc_type dentro de `_register_sale` si se prefiere; para no tocar `_register_sale`, hacer el update post-insert en `charge_sale`).
  - `grant execute on function public.charge_sale(uuid,uuid,jsonb,public.sale_method,int,uuid,jsonb,uuid,int,text) to authenticated;`
- [ ] **Step 2: Tests** — en `rpc_test.sql`: (a) `charge_sale(...,p_doc_type=>'factura')` sin cliente → excepción; (b) con cliente persona (is_company=false) → excepción; (c) con cliente empresa (is_company=true, rut) → ok, `sale.doc_type='factura'`; (d) boleta default sigue ok con `doc_type='boleta'`. Sembrar un customer empresa en el test.
- [ ] **Step 3:** `pnpm test:db` contra esquema viejo → falla (columna/param inexistente).
- [ ] **Step 4:** `pnpm db:reset`.
- [ ] **Step 5:** `pnpm test:db` verde. Actualizar `schema_test.sql` si valida columnas de sale.
- [ ] **Step 6: Commit** — `feat(db): sale.doc_type + charge_sale valida factura⇒cliente empresa`.

---

### Task 4: Data layer venta — doc_type en chargeSale/Sale/consultas

**Files:** Modify `src/data/sales.ts`, `src/data/salesHistory.ts`.

- [ ] **Step 1:** `chargeSale` args + rpc: agregar `p_doc_type?: "boleta"|"factura"` (default 'boleta' en el `?? 'boleta'`). `Sale` interface: `doc_type: string`.
- [ ] **Step 2:** `SaleDteRow` (useSalesTodayDte) y `SaleHistoryRow` (useSalesHistory): agregar `doc_type` al tipo, al select y al mapeo.
- [ ] **Step 3:** `pnpm exec tsc -b` (si rompe solo en PayDialog/VentaScreen por el arg nuevo, es Task 5; documentar).
- [ ] **Step 4: Commit** — `feat(data): doc_type en chargeSale, Sale y consultas de venta`.

---

### Task 5: UI venta — selector Boleta/Factura

**Files:** Modify `src/modules/venta/PayDialog.tsx`, `src/modules/venta/VentaScreen.tsx`.

**Interfaces:** Consumes chargeSale p_doc_type (Task 4); `selectedCustomer` (con is_company/datos).

- [ ] **Step 1:** PayDialog prop nueva `customer` (o `canFactura: boolean` + para mostrar hint). Estado `docType: "boleta"|"factura"` (default "boleta"); reset al abrir.
- [ ] **Step 2:** Selector Boleta/Factura (dos botones/segmented). "Factura" deshabilitada si `!canFactura` (cliente no-empresa o sin datos), con hint "Elige un cliente empresa para facturar". Ampliar `onConfirm` a `(method, recv, discountId, pointsRedeem, docType)`.
- [ ] **Step 3:** VentaScreen: `handleConfirmPay(method, recv, discountId, pointsRedeem = 0, docType = "boleta")`; pasar `p_doc_type: docType` a `chargeSale`. Calcular `canFactura = !!selectedCustomer?.is_company && !!selectedCustomer?.rut` y pasarlo a PayDialog. Ajustar CotizacionesScreen si usa PayDialog (callback con menos args sigue válido en TS).
- [ ] **Step 4:** `pnpm exec tsc -b` limpio.
- [ ] **Step 5: Commit** — `feat(venta): selector boleta/factura en el cobro`.

---

### Task 6: Emisión DTE — generalizar issue-receipt para 39/33

**Files:** Modify `supabase/functions/issue-receipt/index.ts`. (SOLO código; NO deploy, NO emisión — verif e2e = usuario.)

**Interfaces:** Consumes `sale.doc_type` + `customer` datos.

- [ ] **Step 1:** Select de la venta: agregar `doc_type,customer_id` y, cuando factura, cargar el `customer` (RUT, razon_social, giro, direccion, comuna) — join o segundo query por `customer_id`.
- [ ] **Step 2:** Ramificar por `sale.doc_type`:
  - **boleta:** como hoy (TipoDTE 39, Emisor actual, Receptor "Consumidor Final", detalle con IVA incluido, timbre 39).
  - **factura:** `TipoDTE:33`; Emisor con `Acteco` (array) + `CiudadOrigen` desde nuevas env vars (`SF_EMISOR_ACTECO`, `SF_EMISOR_CIUDAD`), formato factura (`RznSoc`/`GiroEmis` según skill); `IdDoc` con `FmaPago:1` (sin `IndServicioBoleta`); `Receptor` real del customer (`RUTRecep`, `RznSocRecep`, `GiroRecep`, `DirRecep`, `CmnaRecep`); **Detalle en netos**: para cada línea `PrcItem = round(price_snapshot/1.19)`, `MontoItem = round((price_snapshot*qty)/1.19) - descNeto`, `DescuentoMonto` neto si aplica. `Totales`: `MntNeto = Σ MontoItem`, `IVA = round(MntNeto*0.19)`, `MntTotal = MntNeto + IVA`. Timbre `codigoTipoDte:33`.
- [ ] **Step 3:** Consultar el skill `simplefactura-dte` para los nombres/estructura EXACTOS del Emisor factura (Acteco, GiroEmis) y Receptor, y respetar enums. Documentar el payload emitido.
- [ ] **Step 4:** `deno check` si disponible; si no, revisión manual. Verif e2e (emisión real 33, redondeo, aceptación SII) = usuario (consume folios).
- [ ] **Step 5: Commit** — `feat(dte): issue-receipt emite factura 33 (receptor empresa, detalle neto) o boleta 39`.

---

### Task 7: Impresión — comprobante de factura

**Files:** Modify `src-tauri/src/escpos.rs`, `src/modules/venta/VentaScreen.tsx`, `src/modules/historial/HistorialScreen.tsx`.

- [ ] **Step 1: escpos.rs** — `ReceiptPayload` gana `doc_type: String` (`#[serde(default)]`) y datos receptor opcionales (`recep_rut`, `recep_razon`, `recep_giro`, `recep_dir` con `#[serde(default)]`). Render: encabezado "FACTURA ELECTRONICA" si `doc_type=="factura"` (si no, el actual); bloque de receptor en factura; el desglose Neto/IVA ya se imprime. Actualizar `sample()` de tests.
- [ ] **Step 2:** Poblar en VentaScreen (emisión/reimpresión) y HistorialScreen: `doc_type` desde `sale.doc_type`, y datos del receptor desde el cliente cuando es factura.
- [ ] **Step 3:** `pnpm exec tsc -b` limpio; `cargo test --lib escpos` + `cargo check` en `src-tauri`.
- [ ] **Step 4: Commit** — `feat(print): comprobante de factura (encabezado + receptor + desglose)`.

---

### Task 8: Historial — etiqueta Boleta/Factura

**Files:** Modify `src/modules/historial/HistorialScreen.tsx`.

- [ ] **Step 1:** Mostrar una etiqueta "Boleta"/"Factura" por venta (usa `row.doc_type`), junto al folio SII o la pill de estado.
- [ ] **Step 2:** `pnpm exec tsc -b` limpio.
- [ ] **Step 3: Commit** — `feat(historial): etiqueta boleta/factura por venta`.

---

## Notas de ejecución
- **Orden de deploy a producción (con confirmación del usuario):** `db push` (Tasks 1,3) → `functions deploy issue-receipt` (Task 6) + configurar secrets `SF_EMISOR_ACTECO`/`SF_EMISOR_CIUDAD` → frontend.
- La emisión real de factura 33 requiere CAF de factura cargado en SimpleFactura y completar la certificación 33 (sets SOK ya obtenidos; falta Declaración de Cumplimiento). Validar contra EMISIÓN real (no `/dte/preview`).
- Punto de mayor riesgo: redondeo neto por línea vs total (Task 6) — validar en emisión real; el total puede diferir ±1 peso del `sale.total`.
