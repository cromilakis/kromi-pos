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
