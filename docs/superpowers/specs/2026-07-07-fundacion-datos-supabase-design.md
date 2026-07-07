# Diseño — ① Fundación de datos y lógica de negocio (Supabase)

**Proyecto:** kromi-pos
**Fecha:** 2026-07-07
**Sub-proyecto:** ① de 3 (ver "Descomposición" abajo)
**Estado:** aprobado en brainstorming; pendiente de plan de implementación.

---

## 1. Contexto y motivación

Hoy `kromi-pos` es un **prototipo funcional sin persistencia**: toda la app vive en
`src/index.html` (~4390 líneas) sobre un runtime de prototipado ("dc-runtime",
`src/support.js`). Los datos (23 productos, 17 ventas, clientes, usuarios) son **seeds
escritos a mano en el constructor** de la clase `Component` y **se pierden en cada recarga**.
No existe ninguna base de datos ni `localStorage`; las llamadas a Tauri son solo para
imprimir. El "respaldo automático" es cosmético.

Este sub-proyecto construye la **base de datos real y la lógica de negocio** que faltan.
No migra datos (no hay ninguno real): toma la *forma* de las entidades y la *lógica* que el
prototipo tiene en memoria y las convierte en tablas, funciones e invariantes reales en
Postgres/Supabase.

## 2. Decisiones fijadas (del brainstorming)

| Tema | Decisión |
|---|---|
| Persistencia | Supabase / Postgres **central** |
| Modo | **Online-only ahora**, esquema **preparado para sync** después |
| Tenancy | **Un negocio → N sucursales → N cajas** (no SaaS multi-negocio) |
| Rol `kromi` | Equipo interno (super-admin), no operador de la tienda |
| Autenticación | **RUT + PIN** sobre Supabase Auth |
| Lógica crítica | **Funciones RPC en Postgres** (atómicas); escrituras simples directas + RLS |
| Folios | **Correlativo por sucursal** |
| Datos iniciales | **Arranca vacía**: 1 negocio, 1 sucursal, 1 usuario admin |
| Patrón de trabajo | Supabase CLI + migraciones versionadas + RLS aparte + tests (igual que kromi-dpc) |
| Frontend | Reescritura React+Vite → **fuera de este sub-proyecto** (② y ③) |
| Boleta electrónica SII | **Fuera de alcance** (folios internos, no folios CAF del SII) |

## 3. Descomposición del proyecto completo

