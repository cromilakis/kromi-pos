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
    'branch','app_user','supplier','category','product',
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
  -- FIX I3: 'app_user' se saca de este loop genérico y recibe su propia política
  -- (más abajo) para bloquear la auto-promoción al rol 'kromi'.
  foreach t in array array['branch','supplier','category','product','module_state','module_notice'] loop
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

  -- FIX I1: los documentos financieros (sale/cash_session/quote/credit_note) NO
  -- son escribibles directamente por el cliente. Solo se crean vía las RPC
  -- security definer (owner postgres, bypassan RLS). Aquí quedan SOLO-LECTURA:
  -- la política *_read del primer loop ya concede el SELECT del negocio/kromi y
  -- no se agrega ninguna política de insert/update/delete para authenticated.
end $$;

-- FIX I3: app_user con política propia (fuera del loop genérico de catálogo).
-- Un admin puede gestionar los usuarios de SU negocio, PERO no puede asignar ni
-- mantener el rol 'kromi' (auto-promoción a superusuario): solo quien YA es kromi
-- puede escribir filas con role='kromi'. El resto de la condición es idéntica al
-- patrón admin/kromi del negocio.
create policy app_user_write on public.app_user for all
  using (business_id = public.current_business_id() and public.is_pos_admin())
  with check (business_id = public.current_business_id() and public.is_pos_admin()
              and (role <> 'kromi' or public.is_kromi()));

-- register: sin business_id directo (solo branch_id); se valida por la sucursal.
-- Nota (fix vs. brief original): 'register' venía incluido en el loop de tablas
-- con business_id, pero esa columna no existe en public.register (ver
-- 20260707100000_catalog.sql). Se corrige tratándolo como tabla hija de branch,
-- igual que sale_line/quote_line/etc.
alter table public.register enable row level security;
create policy register_read on public.register for select
  using (exists (select 1 from public.branch b where b.id = branch_id
                   and (b.business_id = public.current_business_id() or public.is_kromi())));
create policy register_write on public.register for all
  using (exists (select 1 from public.branch b where b.id = branch_id
                   and b.business_id = public.current_business_id() and public.is_pos_admin()))
  with check (exists (select 1 from public.branch b where b.id = branch_id
                   and b.business_id = public.current_business_id() and public.is_pos_admin()));

-- Tablas hijas de documentos (líneas): sin business_id directo; se validan por
-- el padre. FIX I1: SOLO-LECTURA (las líneas se insertan vía RPC definer).
alter table public.sale_line enable row level security;
create policy sale_line_read on public.sale_line for select
  using (exists (select 1 from public.sale s where s.id = sale_id
                   and (s.business_id = public.current_business_id() or public.is_kromi())));

alter table public.quote_line enable row level security;
create policy quote_line_read on public.quote_line for select
  using (exists (select 1 from public.quote q where q.id = quote_id
                   and (q.business_id = public.current_business_id() or public.is_kromi())));

alter table public.credit_note_line enable row level security;
create policy credit_note_line_read on public.credit_note_line for select
  using (exists (select 1 from public.credit_note n where n.id = credit_note_id
                   and (n.business_id = public.current_business_id() or public.is_kromi())));

-- FIX I1: inventory. Lectura para cualquier usuario del negocio; pero los ajustes
-- manuales de stock (insert/update/delete directos) SOLO los hace un admin del
-- negocio. Las RPC (cobrar_venta/emitir_nota_credito) lo modifican por definer.
alter table public.inventory enable row level security;
create policy inventory_read on public.inventory for select
  using (exists (select 1 from public.branch b where b.id = branch_id
                   and (b.business_id = public.current_business_id() or public.is_kromi())));
create policy inventory_write on public.inventory for all
  using (exists (select 1 from public.branch b where b.id = branch_id
                   and b.business_id = public.current_business_id() and public.is_pos_admin()))
  with check (exists (select 1 from public.branch b where b.id = branch_id
                   and b.business_id = public.current_business_id() and public.is_pos_admin()));

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

-- anon sin acceso directo a tablas (doctrina de seguridad): revoca cualquier
-- grant heredado por default privileges de Supabase. RLS ya deniega por default,
-- esto es defensa en profundidad. NO se revoca usage del schema (PostgREST lo necesita).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
