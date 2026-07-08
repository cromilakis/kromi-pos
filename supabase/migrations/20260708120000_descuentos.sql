-- ============================================================================
-- Migración: descuentos por línea y total (solo admin), recalculados en servidor
-- Contrato: docs/superpowers/specs/2026-07-08-modulo-ventas-full-design.md (sub-proyecto 4)
-- Guarda el MONTO resuelto en sale.discount_amount y sale_line.discount_amount.
-- ============================================================================

alter table public.sale add column discount_amount int not null default 0 check (discount_amount >= 0);
alter table public.sale_line add column discount_amount int not null default 0 check (discount_amount >= 0);

-- Núcleo interno: ahora acepta descuento por línea (dentro de p_lines) y total (p_total_disc, monto).
drop function if exists public._registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid);
create function public._registrar_venta(
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
  v_business uuid;
  v_bruto    int := 0;
  v_total    int;
  v_neto     int;
  v_iva      int;
  v_points   int;
  v_recv     int;
  v_change   int;
  v_folio    int;
  v_sale     public.sale;
  ln         record;
begin
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

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
    perform 1 from public.inventory
      where product_id = ln.product_id and branch_id = p_branch and stock >= ln.qty;
    if not found then
      raise exception 'stock insuficiente para el producto %', ln.product_id;
    end if;
    v_bruto := v_bruto + (ln.qty * ln.price - ln.discount);
  end loop;

  if p_total_disc > v_bruto then
    raise exception 'el descuento total supera el monto de la venta';
  end if;

  v_total  := v_bruto - p_total_disc;
  v_neto   := round(v_total / 1.19);
  v_iva    := v_total - v_neto;
  v_points := floor(v_total / 1000);
  v_recv   := case when p_method = 'efectivo' then p_recv else v_total end;
  if p_method = 'efectivo' and v_recv < v_total then
    raise exception 'el efectivo recibido es menor al total';
  end if;
  v_change := v_recv - v_total;

  v_folio := public.siguiente_folio(p_branch, 'sale');

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
     where product_id = ln.product_id and branch_id = p_branch;
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

revoke execute on function public._registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, int)
  from public, anon, authenticated;

-- RPC pública: recibe descuentos del cliente (kind+value), valida admin, resuelve
-- montos con el PRECIO DEL SERVIDOR y delega en el núcleo.
drop function if exists public.cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid);
create function public.cobrar_venta(
  p_branch     uuid,
  p_session    uuid,
  p_lines      jsonb,
  p_method     public.sale_method,
  p_recv       int,
  p_customer   uuid default null,
  p_total_disc jsonb default null
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business  uuid;
  v_lines     jsonb;
  v_bruto     int := 0;
  v_has_disc  boolean := false;
  v_tot_disc  int := 0;
  v_tkind     text := p_total_disc->>'kind';
  v_tvalue    int  := coalesce((p_total_disc->>'value')::int, 0);
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

  select jsonb_agg(jsonb_build_object(
           'product_id', x.product_id,
           'qty',        x.qty,
           'price',      x.price,
           'discount',   x.disc)),
         coalesce(sum(x.qty * x.price - x.disc), 0),
         coalesce(bool_or(x.disc > 0), false)
    into v_lines, v_bruto, v_has_disc
    from (
      select e.product_id,
             e.qty,
             (select price from public.product where id = e.product_id) as price,
             case
               when e.disc_kind = 'pct'    then least((select price from public.product where id = e.product_id) * e.qty,
                                                       round((select price from public.product where id = e.product_id) * e.qty * coalesce(e.disc_value,0) / 100.0))
               when e.disc_kind = 'amount' then least((select price from public.product where id = e.product_id) * e.qty, coalesce(e.disc_value,0))
               else 0
             end as disc
        from jsonb_to_recordset(p_lines)
          as e(product_id uuid, qty int, disc_kind text, disc_value int)
    ) x;

  if v_tvalue > 0 and v_tkind is not null then
    v_tot_disc := case
      when v_tkind = 'pct'    then least(v_bruto, round(v_bruto * v_tvalue / 100.0))
      when v_tkind = 'amount' then least(v_bruto, v_tvalue)
      else 0
    end;
  end if;

  if (v_has_disc or v_tot_disc > 0) and not public.is_pos_admin() then
    raise exception 'los descuentos requieren rol administrador';
  end if;

  return public._registrar_venta(p_branch, p_session, v_lines, p_method, p_recv, p_customer, v_tot_disc);
end;
$$;

grant execute on function public.cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb)
  to authenticated;
