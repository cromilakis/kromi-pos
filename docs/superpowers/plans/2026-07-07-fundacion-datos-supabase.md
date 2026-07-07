# Fundación de datos y lógica (Supabase) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la base de datos y la lógica de negocio reales de kromi-pos en Supabase/Postgres (esquema, folios, RPC atómicas, auth RUT+PIN, RLS), reemplazando el estado en memoria del prototipo.

**Architecture:** Supabase CLI con migraciones SQL versionadas, desarrolladas y probadas en Postgres local (Docker). Un negocio → N sucursales → N cajas. Escrituras simples directas (protegidas por RLS) + operaciones críticas como funciones RPC atómicas. Esquema con UUID/`updated_at`/`deleted_at` para habilitar sync futuro. Online-only por ahora.

**Tech Stack:** Supabase CLI 2.109, Postgres 15+ (local vía Docker), pgcrypto, PostgREST (RPC), Supabase Auth (GoTrue).

## Global Constraints

- Prosa en español; identificadores/código/claves en inglés.
- Montos en **CLP enteros**; IVA **incluido**: `neto = round(total/1.19)`, `iva = total - neto`.
- Toda tabla de negocio lleva `business_id uuid`; PK `uuid default gen_random_uuid()`.
- Toda tabla: `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger). Tablas editables por usuario además `deleted_at timestamptz`.
- Todas las funciones RPC: `security definer`, `set search_path = ''`, referencias con prefijo `public.`/`auth.` calificado.
- **Folio por sucursal**; `UNIQUE(branch_id, folio)` en `sale`, `quote`, `credit_note`.
- PIN de **6 dígitos** = largo mínimo por defecto de Supabase Auth; **no** se modifica la config de Auth.
- RLS habilitado en TODAS las tablas de negocio; `anon` sin acceso directo.
- Identidad de commits: `Cromilakis <ipcromilakis@gmail.com>`; sin co-authors ni atribuciones.
- Bloqueo de autonomía: crear el proyecto Supabase cloud y sus credenciales lo hace el usuario; todo el desarrollo de este plan es **local** (`supabase start`/`db reset`).

## File Structure

- `supabase/config.toml` — config del proyecto local (generado por `supabase init`).
- `supabase/migrations/20260707100000_catalog.sql` — enums, tablas maestras y tenancy, `inventory`, módulos, trigger `set_updated_at`, `norm_rut`.
- `supabase/migrations/20260707100100_operations.sql` — `cash_session`, documentos (`sale`, `quote`, `credit_note`) + líneas, `folio_counter`.
- `supabase/migrations/20260707100200_functions.sql` — RPC: `siguiente_folio`, `abrir_caja`, `cerrar_caja`, `cobrar_venta`, `emitir_nota_credito`, `convertir_cotizacion`.
- `supabase/migrations/20260707100300_auth.sql` — trigger `handle_new_user` (espejo `auth.users`→`app_user`), helper `current_business_id`.
- `supabase/migrations/20260707100400_rls.sql` — helpers de rol, `enable rls`, políticas explícitas, índices de FK.
- `supabase/seed.sql` — seed mínimo local (1 negocio, 1 sucursal, 1 caja, 1 admin, folio_counters, module_state).
- `supabase/tests/schema_test.sql` — existencia de tablas y constraints (stock/unique).
- `supabase/tests/rpc_test.sql` — flujo abrir_caja → cobrar_venta → cerrar_caja + invariantes (folio, stock, atomicidad).
- `supabase/tests/rls_test.sql` — aislamiento por negocio y por rol.
- `package.json` — scripts `db:reset`, `test:schema`, `test:rpc`, `test:rls`, `test:db`.

**Nombre del contenedor Postgres local:** `supabase_db_kromi-pos` (patrón `supabase_db_<project_id>`; `<project_id>` se fija en `config.toml` en la Task 1). Todos los tests se ejecutan con:
`docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < <archivo>`

---

### Task 1: Inicializar Supabase local

**Files:**
- Create: `supabase/config.toml` (vía `supabase init`)
- Modify: `package.json` (agregar scripts)
- Modify: `.gitignore` (ignorar artefactos supabase)

**Interfaces:**
- Produces: entorno Postgres local corriendo en contenedor `supabase_db_kromi-pos`; scripts npm `db:reset` y `test:*`.

- [ ] **Step 1: Inicializar el proyecto Supabase**

Run:
```bash
cd /c/Kromi/kromi-pos && supabase init
```
Esto crea `supabase/config.toml`, `supabase/.gitignore` y carpetas base.

- [ ] **Step 2: Fijar el project_id en config.toml**

En `supabase/config.toml`, asegurar la primera línea:
```toml
project_id = "kromi-pos"
```
(Determina el nombre del contenedor `supabase_db_kromi-pos`.)

- [ ] **Step 3: Agregar scripts a package.json**

En `package.json`, agregar dentro de `"scripts"`:
```json
{
  "scripts": {
    "db:reset": "supabase db reset",
    "test:schema": "docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/schema_test.sql",
    "test:rpc": "docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/rpc_test.sql",
    "test:rls": "docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/rls_test.sql",
    "test:db": "pnpm test:schema && pnpm test:rpc && pnpm test:rls"
  }
}
```
(Si `package.json` no tiene la clave `scripts`, agregarla.)

- [ ] **Step 4: Levantar Supabase local y verificar**

Run:
```bash
cd /c/Kromi/kromi-pos && supabase start
```
Expected: imprime `API URL`, `DB URL`, `anon key`, etc. sin errores. Docker debe estar corriendo.

Verificar el contenedor:
```bash
docker ps --format '{{.Names}}' | grep supabase_db_kromi-pos
```
Expected: imprime `supabase_db_kromi-pos`.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/.gitignore package.json .gitignore
git commit -m "chore(db): inicializar Supabase local para kromi-pos" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 2: Migración `catalog` — tablas maestras, tenancy e inventario

**Files:**
- Create: `supabase/migrations/20260707100000_catalog.sql`
- Test: `supabase/tests/schema_test.sql`

**Interfaces:**
- Produces (tablas `public.`): `business, branch, register, app_user, category, product, supplier, customer, inventory, module_state, module_notice`; enums `user_role, pay_term`; funciones `public.set_updated_at()`, `public.norm_rut(text)`.
- Consumes: entorno local de Task 1.

- [ ] **Step 1: Escribir el test de esquema que falla**

Create `supabase/tests/schema_test.sql`:
```sql
-- ============================================================================
-- Test de esquema (Task 2 + Task 3): existencia de tablas maestras/operativas
-- y constraints críticas. Corre en transacción con ROLLBACK.
--   docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/schema_test.sql
-- ============================================================================
begin;

