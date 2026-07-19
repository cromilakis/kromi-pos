-- ============================================================================
-- Ley 20.956 (redondeo en efectivo): _register_sale redondea el monto a pagar
-- en efectivo (total fiscal exacto; recv/change sobre el redondeado).
-- close_cash_session calcula el arqueo con lo realmente cobrado/pagado
-- (ventas y NC) y expone el ajuste por redondeo.
-- ============================================================================

create or replace function public._register_sale(
  p_branch     uuid,
  p_session    uuid,
  p_lines      jsonb,
  p_method     public.sale_method,
  p_recv       int,
  p_customer   uuid,
  p_total_disc int default 0
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business      uuid;
  v_bruto         int := 0;
  v_total         int;
  v_pay           int;
  v_neto          int;
  v_iva           int;
  v_points        int;
  v_recv          int;
  v_change        int;
  v_folio         int;
  v_sale          public.sale;
  v_clp_per_point int;
  v_multiplier    int;
  ln              record;
begin
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  select points_clp_per_point, points_multiplier
    into v_clp_per_point, v_multiplier
    from public.business where id = v_business;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la venta no tiene líneas';
  end if;
  if p_total_disc < 0 then
    raise exception 'descuento total inválido';
  end if;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           (e->>'price')::int as price,
           coalesce((e->>'discount')::int, 0) as discount
      from jsonb_array_elements(p_lines) e
  loop
    if ln.qty is null or ln.qty <= 0 then
      raise exception 'cantidad inválida en una línea';
    end if;
    if ln.price is null or ln.price < 0 then
      raise exception 'precio inválido en una línea';
    end if;
    if ln.discount < 0 or ln.discount > ln.qty * ln.price then
      raise exception 'descuento de línea inválido';
    end if;
    if not exists (select 1 from public.product where id = ln.product_id and is_service) then
      perform 1 from public.inventory
        where product_id = ln.product_id and branch_id = p_branch and stock >= ln.qty;
      if not found then
        raise exception 'stock insuficiente para el producto %', ln.product_id;
      end if;
    end if;
    v_bruto := v_bruto + (ln.qty * ln.price - ln.discount);
  end loop;

  if p_total_disc > v_bruto then
    raise exception 'el descuento total supera el monto de la venta';
  end if;

  v_total  := v_bruto - p_total_disc;
  v_neto   := round(v_total / 1.19);
  v_iva    := v_total - v_neto;
  v_points := floor(v_total * v_multiplier / v_clp_per_point);

  -- Ley 20.956: en efectivo el monto A PAGAR se redondea a la decena (1-5 abajo,
  -- 6-9 arriba). El total (fiscal, para el DTE) NO se redondea. recv-change = pago.
  if p_method = 'efectivo' then
    v_pay    := ((v_total + 4) / 10) * 10;
    v_recv   := p_recv;
    if v_recv < v_pay then
      raise exception 'el efectivo recibido es menor al total a pagar';
    end if;
    v_change := v_recv - v_pay;
  else
    v_recv   := v_total;
    v_change := 0;
  end if;

  v_folio := public.next_folio(p_branch, 'sale');

  insert into public.sale (business_id, branch_id, cash_session_id, folio, method,
                           total, neto, iva, recv, change, points, customer_id, cashier_id, discount_amount)
  values (v_business, p_branch, p_session, v_folio, p_method,
          v_total, v_neto, v_iva, v_recv, v_change, v_points, p_customer, auth.uid(), p_total_disc)
  returning * into v_sale;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           (e->>'price')::int as price,
           coalesce((e->>'discount')::int, 0) as discount
      from jsonb_array_elements(p_lines) e
  loop
    insert into public.sale_line (sale_id, product_id, name_snapshot, price_snapshot, category_snapshot, qty, discount_amount)
    select v_sale.id, p.id, p.name, ln.price,
           (select key from public.category c where c.id = p.category_id), ln.qty, ln.discount
      from public.product p where p.id = ln.product_id;

    update public.inventory
       set stock = stock - ln.qty
     where product_id = ln.product_id and branch_id = p_branch
       and not exists (select 1 from public.product where id = ln.product_id and is_service);
  end loop;

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

create or replace function public.close_cash_session(p_session uuid, p_counted int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_float int;
  v_business uuid;
  v_cash  int;
  v_card  int;
  v_cash_collected int;
  v_nc_cash int;
  v_nc_card int;
  v_nc_paid int;
  v_rounding int;
  v_expected int;
begin
  select float_amount, business_id into v_float, v_business
    from public.cash_session where id = p_session and status = 'open'
    for update;
  if v_float is null then
    raise exception 'la sesión de caja no existe o ya está cerrada';
  end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  -- Ventas: cash fiscal (total) y cash cobrado (recv-change = redondeado en efectivo).
  select coalesce(sum(total) filter (where method = 'efectivo'), 0),
         coalesce(sum(total) filter (where method = 'tarjeta'), 0),
         coalesce(sum(recv - change) filter (where method = 'efectivo'), 0)
    into v_cash, v_card, v_cash_collected
    from public.sale where cash_session_id = p_session;

  -- Notas de crédito: nc fiscal (total) y nc pagado en efectivo (redondeado a la decena).
  select coalesce(sum(total) filter (where method = 'efectivo'), 0),
         coalesce(sum(total) filter (where method = 'tarjeta'), 0),
         coalesce(sum(((total + 4) / 10) * 10) filter (where method = 'efectivo'), 0)
    into v_nc_cash, v_nc_card, v_nc_paid
    from public.credit_note where cash_session_id = p_session;

  -- Ajuste neto por redondeo (Ley 20.956).
  v_rounding := (v_cash - v_cash_collected) - (v_nc_cash - v_nc_paid);
  v_expected := v_float + v_cash_collected - v_nc_paid;

  update public.cash_session
     set status = 'closed', closed_at = now(), counted = p_counted
   where id = p_session;

  return jsonb_build_object(
    'session_id', p_session,
    'float', v_float,
    'cash', v_cash, 'card', v_card,
    'nc_cash', v_nc_cash, 'nc_card', v_nc_card,
    'rounding', v_rounding,
    'expected_cash', v_expected,
    'counted', p_counted,
    'diff', p_counted - v_expected
  );
end;
$$;
