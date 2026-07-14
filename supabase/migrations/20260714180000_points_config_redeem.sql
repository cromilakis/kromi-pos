-- ============================================================================
-- Migración: config de puntos por negocio (tasa de acumulación configurable +
-- multiplicador) y canje de puntos como descuento en el cobro.
-- Depende de: 20260714160000_product_service.sql (_register_sale)
--             20260714150000_charge_sale_discount_id.sql (charge_sale, 8 args)
-- ============================================================================

-- Config de puntos en business: cuántos CLP equivalen a 1 punto ganado,
-- multiplicador de acumulación, y cuántos CLP vale 1 punto al canjear.
alter table public.business
  add column if not exists points_clp_per_point        int not null default 1000 check (points_clp_per_point > 0),
  add column if not exists points_multiplier           int not null default 1    check (points_multiplier >= 1),
  add column if not exists points_redeem_clp_per_point  int not null default 1    check (points_redeem_clp_per_point > 0);

-- Canje persistido en la venta.
alter table public.sale
  add column if not exists points_redeemed int not null default 0 check (points_redeemed >= 0),
  add column if not exists points_discount int not null default 0 check (points_discount >= 0);

-- _register_sale ← cuerpo vigente de
-- supabase/migrations/20260714160000_product_service.sql:15-134
-- Cambios: acumulación de puntos usa la config del negocio
-- (points_clp_per_point / points_multiplier) en vez del 1000 hardcodeado.
-- Firma sin cambios.
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
    -- Servicios: no rastrean stock, no se valida inventory.
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
  v_recv   := case when p_method = 'efectivo' then p_recv else v_total end;
  if p_method = 'efectivo' and v_recv < v_total then
    raise exception 'el efectivo recibido es menor al total';
  end if;
  v_change := v_recv - v_total;

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

    -- Servicios: no descuentan inventory (no tienen fila). Guarda explícita.
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

drop function public.charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb, uuid);