-- Tablas maestras (Task 2)
do $$
declare t text;
begin
  foreach t in array array[
    'business','branch','register','app_user','category','product',
    'supplier','customer','inventory','module_state','module_notice'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'FALTA tabla public.%', t;
    end if;
  end loop;
end $$;

-- Funciones auxiliares
do $$ begin
  if to_regprocedure('public.norm_rut(text)') is null then
    raise exception 'FALTA funcion public.norm_rut(text)';
  end if;
end $$;

-- norm_rut normaliza (sin puntos/guion, minúscula)
do $$ begin
  if public.norm_rut('11.111.111-1') <> '111111111' then
    raise exception 'norm_rut incorrecto: %', public.norm_rut('11.111.111-1');
  end if;
  if public.norm_rut('12.345.678-K') <> '12345678k' then
    raise exception 'norm_rut no minuscula K: %', public.norm_rut('12.345.678-K');
  end if;
end $$;

-- inventory: PK compuesta y CHECK stock >= 0
do $$ begin
  begin
    insert into public.business (id, name, rut) values
      ('11111111-1111-1111-1111-111111111111','T','1-9');
    insert into public.branch (id, business_id, name) values
      ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','T');
    insert into public.category (id, business_id, key, label) values
      ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','x','X');
    insert into public.product (id, business_id, name, category_id, price) values
      ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','P','33333333-3333-3333-3333-333333333333',1000);
    -- stock negativo debe fallar
    begin
      insert into public.inventory (product_id, branch_id, stock) values
        ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',-1);
      raise exception 'FALLO: inventory acepto stock negativo';
    exception when check_violation then null;
    end;
  end;
end $$;

rollback;
\echo 'schema_test OK'
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd /c/Kromi/kromi-pos && pnpm test:schema`
Expected: FALLA con `FALTA tabla public.business` (la migración aún no existe).

- [ ] **Step 3: Escribir la migración catalog**

Create `supabase/migrations/20260707100000_catalog.sql`:
```sql
-- ============================================================================
-- Migración: catálogo maestro y tenancy de kromi-pos
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §5.2-§5.4, §5.7
-- Contenido: negocio, sucursales, cajas, personal, categorías, productos,
--            proveedores, clientes, inventario por sucursal, módulos.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'cajero', 'kromi');
create type public.pay_term  as enum ('contado', '30', '60', '90');

-- ----------------------------------------------------------------------------
-- Helpers transversales
-- ----------------------------------------------------------------------------
-- updated_at por trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normaliza un RUT: sin puntos ni guion, en minúscula. '11.111.111-1' -> '111111111'.
create or replace function public.norm_rut(p_rut text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_rut,''), '[.\-]', '', 'g'));
$$;

