-- ============================================================================
-- Migración: descuentos en cotización (por línea % y global %), resueltos en
-- servidor. Guarda el MONTO en quote.discount_amount y quote_line.discount_amount,
-- igual que sale/sale_line. El cliente solo envía porcentajes (0..100), nunca
-- precios ni montos — el servidor lee product.price y calcula los montos.
-- convertir_cotizacion arrastra los descuentos congelados a la venta.
-- Depende de: 20260707120000_crear_cotizacion.sql, 20260708120000_descuentos.sql
-- ============================================================================

alter table public.quote      add column if not exists discount_amount int not null default 0 check (discount_amount >= 0);
alter table public.quote_line add column if not exists discount_amount int not null default 0 check (discount_amount >= 0);

-- ----------------------------------------------------------------------------
-- crear_cotizacion — ahora acepta descuento por línea (discount_pct) y global
-- (p_discount_pct). p_lines = [{product_id, qty, discount_pct}]. El precio y los
-- montos de descuento los fija el servidor desde product.price.
-- ----------------------------------------------------------------------------
drop function if exists public.crear_cotizacion(uuid, uuid, date, jsonb);
create or replace function public.crear_cotizacion(
  p_branch uuid, p_customer uuid, p_valid_until date, p_lines jsonb, p_discount_pct int default 0
) returns public.quote
language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid; v_bruto int := 0; v_total int; v_neto int; v_tot_disc int := 0;
  v_folio int; v_quote public.quote; v_gpct int; ln record;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'la cotización no tiene líneas'; end if;

  v_gpct := least(100, greatest(0, coalesce(p_discount_pct, 0)));

  -- Bruto = suma de (qty*precio - descuento_línea), con el precio del servidor.
  for ln in
    select e.product_id as pid, e.qty as q,
           least(100, greatest(0, coalesce(e.discount_pct, 0))) as dp,
           (select price from public.product where id = e.product_id) as price
      from jsonb_to_recordset(p_lines) as e(product_id uuid, qty int, discount_pct int)
  loop
    if ln.q is null or ln.q <= 0 then raise exception 'cantidad inválida en una línea'; end if;
    if ln.price is null then raise exception 'producto inválido en una línea'; end if;
    perform 1 from public.product where id = ln.pid and business_id = v_business;
    if not found then raise exception 'producto inválido en una línea'; end if;
    v_bruto := v_bruto + (ln.q * ln.price - round(ln.q * ln.price * ln.dp / 100.0));
  end loop;

  v_tot_disc := round(v_bruto * v_gpct / 100.0);
  v_total    := v_bruto - v_tot_disc;
  v_neto     := round(v_total / 1.19);
  v_folio    := public.siguiente_folio(p_branch, 'quote');

  insert into public.quote (business_id, branch_id, customer_id, valid_until, total, neto, iva, folio, discount_amount)
    values (v_business, p_branch, p_customer, p_valid_until, v_total, v_neto, v_total - v_neto, v_folio, v_tot_disc)
    returning * into v_quote;

  insert into public.quote_line (quote_id, product_id, name_snapshot, price_snapshot, qty, discount_amount)
  select v_quote.id, p.id, p.name, p.price, e.qty,
         round(e.qty * p.price * least(100, greatest(0, coalesce(e.discount_pct, 0))) / 100.0)
    from jsonb_to_recordset(p_lines) as e(product_id uuid, qty int, discount_pct int)
    join public.product p on p.id = e.product_id;

  return v_quote;
end $$;

grant execute on function public.crear_cotizacion(uuid, uuid, date, jsonb, int) to authenticated;

-- ----------------------------------------------------------------------------
-- convertir_cotizacion — arrastra el descuento por línea (quote_line.discount_amount)
-- y el descuento global (quote.discount_amount) congelados a la venta.
-- ----------------------------------------------------------------------------
create or replace function public.convertir_cotizacion(
  p_quote uuid, p_session uuid, p_method public.sale_method, p_recv int
) returns public.sale
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid; v_business uuid; v_customer uuid; v_valid date;
  v_lines jsonb; v_tot_disc int; v_sale public.sale;
begin
  select branch_id, customer_id, valid_until, discount_amount
    into v_branch, v_customer, v_valid, v_tot_disc
    from public.quote where id = p_quote and converted = false;
  if v_branch is null then raise exception 'la cotización no existe o ya fue convertida'; end if;
  if v_valid < current_date then raise exception 'la cotización está vencida'; end if;

  select business_id into v_business from public.branch where id = v_branch;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  select jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'qty',        qty,
           'price',      price_snapshot,
           'discount',   discount_amount))
    into v_lines
    from public.quote_line where quote_id = p_quote;

  v_sale := public._registrar_venta(v_branch, p_session, v_lines, p_method, p_recv, v_customer, coalesce(v_tot_disc, 0));

  update public.quote set converted = true, sale_id = v_sale.id where id = p_quote;
  return v_sale;
end $$;

grant execute on function public.convertir_cotizacion(uuid, uuid, public.sale_method, int) to authenticated;
