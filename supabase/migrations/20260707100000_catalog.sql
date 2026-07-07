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