-- charge_sale ← cuerpo vigente de
-- supabase/migrations/20260714150000_charge_sale_discount_id.sql:15-126
-- Cambios: + p_points_redeem int default 0 (9º parámetro). El canje de puntos
-- es mutuamente excluyente con cualquier otro descuento (predefinido o
-- ad-hoc). Valida cliente identificado y saldo suficiente, capa el descuento
-- al bruto, resta los puntos canjeados del cliente y persiste
-- sale.points_redeemed/points_discount. No exige is_pos_admin().
create or replace function public.charge_sale(
  p_branch        uuid,
  p_session       uuid,
  p_lines         jsonb,
  p_method        public.sale_method,
  p_recv          int,
  p_customer      uuid default null,
  p_total_disc    jsonb default null,
  p_discount_id   uuid default null,
  p_points_redeem int default 0
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business    uuid;
  v_lines       jsonb;
  v_bruto       int := 0;
  v_has_disc    boolean := false;
  v_tot_disc    int := 0;
  v_tkind       text := p_total_disc->>'kind';
  v_tvalue      int  := coalesce((p_total_disc->>'value')::int, 0);
  v_sale        public.sale;
  v_points_disc int := 0;
  v_cust_points int;
  v_redeem_rate int;
begin
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la venta no tiene líneas';
  end if;

  -- disc_prod: descuento del catálogo (product.discount_pct); disc_adhoc: descuento
  -- ingresado por admin. El descuento de la línea es la suma, capada al subtotal.
  select jsonb_agg(jsonb_build_object(
           'product_id', x.product_id,
           'qty',        x.qty,
           'price',      x.price,
           'discount',   least(x.qty * x.price, x.disc_adhoc + x.disc_prod))),
         coalesce(sum(x.qty * x.price - least(x.qty * x.price, x.disc_adhoc + x.disc_prod)), 0),
         coalesce(bool_or(x.disc_adhoc > 0), false)
    into v_lines, v_bruto, v_has_disc
    from (
      select e.product_id,
             e.qty,
             p.price,
             round(p.price * e.qty * p.discount_pct / 100.0) as disc_prod,
             case
               when e.disc_kind = 'pct'    then round(p.price * e.qty * coalesce(e.disc_value,0) / 100.0)
               when e.disc_kind = 'amount' then coalesce(e.disc_value,0)
               else 0
             end as disc_adhoc
        from jsonb_to_recordset(p_lines) as e(product_id uuid, qty int, disc_kind text, disc_value int)
        join public.product p on p.id = e.product_id
    ) x;

  -- Canje de puntos: mutuamente excluyente con descuento predefinido o total ad-hoc.
  if p_points_redeem > 0 and (p_discount_id is not null or (v_tvalue > 0 and v_tkind is not null)) then
    raise exception 'el canje de puntos no se puede combinar con otro descuento';
  end if;

  if p_points_redeem > 0 then
    if p_customer is null then
      raise exception 'el canje de puntos requiere un cliente identificado';
    end if;
    select points into v_cust_points from public.customer where id = p_customer;
    if v_cust_points is null or v_cust_points < p_points_redeem then
      raise exception 'el cliente no tiene puntos suficientes';
    end if;
    select points_redeem_clp_per_point into v_redeem_rate from public.business where id = v_business;
    v_points_disc := least(v_bruto, p_points_redeem * v_redeem_rate);
    v_tot_disc := v_points_disc;

    -- El canje no exige rol admin; el descuento de línea ad-hoc sigue exigiéndolo.
    if v_has_disc and not public.is_pos_admin() then
      raise exception 'los descuentos requieren rol administrador';
    end if;
  elsif p_discount_id is not null then
    -- Descuento predefinido (config admin): tiene prioridad sobre el ad-hoc.
    -- No requiere rol admin en el momento del cobro (ya fue aprobado por el
    -- admin al configurarlo en public.discount). El descuento de línea
    -- (v_has_disc) sigue exigiendo admin en todos los casos.
    declare v_pct int; begin
      select percent into v_pct
        from public.discount
       where id = p_discount_id
         and business_id = v_business
         and active = true
         and (valid_from  is null or valid_from  <= current_date)
         and (valid_until is null or valid_until >= current_date)
         and deleted_at is null;
      if v_pct is null then
        raise exception 'el descuento no existe, no está activo o no está vigente';
      end if;
      v_tot_disc := least(v_bruto, round(v_bruto * v_pct / 100.0));
    end;
    -- p_total_disc se ignora si vino junto con p_discount_id (mutuamente excluyentes).
    if v_has_disc and not public.is_pos_admin() then
      raise exception 'los descuentos requieren rol administrador';
    end if;
  else
    if v_tvalue > 0 and v_tkind is not null then
      v_tot_disc := case
        when v_tkind = 'pct'    then least(v_bruto, round(v_bruto * v_tvalue / 100.0))
        when v_tkind = 'amount' then least(v_bruto, v_tvalue)
        else 0
      end;
    end if;

    -- Solo el descuento ad-hoc (línea o total) requiere admin; el del catálogo no.
    if (v_has_disc or v_tot_disc > 0) and not public.is_pos_admin() then
      raise exception 'los descuentos requieren rol administrador';
    end if;
  end if;

  v_sale := public._register_sale(p_branch, p_session, v_lines, p_method, p_recv, p_customer, v_tot_disc);
  if p_discount_id is not null then
    update public.sale set discount_id = p_discount_id where id = v_sale.id;
    select * into v_sale from public.sale where id = v_sale.id;
  end if;
  if p_points_redeem > 0 then
    update public.customer set points = points - p_points_redeem where id = p_customer;
    update public.sale set points_redeemed = p_points_redeem, points_discount = v_points_disc where id = v_sale.id;
    select * into v_sale from public.sale where id = v_sale.id;
  end if;
  return v_sale;
end;
$$;

grant execute on function public.charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb, uuid, int) to authenticated;
