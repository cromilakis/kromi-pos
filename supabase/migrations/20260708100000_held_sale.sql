-- ============================================================================
-- Migración: ventas retenidas (carrito guardado para retomar)
-- Contrato: docs/superpowers/specs/2026-07-08-modulo-ventas-full-design.md (sub-proyecto 5)
-- Tabla held_sale: NO es documento financiero (no mueve caja ni stock).
-- Escritura directa por cualquier usuario del negocio (incluido cajero) vía RLS.
-- ============================================================================

create table public.held_sale (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business(id) on delete cascade,
  branch_id      uuid not null references public.branch(id) on delete cascade,
  cashier_id     uuid references public.app_user(id) on delete set null,
  customer_id    uuid references public.customer(id) on delete set null,
  label          text,
  cart           jsonb not null,                       -- [{ product_id, qty }]
  total_snapshot int not null default 0 check (total_snapshot >= 0),
  created_at     timestamptz not null default now()
);

create index idx_held_sale_business_branch on public.held_sale(business_id, branch_id);

alter table public.held_sale enable row level security;

-- Lectura y escritura por cualquier usuario del negocio (cajero incluido); kromi ve todo.
create policy held_sale_all on public.held_sale for all
  using (business_id = public.current_business_id() or public.is_kromi())
  with check (business_id = public.current_business_id());

-- Tabla nueva: GRANT explícito (el grant amplio de la migración de RLS no la cubre).
grant select, insert, update, delete on public.held_sale to authenticated;
