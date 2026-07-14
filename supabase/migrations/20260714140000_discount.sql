-- ============================================================================
-- Migración: descuentos configurables al total de la boleta. Config admin.
-- Depende de: 20260707100000_catalog.sql (set_updated_at), 20260707100100_operations.sql (sale)
-- ============================================================================

create table public.discount (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  name        text not null,
  percent     int  not null check (percent between 1 and 100),
  active      boolean not null default true,
  valid_from  date,
  valid_until date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index idx_discount_business on public.discount(business_id);

create trigger trg_discount_updated
  before update on public.discount
  for each row execute function public.set_updated_at();

alter table public.sale add column discount_id uuid references public.discount(id) on delete set null;

alter table public.discount enable row level security;

-- Lectura: negocio propio o kromi (mismo patrón que las demás tablas del negocio).
-- Nota: 'discount' es una tabla nueva que no forma parte del loop genérico de
-- 20260707100400_rls.sql (esa migración histórica no se edita); se declara la
-- policy de forma explícita, igual que 'register'/'inventory'/'folio_counter'
-- (tablas agregadas fuera del loop original) y siguiendo el mismo patrón de
-- lectura que usa el loop para el resto de tablas de negocio.
create policy discount_read on public.discount for select
  using (business_id = public.current_business_id() or public.is_kromi());

-- Escritura: solo admin del negocio (configuración administrativa), mismo
-- patrón que 'branch'/'supplier'/'category'/'product' en el loop de escritura
-- de catálogo/config.
create policy discount_write on public.discount for all
  using (business_id = public.current_business_id() and public.is_pos_admin())
  with check (business_id = public.current_business_id() and public.is_pos_admin());

-- Grant explícito: el grant amplio "on all tables" de 20260707100400_rls.sql
-- solo cubrió las tablas existentes en ese momento. Tablas creadas en
-- migraciones posteriores necesitan su propio grant a authenticated (mismo
-- patrón que 'held_sale' en 20260708100000_held_sale.sql); RLS sigue filtrando
-- las filas según las policies de arriba.
grant select, insert, update, delete on public.discount to authenticated;