-- ----------------------------------------------------------------------------
-- business — el negocio + branding/config
-- ----------------------------------------------------------------------------
create table public.business (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  rut             text not null,
  giro            text,
  direccion       text,
  tagline         text,
  footer          text,
  social_red      text,
  social_url      text,
  accent          text,
  logo_url        text,
  login_cover_url text,
  plan            text not null default 'Básico',
  admin_email     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.business is 'El negocio (tenant) y toda su configuración/branding.';

-- ----------------------------------------------------------------------------
-- branch — sucursal
-- ----------------------------------------------------------------------------
create table public.branch (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- register — caja física
-- ----------------------------------------------------------------------------
create table public.register (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branch(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- app_user — personal (espejo de auth.users; PIN vive en Supabase Auth)
-- ----------------------------------------------------------------------------
create table public.app_user (
  id          uuid primary key,               -- = auth.users.id
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  rut         text not null,
  role        public.user_role not null default 'cajero',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (business_id, rut)
);

-- ----------------------------------------------------------------------------
-- supplier — proveedores
-- ----------------------------------------------------------------------------
create table public.supplier (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.business(id) on delete cascade,
  razon_social text not null,
  rut          text,
  giro         text,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  website      text,
  pay_terms    public.pay_term not null default 'contado',
  category     text,
  bank         text,
  account      text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ----------------------------------------------------------------------------
-- category — categorías de producto
-- ----------------------------------------------------------------------------
create table public.category (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  key         text not null,
  label       text not null,
  dot         text,
  tile        text,
  pill_bg     text,
  pill_fg     text,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (business_id, key)
);

-- ----------------------------------------------------------------------------
-- product — productos (precio a nivel negocio)
-- ----------------------------------------------------------------------------
create table public.product (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  category_id uuid references public.category(id) on delete restrict,
  price       int not null check (price >= 0),
  min_stock   int not null default 0 check (min_stock >= 0),
  critical    boolean not null default false,
  img_url     text,
  supplier_id uuid references public.supplier(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ----------------------------------------------------------------------------
-- customer — clientes
-- ----------------------------------------------------------------------------
create table public.customer (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  points      int not null default 0 check (points >= 0),
  spent       int not null default 0 check (spent >= 0),
  visits      int not null default 0 check (visits >= 0),
  created_by  uuid references public.app_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ----------------------------------------------------------------------------
-- inventory — stock por sucursal (PK compuesta)
-- ----------------------------------------------------------------------------
create table public.inventory (
  product_id  uuid not null references public.product(id) on delete cascade,
  branch_id   uuid not null references public.branch(id) on delete cascade,
  stock       int not null default 0 check (stock >= 0),
  updated_at  timestamptz not null default now(),
  primary key (product_id, branch_id)
);

-- ----------------------------------------------------------------------------
-- module_state / module_notice — módulos contratados
-- ----------------------------------------------------------------------------
create table public.module_state (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  module_key  text not null check (module_key in ('stock','clientes','metricas')),
  active      boolean not null default true,
  pending_end text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, module_key)
);

create table public.module_notice (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  module_key  text not null,
  action      text not null,
  email       text,
  at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Triggers updated_at
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'business','branch','register','app_user','supplier','category',
    'product','customer','inventory','module_state'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.set_updated_at();', t);
  end loop;
end $$;
```

- [ ] **Step 4: Aplicar migración y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:schema`
Expected: `db reset` aplica sin error y el test imprime `schema_test OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260707100000_catalog.sql supabase/tests/schema_test.sql
git commit -m "feat(db): catálogo maestro, tenancy e inventario por sucursal" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 3: Migración `operations` — documentos y folios

**Files:**
- Create: `supabase/migrations/20260707100100_operations.sql`
- Modify: `supabase/tests/schema_test.sql` (agregar bloque operations)

**Interfaces:**
- Produces (tablas): `cash_session, sale, sale_line, quote, quote_line, credit_note, credit_note_line, folio_counter`; enums `sale_method, session_status, folio_doc`.
- Consumes: tablas de Task 2 (`business, branch, register, app_user, product`).

- [ ] **Step 1: Ampliar el test de esquema (falla)**

En `supabase/tests/schema_test.sql`, agregar antes de `rollback;`:
```sql
-- Tablas operativas (Task 3)
do $$
declare t text;
begin
  foreach t in array array[
    'cash_session','sale','sale_line','quote','quote_line',
    'credit_note','credit_note_line','folio_counter'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'FALTA tabla public.%', t;
    end if;
  end loop;
end $$;

-- Folio único por sucursal en sale
do $$
declare b uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into public.sale (business_id, branch_id, folio, method, total, neto, iva, recv, change, cashier_id)
    values ('11111111-1111-1111-1111-111111111111', b, 1, 'efectivo', 1000, 840, 160, 1000, 0, null);
  begin
    insert into public.sale (business_id, branch_id, folio, method, total, neto, iva, recv, change, cashier_id)
      values ('11111111-1111-1111-1111-111111111111', b, 1, 'efectivo', 1000, 840, 160, 1000, 0, null);
    raise exception 'FALLO: folio duplicado aceptado en la misma sucursal';
  exception when unique_violation then null;
  end;
end $$;
```

- [ ] **Step 2: Correr el test (falla)**

Run: `cd /c/Kromi/kromi-pos && pnpm test:schema`
Expected: FALLA con `FALTA tabla public.cash_session`.

- [ ] **Step 3: Escribir la migración operations**

Create `supabase/migrations/20260707100100_operations.sql`:
```sql
-- ============================================================================
-- Migración: operaciones de kromi-pos (documentos y folios)
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §5.2, §5.5, §5.6
-- Contenido: sesiones de caja, ventas+líneas, cotizaciones+líneas, notas de
--            crédito+líneas, contadores de folio por sucursal.
-- Depende de: 20260707100000_catalog.sql
-- ============================================================================

create type public.sale_method    as enum ('efectivo', 'tarjeta');
create type public.session_status as enum ('open', 'closed');
create type public.folio_doc      as enum ('sale', 'quote', 'credit_note');

-- ----------------------------------------------------------------------------
-- cash_session — sesión de caja (reemplaza el contador cajaSessionId)
-- ----------------------------------------------------------------------------
create table public.cash_session (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.business(id) on delete cascade,
  branch_id    uuid not null references public.branch(id) on delete cascade,
  register_id  uuid not null references public.register(id) on delete cascade,
  opened_by    uuid references public.app_user(id) on delete set null,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  float_amount int not null default 50000 check (float_amount >= 0),
  counted      int,
  status       public.session_status not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- A lo sumo UNA sesión abierta por caja.
create unique index uniq_open_session_per_register
  on public.cash_session (register_id) where status = 'open';

-- ----------------------------------------------------------------------------
-- folio_counter — correlativo por sucursal y tipo de documento
-- ----------------------------------------------------------------------------
create table public.folio_counter (
  branch_id  uuid not null references public.branch(id) on delete cascade,
  doc_type   public.folio_doc not null,
  next_value int not null default 1 check (next_value >= 1),
  primary key (branch_id, doc_type)
);

-- ----------------------------------------------------------------------------
-- sale + sale_line
-- ----------------------------------------------------------------------------
create table public.sale (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.business(id) on delete cascade,
  branch_id       uuid not null references public.branch(id) on delete cascade,
  cash_session_id uuid references public.cash_session(id) on delete set null,
  folio           int not null,
  method          public.sale_method not null,
  total           int not null check (total >= 0),
  neto            int not null,
  iva             int not null,
  recv            int not null default 0,
  change          int not null default 0,
  points          int not null default 0,
  customer_id     uuid references public.customer(id) on delete set null,
  cashier_id      uuid references public.app_user(id) on delete set null,
  sold_at         timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (branch_id, folio)
);

create table public.sale_line (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sale(id) on delete cascade,
  product_id       uuid references public.product(id) on delete set null,
  name_snapshot    text not null,
  price_snapshot   int not null check (price_snapshot >= 0),
  category_snapshot text,
  qty              int not null check (qty > 0)
);

-- ----------------------------------------------------------------------------
-- quote + quote_line
-- ----------------------------------------------------------------------------
create table public.quote (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  branch_id   uuid not null references public.branch(id) on delete cascade,
  folio       int not null,
  customer_id uuid references public.customer(id) on delete set null,
  valid_until date not null,
  total       int not null check (total >= 0),
  neto        int not null,
  iva         int not null,
  converted   boolean not null default false,
  sale_id     uuid references public.sale(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (branch_id, folio)
);

create table public.quote_line (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null references public.quote(id) on delete cascade,
  product_id     uuid references public.product(id) on delete set null,
  name_snapshot  text not null,
  price_snapshot int not null check (price_snapshot >= 0),
  qty            int not null check (qty > 0)
);

-- ----------------------------------------------------------------------------
-- credit_note + credit_note_line
-- ----------------------------------------------------------------------------
create table public.credit_note (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.business(id) on delete cascade,
  branch_id       uuid not null references public.branch(id) on delete cascade,
  cash_session_id uuid references public.cash_session(id) on delete set null,
  folio           int not null,
  sale_id         uuid references public.sale(id) on delete set null,
  method          public.sale_method not null,
  reason          text,
  total           int not null check (total >= 0),
  neto            int not null,
  iva             int not null,
  cashier_id      uuid references public.app_user(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (branch_id, folio)
);

create table public.credit_note_line (
  id             uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.credit_note(id) on delete cascade,
  product_id     uuid references public.product(id) on delete set null,
  name_snapshot  text not null,
  price_snapshot int not null check (price_snapshot >= 0),
  qty            int not null check (qty > 0),
  restock        boolean not null default false
);
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:schema`
Expected: `schema_test OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260707100100_operations.sql supabase/tests/schema_test.sql
git commit -m "feat(db): sesiones de caja, documentos y folios por sucursal" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 4: Funciones RPC — folios y caja

**Files:**
- Create: `supabase/migrations/20260707100200_functions.sql`
- Test: `supabase/tests/rpc_test.sql`

**Interfaces:**
- Produces:
  - `public.siguiente_folio(p_branch uuid, p_doc public.folio_doc) returns int`
  - `public.abrir_caja(p_register uuid, p_float int) returns public.cash_session`
  - `public.cerrar_caja(p_session uuid, p_counted int) returns jsonb`
- Consumes: tablas de Task 2 y Task 3.

- [ ] **Step 1: Escribir el test de folios+caja (falla)**

Create `supabase/tests/rpc_test.sql`:
```sql
-- ============================================================================
-- Test RPC (Task 4 + Task 5): folios, apertura/cierre de caja, cobro,
-- nota de crédito, conversión de cotización. Transacción con ROLLBACK.
--   docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/rpc_test.sql
-- ============================================================================
begin;

-- Fixtures (como postgres, bypassa RLS)
insert into public.business (id, name, rut) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Neg','1-9');
insert into public.branch (id, business_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Centro');
insert into public.register (id, branch_id, name) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Caja 1');
insert into public.folio_counter (branch_id, doc_type, next_value) values
  ('bbbbbbbb-0000-0000-0000-000000000001','sale',1),
  ('bbbbbbbb-0000-0000-0000-000000000001','quote',1),
  ('bbbbbbbb-0000-0000-0000-000000000001','credit_note',1);
insert into public.category (id, business_id, key, label) values
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','plantas','Plantas');
insert into public.product (id, business_id, name, category_id, price) values
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Monstera','dddddddd-0000-0000-0000-000000000001',14990);
insert into public.inventory (product_id, branch_id, stock) values
  ('eeeeeeee-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',8);

-- siguiente_folio incrementa por sucursal
do $$
declare f1 int; f2 int;
begin
  f1 := public.siguiente_folio('bbbbbbbb-0000-0000-0000-000000000001','sale');
  f2 := public.siguiente_folio('bbbbbbbb-0000-0000-0000-000000000001','sale');
  if f1 <> 1 or f2 <> 2 then raise exception 'siguiente_folio no incrementa: % %', f1, f2; end if;
end $$;

-- abrir_caja crea sesión open; segunda apertura en la misma caja falla
do $$
declare s public.cash_session;
begin
  s := public.abrir_caja('cccccccc-0000-0000-0000-000000000001', 50000);
  if s.status <> 'open' then raise exception 'abrir_caja no dejo status open'; end if;
  begin
    perform public.abrir_caja('cccccccc-0000-0000-0000-000000000001', 50000);
    raise exception 'FALLO: se abrio segunda caja sobre una ya abierta';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;
end $$;

\echo 'rpc_test (folios+caja) OK'
rollback;
```

- [ ] **Step 2: Correr el test (falla)**

Run: `cd /c/Kromi/kromi-pos && pnpm test:rpc`
Expected: FALLA con `function public.siguiente_folio(...) does not exist`.

- [ ] **Step 3: Escribir la migración functions (folios + caja)**

Create `supabase/migrations/20260707100200_functions.sql`:
```sql
-- ============================================================================
-- Migración: lógica de negocio (funciones RPC atómicas)
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §6
-- Todas SECURITY DEFINER, search_path fijo, transacción única, revierten ante error.
-- Depende de: 20260707100000_catalog.sql, 20260707100100_operations.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- siguiente_folio — correlativo atómico por sucursal y tipo de documento
-- ----------------------------------------------------------------------------
create or replace function public.siguiente_folio(p_branch uuid, p_doc public.folio_doc)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v int;
begin
  insert into public.folio_counter (branch_id, doc_type, next_value)
  values (p_branch, p_doc, 1)
  on conflict (branch_id, doc_type) do nothing;

  update public.folio_counter
     set next_value = next_value + 1
   where branch_id = p_branch and doc_type = p_doc
  returning next_value - 1 into v;

  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- abrir_caja — crea sesión open; falla si ya hay una abierta en la caja
-- ----------------------------------------------------------------------------
create or replace function public.abrir_caja(p_register uuid, p_float int)
returns public.cash_session
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch   uuid;
  v_business uuid;
  v_session  public.cash_session;
begin
  select b.id, b.business_id into v_branch, v_business
    from public.register r
    join public.branch b on b.id = r.branch_id
   where r.id = p_register;
  if v_branch is null then
    raise exception 'la caja indicada no existe';
  end if;

  insert into public.cash_session (business_id, branch_id, register_id, opened_by, float_amount, status)
  values (v_business, v_branch, p_register, auth.uid(), coalesce(p_float, 0), 'open')
  returning * into v_session;

  return v_session;
exception when unique_violation then
  raise exception 'ya hay una caja abierta en este puesto';
end;
$$;

-- ----------------------------------------------------------------------------
-- cerrar_caja — suma ventas y NC de la sesión, calcula descuadre, cierra
-- ----------------------------------------------------------------------------
create or replace function public.cerrar_caja(p_session uuid, p_counted int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_float int;
  v_cash  int;
  v_card  int;
  v_nc_cash int;
  v_nc_card int;
  v_expected int;
begin
  select float_amount into v_float
    from public.cash_session where id = p_session and status = 'open'
    for update;
  if v_float is null then
    raise exception 'la sesión de caja no existe o ya está cerrada';
  end if;

  select coalesce(sum(total) filter (where method = 'efectivo'), 0),
         coalesce(sum(total) filter (where method = 'tarjeta'), 0)
    into v_cash, v_card
    from public.sale where cash_session_id = p_session;

  select coalesce(sum(total) filter (where method = 'efectivo'), 0),
         coalesce(sum(total) filter (where method = 'tarjeta'), 0)
    into v_nc_cash, v_nc_card
    from public.credit_note where cash_session_id = p_session;

  v_expected := v_float + v_cash - v_nc_cash;

  update public.cash_session
     set status = 'closed', closed_at = now(), counted = p_counted
   where id = p_session;

  return jsonb_build_object(
    'session_id', p_session,
    'float', v_float,
    'cash', v_cash, 'card', v_card,
    'nc_cash', v_nc_cash, 'nc_card', v_nc_card,
    'expected_cash', v_expected,
    'counted', p_counted,
    'diff', p_counted - v_expected
  );
end;
$$;
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:rpc`
Expected: `rpc_test (folios+caja) OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260707100200_functions.sql supabase/tests/rpc_test.sql
git commit -m "feat(db): RPC de folios y apertura/cierre de caja" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 5: Funciones RPC — cobro, nota de crédito y cotización

**Files:**
- Modify: `supabase/migrations/20260707100200_functions.sql` (agregar funciones)
- Modify: `supabase/tests/rpc_test.sql` (agregar bloques)

**Interfaces:**
- Produces:
  - `public.cobrar_venta(p_branch uuid, p_session uuid, p_lines jsonb, p_method public.sale_method, p_recv int, p_customer uuid default null) returns public.sale`
    - `p_lines`: array JSON `[{ "product_id": uuid, "qty": int }, ...]`.
  - `public.emitir_nota_credito(p_branch uuid, p_session uuid, p_sale uuid, p_method public.sale_method, p_reason text, p_lines jsonb) returns public.credit_note`
    - `p_lines`: `[{ "product_id": uuid, "qty": int, "restock": bool }, ...]`.
  - `public.convertir_cotizacion(p_quote uuid, p_session uuid, p_method public.sale_method, p_recv int) returns public.sale`
- Consumes: `siguiente_folio`, tablas de Task 2/3.

- [ ] **Step 1: Ampliar el test RPC (falla)**

En `supabase/tests/rpc_test.sql`, agregar antes de `\echo 'rpc_test (folios+caja) OK'`:
```sql
-- cobrar_venta: baja stock, calcula IVA, asigna folio, suma puntos
do $$
declare v_session uuid; v_sale public.sale; v_stock int; v_cust uuid;
begin
  -- Caja 2 aparte: la Caja 1 quedó abierta por el bloque anterior (misma transacción).
  insert into public.register (id, branch_id, name) values
    ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','Caja 2')
    on conflict do nothing;
  insert into public.cash_session (id, business_id, branch_id, register_id, status)
    values ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','open')
    on conflict do nothing;
  v_session := 'f0000000-0000-0000-0000-000000000001';

  insert into public.customer (id, business_id, name) values
    ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Camila');
  v_cust := 'c0000000-0000-0000-0000-000000000001';

  v_sale := public.cobrar_venta(
    'bbbbbbbb-0000-0000-0000-000000000001', v_session,
    '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":2}]'::jsonb,
    'efectivo', 30000, v_cust);

  if v_sale.total <> 29980 then raise exception 'total incorrecto: %', v_sale.total; end if;
  if v_sale.neto <> round(29980/1.19) then raise exception 'neto incorrecto: %', v_sale.neto; end if;
  if v_sale.iva <> 29980 - round(29980/1.19) then raise exception 'iva incorrecto: %', v_sale.iva; end if;
  if v_sale.change <> 20 then raise exception 'vuelto incorrecto: %', v_sale.change; end if;
  if v_sale.points <> 29 then raise exception 'puntos incorrectos: %', v_sale.points; end if;

  select stock into v_stock from public.inventory
    where product_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and branch_id  = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_stock <> 6 then raise exception 'stock no bajo a 6: %', v_stock; end if;

  select points into v_stock from public.customer where id = v_cust;
  if v_stock <> 29 then raise exception 'puntos cliente no sumaron: %', v_stock; end if;
end $$;

-- cobrar_venta: stock insuficiente revierte todo (atomicidad)
do $$
declare v_folio_antes int; v_folio_despues int;
begin
  select next_value into v_folio_antes from public.folio_counter
    where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and doc_type = 'sale';
  begin
    perform public.cobrar_venta(
      'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
      '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":9999}]'::jsonb,
      'efectivo', 999999999, null);
    raise exception 'FALLO: cobro con stock insuficiente no fue rechazado';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;
  select next_value into v_folio_despues from public.folio_counter
    where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and doc_type = 'sale';
  if v_folio_antes <> v_folio_despues then
    raise exception 'atomicidad rota: folio avanzo pese al fallo (% -> %)', v_folio_antes, v_folio_despues;
  end if;
end $$;

-- emitir_nota_credito: repone stock en líneas con restock=true
do $$
declare v_nc public.credit_note; v_stock int;
begin
  v_nc := public.emitir_nota_credito(
    'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
    null, 'efectivo', 'devolución',
    '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":1,"restock":true}]'::jsonb);
  if v_nc.total <> 14990 then raise exception 'total NC incorrecto: %', v_nc.total; end if;
  select stock into v_stock from public.inventory
    where product_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and branch_id  = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_stock <> 7 then raise exception 'NC no repuso stock (esperado 7): %', v_stock; end if;
end $$;
```

- [ ] **Step 2: Correr el test (falla)**

Run: `cd /c/Kromi/kromi-pos && pnpm test:rpc`
Expected: FALLA con `function public.cobrar_venta(...) does not exist`.

- [ ] **Step 3: Agregar las funciones a la migración**

Al final de `supabase/migrations/20260707100200_functions.sql`, agregar:
```sql
-- ----------------------------------------------------------------------------
-- cobrar_venta — cobro atómico: valida stock, folio, inserta venta, baja stock,
-- suma fidelización. p_lines = [{product_id, qty}].
-- ----------------------------------------------------------------------------
create or replace function public.cobrar_venta(
  p_branch   uuid,
  p_session  uuid,
  p_lines    jsonb,
  p_method   public.sale_method,
  p_recv     int,
  p_customer uuid default null
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_total    int := 0;
  v_neto     int;
  v_iva      int;
  v_points   int;
  v_recv     int;
  v_change   int;
  v_folio    int;
  v_sale     public.sale;
  ln         record;
begin
  -- Sesión abierta y perteneciente a la sucursal
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la venta no tiene líneas';
  end if;

  -- Validar stock y acumular total (precio actual del producto)
  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    if ln.qty is null or ln.qty <= 0 then
      raise exception 'cantidad inválida en una línea';
    end if;
    perform 1 from public.inventory
      where product_id = ln.product_id and branch_id = p_branch and stock >= ln.qty;
    if not found then
      raise exception 'stock insuficiente para el producto %', ln.product_id;
    end if;
    v_total := v_total + ln.qty * (select price from public.product where id = ln.product_id);
  end loop;

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
                           total, neto, iva, recv, change, points, customer_id, cashier_id)
  values (v_business, p_branch, p_session, v_folio, p_method,
          v_total, v_neto, v_iva, v_recv, v_change, v_points, p_customer, auth.uid())
  returning * into v_sale;

  -- Líneas (snapshot) + baja de stock
  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    insert into public.sale_line (sale_id, product_id, name_snapshot, price_snapshot, category_snapshot, qty)
    select v_sale.id, p.id, p.name, p.price,
           (select key from public.category c where c.id = p.category_id), ln.qty
      from public.product p where p.id = ln.product_id;

    update public.inventory
       set stock = stock - ln.qty
     where product_id = ln.product_id and branch_id = p_branch;
  end loop;

  -- Fidelización
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

-- ----------------------------------------------------------------------------
-- emitir_nota_credito — inserta NC + líneas y repone stock (restock=true)
-- p_lines = [{product_id, qty, restock}].
-- ----------------------------------------------------------------------------
create or replace function public.emitir_nota_credito(
  p_branch  uuid,
  p_session uuid,
  p_sale    uuid,
  p_method  public.sale_method,
  p_reason  text,
  p_lines   jsonb
)
returns public.credit_note
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_total    int := 0;
  v_neto     int;
  v_iva      int;
  v_folio    int;
  v_nc       public.credit_note;
  ln         record;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la nota de crédito no tiene líneas';
  end if;

  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    v_total := v_total + ln.qty * (select price from public.product where id = ln.product_id);
  end loop;

  v_neto  := round(v_total / 1.19);
  v_iva   := v_total - v_neto;
  v_folio := public.siguiente_folio(p_branch, 'credit_note');

  insert into public.credit_note (business_id, branch_id, cash_session_id, folio, sale_id,
                                  method, reason, total, neto, iva, cashier_id)
  values (v_business, p_branch, p_session, v_folio, p_sale,
          p_method, p_reason, v_total, v_neto, v_iva, auth.uid())
  returning * into v_nc;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           coalesce((e->>'restock')::boolean, false) as restock
      from jsonb_array_elements(p_lines) e
  loop
    insert into public.credit_note_line (credit_note_id, product_id, name_snapshot, price_snapshot, qty, restock)
    select v_nc.id, p.id, p.name, p.price, ln.qty, ln.restock
      from public.product p where p.id = ln.product_id;

    if ln.restock then
      insert into public.inventory (product_id, branch_id, stock)
      values (ln.product_id, p_branch, ln.qty)
      on conflict (product_id, branch_id)
        do update set stock = public.inventory.stock + ln.qty;
    end if;
  end loop;

  return v_nc;
end;
$$;

-- ----------------------------------------------------------------------------
-- convertir_cotizacion — valida vigencia y reusa cobrar_venta
-- ----------------------------------------------------------------------------
create or replace function public.convertir_cotizacion(
  p_quote   uuid,
  p_session uuid,
  p_method  public.sale_method,
  p_recv    int
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch   uuid;
  v_customer uuid;
  v_valid    date;
  v_lines    jsonb;
  v_sale     public.sale;
begin
  select branch_id, customer_id, valid_until into v_branch, v_customer, v_valid
    from public.quote where id = p_quote and converted = false;
  if v_branch is null then
    raise exception 'la cotización no existe o ya fue convertida';
  end if;
  if v_valid < current_date then
    raise exception 'la cotización está vencida';
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty))
    into v_lines
    from public.quote_line where quote_id = p_quote;

  v_sale := public.cobrar_venta(v_branch, p_session, v_lines, p_method, p_recv, v_customer);

  update public.quote set converted = true, sale_id = v_sale.id where id = p_quote;
  return v_sale;
end;
$$;
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:rpc`
Expected: `rpc_test (folios+caja) OK` (todos los bloques `do $$` pasan sin abortar).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260707100200_functions.sql supabase/tests/rpc_test.sql
git commit -m "feat(db): RPC de cobro atómico, nota de crédito y conversión de cotización" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 6: Auth RUT+PIN — espejo `auth.users` → `app_user`

**Files:**
- Create: `supabase/migrations/20260707100300_auth.sql`
- Modify: `supabase/tests/rls_test.sql` (se crea completo en Task 7; aquí solo se prueba el espejo dentro de `rpc_test.sql`)
- Modify: `supabase/tests/rpc_test.sql` (agregar bloque de espejo de usuario)

**Interfaces:**
- Produces:
  - trigger `on auth.users` → `public.handle_new_user()` que crea la fila espejo en `public.app_user` leyendo `raw_user_meta_data` (`business_id`, `name`, `rut`, `role`).
  - `public.current_business_id() returns uuid` (business del usuario autenticado).
  - `public.current_role_pos() returns public.user_role`.
- Consumes: `app_user` (Task 2).

- [ ] **Step 1: Escribir el test del espejo (falla)**

En `supabase/tests/rpc_test.sql`, agregar antes de `\echo`:
```sql
-- handle_new_user: al insertar en auth.users se crea el espejo en app_user
do $$
declare v_uid uuid := '99999999-0000-0000-0000-000000000001'; v_name text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_uid, '111111111@pos.kromi.local',
          jsonb_build_object(
            'business_id','aaaaaaaa-0000-0000-0000-000000000001',
            'name','Daniela Soto','rut','11.111.111-1','role','admin'));
  select name into v_name from public.app_user where id = v_uid;
  if v_name <> 'Daniela Soto' then
    raise exception 'espejo app_user no creado o nombre incorrecto: %', v_name;
  end if;
end $$;
```

- [ ] **Step 2: Correr el test (falla)**

Run: `cd /c/Kromi/kromi-pos && pnpm test:rpc`
Expected: FALLA (no existe fila en `app_user`; `v_name` es null → excepción).

- [ ] **Step 3: Escribir la migración auth**

Create `supabase/migrations/20260707100300_auth.sql`:
```sql
-- ============================================================================
-- Migración: auth RUT+PIN — espejo auth.users -> app_user y helpers de sesión
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §7.1
-- El PIN vive como password en Supabase Auth (bcrypt). El alta real de
-- auth.users se hace vía Admin API (service_role) desde el servidor/seed; este
-- trigger mantiene el espejo en app_user con los metadatos.
-- Depende de: 20260707100000_catalog.sql
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo crea espejo si vienen los metadatos del POS (business_id).
  if new.raw_user_meta_data ? 'business_id' then
    insert into public.app_user (id, business_id, name, rut, role, active)
    values (
      new.id,
      (new.raw_user_meta_data->>'business_id')::uuid,
      coalesce(new.raw_user_meta_data->>'name', ''),
      coalesce(new.raw_user_meta_data->>'rut', ''),
      coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'cajero'),
      true
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Helpers de sesión (para RLS) — SECURITY DEFINER evita recursión de RLS.
-- ----------------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select business_id from public.app_user
   where id = auth.uid() and deleted_at is null;
$$;

create or replace function public.current_role_pos()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.app_user
   where id = auth.uid() and deleted_at is null;
$$;
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:rpc`
Expected: `rpc_test (folios+caja) OK` (incluye el bloque de espejo).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260707100300_auth.sql supabase/tests/rpc_test.sql
git commit -m "feat(db): auth RUT+PIN con espejo auth.users->app_user y helpers de sesión" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 7: RLS — aislamiento por negocio y por rol

**Files:**
- Create: `supabase/migrations/20260707100400_rls.sql`
- Create: `supabase/tests/rls_test.sql`

**Interfaces:**
- Produces: `enable row level security` + políticas explícitas en todas las tablas de negocio; helpers `public.is_pos_admin()`, `public.is_kromi()`; índices en FKs.
- Consumes: `current_business_id()`, `current_role_pos()` (Task 6).

- [ ] **Step 1: Escribir el test de RLS (falla)**

Create `supabase/tests/rls_test.sql`:
```sql
-- ============================================================================
-- Test RLS: aislamiento por negocio (Task 7). Transacción con ROLLBACK.
--   docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/rls_test.sql
-- ============================================================================
begin;

-- Fixtures: dos negocios, un usuario admin en cada uno.
insert into public.business (id, name, rut) values
  ('a1111111-0000-0000-0000-000000000001','Neg A','1-9'),
  ('a2222222-0000-0000-0000-000000000002','Neg B','2-7');
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1111111-0000-0000-0000-000000000001','ua@pos.kromi.local',
    jsonb_build_object('business_id','a1111111-0000-0000-0000-000000000001','name','UA','rut','1-9','role','admin')),
  ('e2222222-0000-0000-0000-000000000002','ub@pos.kromi.local',
    jsonb_build_object('business_id','a2222222-0000-0000-0000-000000000002','name','UB','rut','2-7','role','admin'));
insert into public.category (business_id, key, label) values
  ('a1111111-0000-0000-0000-000000000001','x','X de A'),
  ('a2222222-0000-0000-0000-000000000002','y','Y de B');

-- Simular sesión del usuario A
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','e1111111-0000-0000-0000-000000000001','role','authenticated')::text, true);

-- A ve solo su categoría
do $$
declare n int; nb int;
begin
  select count(*) into n  from public.category where business_id = 'a1111111-0000-0000-0000-000000000001';
  select count(*) into nb from public.category where business_id = 'a2222222-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'A no ve su categoría (%).', n; end if;
  if nb <> 0 then raise exception 'FUGA: A ve categorías de B (%).', nb; end if;
end $$;

reset role;
\echo 'rls_test OK'
rollback;
```

- [ ] **Step 2: Correr el test (falla)**

Run: `cd /c/Kromi/kromi-pos && pnpm test:rls`
Expected: FALLA con `FUGA: A ve categorías de B (1).` (sin RLS, ve todo).

- [ ] **Step 3: Escribir la migración RLS**

Create `supabase/migrations/20260707100400_rls.sql`:
```sql
-- ============================================================================
-- Migración: seguridad RLS — aislamiento por negocio y por rol
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §7.2
-- Doctrina: RLS en TODAS las tablas de negocio; anon sin acceso directo.
-- Depende de: 20260707100300_auth.sql
-- ============================================================================

create or replace function public.is_pos_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role_pos() in ('admin','kromi');
$$;

create or replace function public.is_kromi()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role_pos() = 'kromi';
$$;

-- ----------------------------------------------------------------------------
-- Habilitar RLS + política por tabla.
-- Regla base: el usuario ve/escribe filas de SU negocio; kromi ve todo.
-- Escrituras de catálogo/config: solo admin/kromi. Ventas/clientes: cualquier
-- usuario autenticado del negocio (el cajero opera vía RPC security definer).
-- ----------------------------------------------------------------------------

-- business (una fila = el negocio del usuario)
alter table public.business enable row level security;
create policy business_read on public.business for select
  using (id = public.current_business_id() or public.is_kromi());
create policy business_write on public.business for update
  using (id = public.current_business_id() and public.is_pos_admin());

-- Tablas con business_id: helper de política vía DO.
do $$
declare t text;
begin
  foreach t in array array[
    'branch','register','app_user','supplier','category','product',
    'customer','module_state','module_notice','cash_session','sale',
    'quote','credit_note'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    -- Lectura: mismo negocio o kromi.
    execute format($p$
      create policy %1$s_read on public.%1$s for select
      using (business_id = public.current_business_id() or public.is_kromi());
    $p$, t);
  end loop;

  -- Escritura de catálogo/config: solo admin/kromi.
  foreach t in array array['branch','register','app_user','supplier','category','product','module_state','module_notice'] loop
    execute format($p$
      create policy %1$s_write on public.%1$s for all
      using (business_id = public.current_business_id() and public.is_pos_admin())
      with check (business_id = public.current_business_id() and public.is_pos_admin());
    $p$, t);
  end loop;

  -- Clientes: cualquier usuario del negocio puede crear/editar.
  execute $p$
    create policy customer_write on public.customer for all
    using (business_id = public.current_business_id())
    with check (business_id = public.current_business_id());
  $p$;

  -- Documentos (sale/quote/credit_note): insertables por usuarios del negocio.
  foreach t in array array['cash_session','sale','quote','credit_note'] loop
    execute format($p$
      create policy %1$s_write on public.%1$s for all
      using (business_id = public.current_business_id())
      with check (business_id = public.current_business_id());
    $p$, t);
  end loop;
end $$;

-- Tablas hijas (líneas / inventario): sin business_id directo; se validan por el padre.
alter table public.sale_line enable row level security;
create policy sale_line_all on public.sale_line for all
  using (exists (select 1 from public.sale s where s.id = sale_id
                   and (s.business_id = public.current_business_id() or public.is_kromi())))
  with check (exists (select 1 from public.sale s where s.id = sale_id
                   and s.business_id = public.current_business_id()));

alter table public.quote_line enable row level security;
create policy quote_line_all on public.quote_line for all
  using (exists (select 1 from public.quote q where q.id = quote_id
                   and (q.business_id = public.current_business_id() or public.is_kromi())))
  with check (exists (select 1 from public.quote q where q.id = quote_id
                   and q.business_id = public.current_business_id()));

alter table public.credit_note_line enable row level security;
create policy credit_note_line_all on public.credit_note_line for all
  using (exists (select 1 from public.credit_note n where n.id = credit_note_id
                   and (n.business_id = public.current_business_id() or public.is_kromi())))
  with check (exists (select 1 from public.credit_note n where n.id = credit_note_id
                   and n.business_id = public.current_business_id()));

alter table public.inventory enable row level security;
create policy inventory_all on public.inventory for all
  using (exists (select 1 from public.branch b where b.id = branch_id
                   and (b.business_id = public.current_business_id() or public.is_kromi())))
  with check (exists (select 1 from public.branch b where b.id = branch_id
                   and b.business_id = public.current_business_id()));

alter table public.folio_counter enable row level security;
create policy folio_counter_read on public.folio_counter for select
  using (exists (select 1 from public.branch b where b.id = branch_id
                   and (b.business_id = public.current_business_id() or public.is_kromi())));

-- ----------------------------------------------------------------------------
-- Índices en FKs (rendimiento de joins y de las políticas)
-- ----------------------------------------------------------------------------
create index idx_branch_business on public.branch(business_id);
create index idx_register_branch on public.register(branch_id);
create index idx_app_user_business on public.app_user(business_id);
create index idx_supplier_business on public.supplier(business_id);
create index idx_category_business on public.category(business_id);
create index idx_product_business on public.product(business_id);
create index idx_product_category on public.product(category_id);
create index idx_product_supplier on public.product(supplier_id);
create index idx_customer_business on public.customer(business_id);
create index idx_inventory_branch on public.inventory(branch_id);
create index idx_sale_business on public.sale(business_id);
create index idx_sale_branch on public.sale(branch_id);
create index idx_sale_session on public.sale(cash_session_id);
create index idx_sale_line_sale on public.sale_line(sale_id);
create index idx_quote_business on public.quote(business_id);
create index idx_quote_line_quote on public.quote_line(quote_id);
create index idx_credit_note_business on public.credit_note(business_id);
create index idx_credit_note_session on public.credit_note(cash_session_id);
create index idx_credit_note_line_nc on public.credit_note_line(credit_note_id);
create index idx_cash_session_business on public.cash_session(business_id);
create index idx_cash_session_register on public.cash_session(register_id);

-- ----------------------------------------------------------------------------
-- Grants (patrón Supabase: grants amplios a authenticated; RLS filtra filas).
-- anon NO recibe acceso a tablas. service_role bypassa RLS por defecto.
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:rls`
Expected: `rls_test OK`.

- [ ] **Step 5: Correr toda la batería**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:db`
Expected: `schema_test OK`, `rpc_test (folios+caja) OK`, `rls_test OK`.

> Nota: `rpc_test.sql` corre como `postgres` (bypassa RLS), por lo que sus fixtures siguen funcionando tras habilitar RLS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260707100400_rls.sql supabase/tests/rls_test.sql
git commit -m "feat(db): RLS por negocio/rol e índices de FK" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 8: Seed mínimo local

**Files:**
- Create: `supabase/seed.sql`

**Interfaces:**
- Produces: 1 negocio, 1 sucursal, 1 caja, 1 usuario admin (RUT+PIN), folio_counters, module_state. Idempotente (se puede correr en cada `db reset`).
- Consumes: todo el esquema (Tasks 2-7).

- [ ] **Step 1: Escribir el seed**

Create `supabase/seed.sql`:
```sql
-- ============================================================================
-- Seed mínimo LOCAL de kromi-pos (arranca vacío: 1 negocio, 1 sucursal, 1 admin)
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §2 (datos iniciales)
-- Solo para desarrollo (supabase db reset). En producción el bootstrap del
-- primer admin se hace vía Admin API al linkear el proyecto cloud.
-- Admin demo: RUT 11.111.111-1  ·  PIN 123456
-- ============================================================================

-- Negocio
insert into public.business (id, name, rut, plan, admin_email)
values ('00000000-0000-0000-0000-0000000000b1','Kromi POS','76.000.000-0','Pro','admin@kromi.local')
on conflict (id) do nothing;

-- Sucursal
insert into public.branch (id, business_id, name)
values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','Casa Matriz')
on conflict (id) do nothing;

-- Caja
insert into public.register (id, branch_id, name)
values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000f1','Caja 1')
on conflict (id) do nothing;

-- Contadores de folio de la sucursal
insert into public.folio_counter (branch_id, doc_type, next_value) values
  ('00000000-0000-0000-0000-0000000000f1','sale',1),
  ('00000000-0000-0000-0000-0000000000f1','quote',1),
  ('00000000-0000-0000-0000-0000000000f1','credit_note',1)
on conflict (branch_id, doc_type) do nothing;

-- Módulos contratados
insert into public.module_state (business_id, module_key, active) values
  ('00000000-0000-0000-0000-0000000000b1','stock',true),
  ('00000000-0000-0000-0000-0000000000b1','clientes',true),
  ('00000000-0000-0000-0000-0000000000b1','metricas',true)
on conflict (business_id, module_key) do nothing;

-- Usuario admin en Supabase Auth (PIN=123456 hasheado bcrypt).
-- El trigger handle_new_user crea el espejo en app_user con los metadatos.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','111111111@pos.kromi.local',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'business_id','00000000-0000-0000-0000-0000000000b1',
    'name','Administrador','rut','11.111.111-1','role','admin'),
  now(), now()
)
on conflict (id) do nothing;
```

- [ ] **Step 2: Aplicar el reset (que corre el seed) y verificar**

Run:
```bash
cd /c/Kromi/kromi-pos && pnpm db:reset
docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "select (select count(*) from public.business) b, (select count(*) from public.branch) f, (select count(*) from public.app_user where role='admin') a;"
```
Expected: una fila con `b=1, f=1, a=1`.

- [ ] **Step 3: Verificar login del admin (password bcrypt válido)**

Run:
```bash
docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "select (encrypted_password = crypt('123456', encrypted_password)) as pin_ok from auth.users where email='111111111@pos.kromi.local';"
```
Expected: `pin_ok = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): seed mínimo local (negocio, sucursal, caja, admin RUT+PIN)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 9: Verificación integral y documentación de handoff

**Files:**
- Modify: `CLAUDE.md` (sección "Comandos" y "Datos")
- Create: `supabase/README.md` (cómo correr la base y bootstrap de producción)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Correr la batería completa desde cero**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:db`
Expected: los tres tests imprimen OK, sin errores.

- [ ] **Step 2: Documentar comandos de base en CLAUDE.md**

En `C:\Kromi\kromi-pos\CLAUDE.md`, en la sección `## Comandos`, agregar:
```markdown
- `pnpm db:reset` — recrea la base local (migraciones + seed)
- `pnpm test:db` — corre tests de esquema, RPC y RLS
- Base de datos: Supabase local (Docker). Ver `supabase/README.md`.
```
Y reemplazar en `## Stack (fijo)` la frase "Datos en memoria salvo que se agregue backend." por:
```markdown
Datos en **Supabase/Postgres** (esquema en `supabase/migrations/`; lógica crítica en funciones RPC). Online-only por ahora, esquema preparado para sync.
```

- [ ] **Step 3: Escribir supabase/README.md**

Create `supabase/README.md`:
```markdown
# Base de datos — kromi-pos

Fundación de datos y lógica (sub-proyecto ①). Diseño:
`docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md`.

## Desarrollo local
- `supabase start` — levanta Postgres/Auth locales (requiere Docker).
- `pnpm db:reset` — aplica migraciones + `seed.sql`.
- `pnpm test:db` — esquema + RPC + RLS.

Admin demo local: RUT `11.111.111-1`, PIN `123456`.

## Estructura
- `migrations/…_catalog.sql` — maestros, tenancy, inventario, módulos.
- `migrations/…_operations.sql` — caja, ventas, cotizaciones, notas de crédito, folios.
- `migrations/…_functions.sql` — RPC (cobrar_venta, abrir/cerrar caja, NC, cotización).
- `migrations/…_auth.sql` — espejo auth.users→app_user, helpers de sesión.
- `migrations/…_rls.sql` — políticas RLS + índices.
- `seed.sql` — seed mínimo local.

## Bootstrap de producción (al linkear el proyecto cloud)
1. El usuario crea el proyecto en Supabase y provee las credenciales (bloqueo de autonomía).
2. `supabase link --project-ref <ref>` y `supabase db push`.
3. Crear el negocio/sucursal/caja iniciales (SQL) y el primer admin vía **Admin API**
   (`auth.admin.createUser` con `user_metadata` = business_id/name/rut/role y el PIN como password).
   No usar `seed.sql` en producción.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md supabase/README.md
git commit -m "docs(db): comandos de base, README de Supabase y bootstrap de producción" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

## Notas de handoff a ② y ③

- El frontend nuevo consumirá: escrituras directas (`from(...)`) para catálogo/clientes/config y `rpc(...)` para `cobrar_venta`, `abrir_caja`, `cerrar_caja`, `emitir_nota_credito`, `convertir_cotizacion`.
- Login: normalizar el RUT en el cliente (igual que `norm_rut`), construir `{rut}@pos.kromi.local` y `signInWithPassword` con el PIN.
- El alta de usuarios (personal) en la app requiere **service_role** (Admin API) desde una capa servidor/edge, no desde el cliente anónimo.
