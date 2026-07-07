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