El objetivo global ("salir del prototipo, implementar lógica + base de datos + reescribir
frontend en React/Vite") es demasiado grande para un solo spec. Se divide en tres
sub-proyectos, cada uno con su propio spec → plan → implementación:

1. **① Fundación de datos y lógica (Supabase)** — *este documento*. No depende del frontend;
   se diseña, construye y prueba de forma aislada.
2. **② Andamiaje del frontend** — Tauri 2 + Vite + React, capa de acceso a datos (cliente
   Supabase + auth), routing, layout, sistema de diseño portado.
3. **③ Portado de módulos** — Login → Venta → Stock → Clientes → Cierre → Historial → Admin,
   cada uno cableado a datos reales.

## 4. Arquitectura y entorno

- `supabase init` en `kromi-pos/supabase/`. Desarrollo **local con Docker**
  (`supabase start`, `supabase db reset`), como en kromi-dpc. La nube no se toca hasta que
  el usuario cree el proyecto cloud y se linkee (**bloqueo de autonomía**: crear el proyecto
  y las credenciales las provee el usuario).
- Migraciones SQL versionadas, ordenadas por dependencia:
  1. `..._catalog.sql` — tablas maestras (negocio, sucursales, cajas, usuarios, categorías,
     productos, proveedores, clientes, inventario, módulos).
  2. `..._operations.sql` — sesiones de caja, ventas+líneas, cotizaciones+líneas, notas de
     crédito+líneas, contadores de folio.
  3. `..._functions.sql` — funciones RPC de negocio.
  4. `..._rls.sql` — políticas Row Level Security.
  5. `..._seed_min.sql` — negocio + sucursal + admin mínimos (idempotente).
- El futuro frontend accede de **dos maneras**:
  - **Escrituras simples** directas vía PostgREST (`from('products').insert(...)`),
    controladas por RLS (crear/editar producto, cliente, categoría, proveedor, config).
  - **Operaciones críticas** vía `rpc('cobrar_venta', ...)` etc. (atómicas en servidor).

## 5. Modelo de datos

### 5.1 Convenciones transversales (para todas las tablas)

- PK `id uuid default gen_random_uuid()`.
- `created_at timestamptz default now()`, `updated_at timestamptz` mantenido por trigger
  `set_updated_at()`.
- `deleted_at timestamptz null` (soft-delete) en tablas editables por el usuario:
  `product`, `category`, `customer`, `supplier`, `app_user`. Las consultas de la app filtran
  `deleted_at is null`.
- Todo montos en **CLP enteros** (sin decimales), IVA **incluido** en `price`/`total`.
- Toda tabla con datos de negocio lleva `business_id uuid` (para RLS y futuro multi-negocio).

> **Por qué UUID + `updated_at` + `deleted_at`:** son los tres requisitos mínimos para poder
> agregar sincronización local↔nube en una fase posterior sin rehacer el esquema. Los folios
> (correlativos visibles) siguen siendo enteros, pero la identidad real es el UUID.

### 5.2 Tenancy y estructura

**`business`** — el negocio y **toda su configuración/branding** (consolida `cfgRecibo`,
`cfgAccent`, `brandLogo`, `loginCover`, `adminEmail`, `plan` del prototipo):
`id, name, rut, giro, direccion, tagline, footer, social_red, social_url, accent,
logo_url, login_cover_url, plan ('Básico'|'Pro'), admin_email, created_at, updated_at`.

**`branch`** (sucursal): `id, business_id→business, name, address, active bool,
created_at, updated_at`.

**`register`** (caja física): `id, branch_id→branch, name, active bool, timestamps`.

**`cash_session`** (sesión de caja; reemplaza el contador `cajaSessionId`):
`id, register_id→register, branch_id→branch, opened_by→app_user, opened_at, closed_at null,
float_amount int default 50000, counted int null, status ('open'|'closed'), created_at,
updated_at`.
Invariante: **a lo sumo una sesión `open` por `register`** (índice único parcial).

### 5.3 Maestros (nivel negocio, compartidos entre sucursales)

**`app_user`** (personal): `id uuid` **= `auth.users.id`**, `business_id→business, name,
rut text, role ('admin'|'cajero'|'kromi'), active bool, created_at, updated_at, deleted_at`.
`UNIQUE(business_id, rut)`. **El PIN no se guarda aquí** (vive hasheado en Supabase Auth).

**`category`**: `id, business_id, key text (slug), label, dot, tile, pill_bg, pill_fg,
sort int, timestamps, deleted_at`. `UNIQUE(business_id, key)`. No se puede eliminar una
categoría con productos activos (se valida en la app y/o RESTRICT en FK).

**`product`**: `id, business_id, name, category_id→category, price int, min_stock int
default 0, critical bool default false, img_url text null, supplier_id→supplier null,
active bool default true, timestamps, deleted_at`. El código de barras se deriva por fórmula
en la app (`'750'+pad(10000000+seq)`), **no** se almacena en ①.

**`supplier`**: `id, business_id, razon_social, rut, giro, contact_name, phone, email,
address, website, pay_terms ('contado'|'30'|'60'|'90'), category, bank, account, notes,
active bool, timestamps, deleted_at`.

**`customer`**: `id, business_id, name, email, phone, points int default 0, spent int
default 0, visits int default 0, created_by→app_user null, timestamps, deleted_at`.

### 5.4 Inventario (nivel sucursal)

**`inventory`**: `product_id→product, branch_id→branch, stock int default 0,
updated_at`. **PK compuesta `(product_id, branch_id)`**. Vuelve real el stock por sucursal
que en el prototipo era ficticio (`branchStock` derivado por fórmula). `stock` con
`CHECK (stock >= 0)`.

### 5.5 Documentos (nivel sucursal)

**`sale`**: `id, business_id, branch_id, cash_session_id→cash_session, folio int, method
('efectivo'|'tarjeta'), total int, neto int, iva int, recv int, change int, points int,
customer_id→customer null, cashier_id→app_user, sold_at timestamptz, created_at`.
`UNIQUE(branch_id, folio)`.

**`sale_line`**: `id, sale_id→sale (on delete cascade), product_id→product null,
name_snapshot text, price_snapshot int, category_snapshot text, qty int`. Guarda **FK real
a producto** *y* snapshot del momento (el prototipo solo tenía snapshot por nombre, frágil).

**`quote`** (cotización): `id, business_id, branch_id, folio int, customer_id null,
valid_until date, total, neto, iva, converted bool default false, sale_id→sale null,
created_at`. `UNIQUE(branch_id, folio)`.
**`quote_line`**: `id, quote_id→quote (cascade), product_id null, name_snapshot,
price_snapshot, qty`.

**`credit_note`** (nota de crédito): `id, business_id, branch_id,
cash_session_id→cash_session null, folio int, sale_id→sale null, method, reason text,
total, neto, iva, cashier_id→app_user, created_at`. `UNIQUE(branch_id, folio)`.
**`credit_note_line`**: `id, credit_note_id→credit_note (cascade), product_id null,
name_snapshot, price_snapshot, qty, restock bool default false`.

### 5.6 Folios sin colisiones

**`folio_counter`**: `branch_id→branch, doc_type ('sale'|'quote'|'credit_note'),
next_value int default 1`. **PK `(branch_id, doc_type)`**. Las funciones RPC obtienen el
folio con `UPDATE folio_counter SET next_value = next_value + 1 WHERE ... RETURNING`
(o `SELECT ... FOR UPDATE`), garantizando que dos cajas de la misma sucursal **nunca** saquen
el mismo folio. Valores iniciales por sucursal alineados con el prototipo son opcionales
(sale=1, quote=1, credit_note=1 al arrancar vacío).

### 5.7 Módulos contratados

**`module_state`**: `id, business_id, module_key ('stock'|'clientes'|'metricas'),
active bool, pending_end text null, timestamps`. `UNIQUE(business_id, module_key)`.
**`module_notice`** (historial): `id, business_id, module_key, action, email, at timestamptz`.

## 6. Lógica de negocio (funciones RPC)

Todas `SECURITY DEFINER` con `search_path` fijo, corren en **una sola transacción** y validan
permisos/tenancy internamente. Ante error, `RAISE EXCEPTION` con mensaje claro (el cliente lo
muestra) y **revierten por completo**.

- **`cobrar_venta(p_branch, p_session, p_lines jsonb, p_method, p_recv, p_customer null)`**
  1. valida que `p_session` esté `open` y pertenezca a `p_branch`;
  2. valida stock disponible por línea en `inventory(product, branch)`;
  3. obtiene folio vía `folio_counter(branch,'sale')`;
  4. calcula `total = Σ(qty·price)`, `neto = round(total/1.19)`, `iva = total-neto`,
     `points = floor(total/1000)`, `change = recv-total` (exige `recv >= total` si efectivo);
  5. inserta `sale` + `sale_line` (con FK y snapshot);
  6. **decrementa `inventory`** por línea;
  7. si hay cliente: `points += points`, `spent += total`, `visits += 1`;
  8. devuelve la venta creada (para impresión de boleta).

- **`abrir_caja(p_register, p_float)`** → crea `cash_session` `open`; falla si ya hay una
  abierta en esa caja.
- **`cerrar_caja(p_session, p_counted)`** → suma ventas y NC de la sesión (efectivo/tarjeta),
  calcula descuadre `counted - (float + efectivo_neto)`, marca `closed`, `closed_at=now()`;
  devuelve el resumen del cierre.
- **`emitir_nota_credito(p_branch, p_session, p_sale null, p_method, p_reason, p_lines jsonb)`**
  → inserta `credit_note` + líneas, **repone `inventory`** en las líneas con `restock=true`,
  obtiene folio `credit_note`, recalcula IVA.
- **`convertir_cotizacion(p_quote, p_session, p_method, p_recv)`** → valida vigencia
  (`valid_until >= today`), reconstruye líneas desde `quote_line`, reusa `cobrar_venta`,
  marca `quote.converted=true` y `quote.sale_id`.
- Helper **`siguiente_folio(p_branch, p_doc_type)`** usado por las anteriores.

## 7. Autenticación y seguridad (RLS)

### 7.1 RUT + PIN sobre Supabase Auth

- El RUT normalizado (sin puntos/guion) se mapea a un **email sintético interno**:
  `{rut}@pos.kromi.local`. El **PIN es el password** (Supabase Auth lo hashea con bcrypt).
- Se ajusta el largo mínimo de password en la config de Supabase para permitir **PIN de 4
  dígitos**. El cajero solo ve "RUT + PIN"; el email sintético es un detalle interno.
- Alta de usuario: crea el registro en `auth.users` (email sintético + PIN) y la fila
  espejo en `app_user` con `id = auth.users.id`. Se hace vía función/servicio de alta
  (rol admin), no por el cliente anónimo.
- El `business_id` y el `role` del usuario se exponen como claims/consulta para las políticas
  RLS.

### 7.2 Row Level Security

- **Todas** las tablas con `business_id` tienen RLS activo.
- Lectura: un usuario solo ve filas de **su** `business_id`. El rol `kromi` (equipo interno)
  puede ver todo.
- Escritura por rol:
  - `cajero`: crear ventas (vía RPC), crear/editar clientes, abrir/cerrar su caja.
  - `admin`: todo lo del cajero + catálogo (productos, categorías, proveedores), personal,
    configuración/branding, módulos.
  - `kromi`: acceso total (soporte de plataforma).
- Los usuarios pertenecen al **negocio** (no a una sucursal fija); la sucursal se determina al
  operar (abrir caja en un `register` de una `branch`). *(Decisión revisable si más adelante
  se quiere fijar cajeros a una sucursal.)*

## 8. Manejo de errores

- Las funciones RPC lanzan `RAISE EXCEPTION USING message = '...'` con textos accionables en
  español: `stock insuficiente para <producto>`, `la caja no está abierta`,
  `el efectivo recibido es menor al total`, `cotización vencida`, etc.
- Constraints de base como última línea de defensa: `CHECK (stock >= 0)`,
  `UNIQUE(branch_id, folio)`, FKs con `RESTRICT`/`CASCADE` según corresponda.

## 9. Testing y verificación

- **Tests SQL (pgTAP)** en `supabase/tests/`, siguiendo el patrón de kromi-dpc, cubriendo los
  invariantes que importan:
  - el folio **nunca colisiona** entre dos cobros concurrentes de la misma sucursal;
  - el stock **nunca queda negativo** (venta que excede stock falla y no altera nada);
  - `cobrar_venta` **revierte por completo** ante un fallo a mitad (atomicidad);
  - RLS **aísla por negocio** (un usuario de negocio A no ve datos de B).
- **Verificación manual** sobre Supabase local: `supabase db reset`, ejecutar `abrir_caja` →
  `cobrar_venta` → `cerrar_caja` con datos de ejemplo y confirmar el estado resultante en las
  tablas (`sale`, `sale_line`, `inventory`, `cash_session`, `folio_counter`).

## 10. Fuera de alcance de ①

- Consola multi-negocio del rol `kromi` (dashboard `businesses` del prototipo).
- Métricas reales derivadas de ventas (el prototipo usa datos sintéticos con PRNG).
- Todo el frontend React/Vite (sub-proyectos ② y ③).
- Boleta electrónica al SII (folios CAF): folios internos únicamente.
- Sincronización local↔nube: el esquema **queda preparado** (UUID/`updated_at`/`deleted_at`),
  pero la implementación del sync es fase posterior.

## 11. Trazabilidad al prototipo

| Entidad/lógica del prototipo (`src/index.html`) | Destino en ① |
|---|---|
| `products` seed (`P(...)`, ~:2448) | tabla `product` + `inventory` por sucursal |
| `categories` (:2284) | tabla `category` |
| `customers` (:2473) | tabla `customer` |
| `users` (:2306, PIN texto plano) | `app_user` + Supabase Auth (PIN hasheado) |
| `sales` + `lines` (:2481, cobro en `confirmPay` :3026) | `sale` + `sale_line`, RPC `cobrar_venta` |
| `quotes` (`createQuote` :2977, `convertQuote` :3000) | `quote` + `quote_line`, RPC `convertir_cotizacion` |
| `creditNotes` (`saveCreditNote` :2758) | `credit_note` + `credit_note_line`, RPC `emitir_nota_credito` |
| `cierres` (`doCierre` :2703) + `cajaSessionId` | `cash_session` + RPC `abrir_caja`/`cerrar_caja` |
| `suppliers` (:2431) | `supplier` |
| `cfgRecibo`/`cfgAccent`/branding/`adminEmail` | columnas en `business` |
| `cfgModules`/`modulePending`/`moduleNotices` | `module_state` + `module_notice` |
| `folioSeq`/`quoteSeq`/`ncSeq` (contadores en memoria) | tabla `folio_counter` por sucursal |
| IVA 19% incluido, `neto=round(total/1.19)` | funciones RPC |
| stock por sucursal ficticio (`branchStock` :2629) | tabla `inventory` real |
