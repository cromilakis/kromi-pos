-- ============================================================================
-- Migración: crear_cotizacion — RPC con precio fijado por el SERVIDOR (Task 5, ③a fix)
-- Contexto: el fix anterior (este mismo archivo, `quote_write`) le dio a los
-- usuarios del negocio escritura FOR ALL sobre `quote`/`quote_line`, confiando en
-- que el cliente enviara un `price_snapshot` correcto. Un cajero podía crear una
-- cotización legítima, hacer `UPDATE quote_line SET price_snapshot = 1` a mano y
-- convertirla en venta real a $1 (stock descontado igual), reabriendo el hueco de
-- manipulación de precio que ① cerró para product.price/cobrar_venta.
-- Fix: `quote`/`quote_line` vuelven a ser SOLO-LECTURA para el cliente (como en
-- ①); la creación se hace por una RPC security definer que lee `product.price`
-- del servidor — el cliente solo puede mandar product_id+qty, nunca el precio.
-- Depende de: 20260707100400_rls.sql, 20260707100200_functions.sql
-- ============================================================================

drop policy if exists quote_write on public.quote;
drop policy if exists quote_line_write on public.quote_line;

-- ----------------------------------------------------------------------------
-- crear_cotizacion — crea quote + quote_line al precio ACTUAL de product.price.
-- p_lines = [{product_id, qty}] (SIN price ni name: los fija el servidor).
-- ----------------------------------------------------------------------------
create or replace function public.crear_cotizacion(
  p_branch uuid, p_customer uuid, p_valid_until date, p_lines jsonb
) returns public.quote
language plpgsql security definer set search_path = '' as $$
declare v_business uuid; v_total int := 0; v_neto int; v_folio int; v_quote public.quote; ln record;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'la cotización no tiene líneas'; end if;

  for ln in select (e->>'product_id')::uuid pid, (e->>'qty')::int q from jsonb_array_elements(p_lines) e loop
    if ln.q is null or ln.q <= 0 then raise exception 'cantidad inválida en una línea'; end if;
    perform 1 from public.product where id = ln.pid and business_id = v_business;
    if not found then raise exception 'producto inválido en una línea'; end if;
    v_total := v_total + ln.q * (select price from public.product where id = ln.pid);
  end loop;

  v_neto := round(v_total / 1.19);
  v_folio := public.siguiente_folio(p_branch, 'quote');
  insert into public.quote (business_id, branch_id, customer_id, valid_until, total, neto, iva, folio)
    values (v_business, p_branch, p_customer, p_valid_until, v_total, v_neto, v_total - v_neto, v_folio)
    returning * into v_quote;

  for ln in select (e->>'product_id')::uuid pid, (e->>'qty')::int q from jsonb_array_elements(p_lines) e loop
    insert into public.quote_line (quote_id, product_id, name_snapshot, price_snapshot, qty)
    select v_quote.id, p.id, p.name, p.price, ln.q from public.product p where p.id = ln.pid;
  end loop;

  return v_quote;
end $$;

grant execute on function public.crear_cotizacion(uuid, uuid, date, jsonb) to authenticated;
