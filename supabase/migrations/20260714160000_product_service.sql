-- ============================================================================
-- Migración: producto tipo "servicio" (sin stock).
-- Depende de: 20260714130000_rename_functions_english.sql (_register_sale)
-- Agrega product.is_service y recrea _register_sale para que las líneas de
-- servicio NO validen ni descuenten inventory. Firma de _register_sale sin cambios.
-- ============================================================================

alter table public.product
  add column if not exists is_service boolean not null default false;

-- _register_sale ← cuerpo vigente de
-- supabase/migrations/20260714130000_rename_functions_english.sql:31-145
-- Cambios: la validación de stock (loop 1) y el descuento de inventory (loop 2)
-- se saltan cuando el producto es servicio (is_service = true).
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
  v_points := floor(v_total / 1000);
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
