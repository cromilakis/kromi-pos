-- ============================================================================
-- Migración: renombrar funciones al inglés. ALTER FUNCTION RENAME preserva
-- cuerpo y grants. Las 5 con llamadas internas se re-crean (CREATE OR REPLACE)
-- después para que el cuerpo invoque los nombres nuevos (plpgsql resuelve por
-- nombre en runtime). No se editan migraciones históricas.
-- ============================================================================

-- Parte A — rename de nombres (bottom-up: dependencias primero)
alter function public.siguiente_folio(uuid, public.folio_doc)                                       rename to next_folio;
alter function public._registrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, int)       rename to _register_sale;
alter function public.cobrar_venta(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb)          rename to charge_sale;
alter function public.emitir_nota_credito(uuid, uuid, uuid, public.sale_method, text, jsonb, smallint) rename to issue_credit_note;
alter function public.crear_cotizacion(uuid, uuid, date, jsonb, int)                                rename to create_quote;
alter function public.convertir_cotizacion(uuid, uuid, public.sale_method, int)                     rename to convert_quote;
alter function public.eliminar_cotizacion(uuid)                                                     rename to delete_quote;
alter function public.recepcionar_factura(uuid, jsonb, jsonb, jsonb, text)                          rename to receive_invoice;
alter function public.abrir_caja(uuid, int)                                                         rename to open_cash_session;
alter function public.cerrar_caja(uuid, int)                                                        rename to close_cash_session;
alter function public.norm_rut(text)                                                                rename to normalize_rut;

-- ============================================================================
-- Parte B — re-crear las 5 funciones cuyo cuerpo invoca internamente a otra
-- función renombrada, para que apunten al nombre nuevo. Cuerpo copiado
-- verbatim de la versión vigente (ver referencias abajo), cambiando solo la
-- llamada interna indicada.
-- ============================================================================

-- _register_sale ← cuerpo vigente de _registrar_venta en
-- supabase/migrations/20260708120000_descuentos.sql:12-126
-- Cambio: public.siguiente_folio( -> public.next_folio(
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

-- charge_sale ← cuerpo vigente de cobrar_venta en
-- supabase/migrations/20260708140000_product_discount.sql:11-90
-- Cambio: public._registrar_venta( -> public._register_sale(
create or replace function public.charge_sale(
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

  return public._register_sale(p_branch, p_session, v_lines, p_method, p_recv, p_customer, v_tot_disc);
end;
$$;

-- convert_quote ← cuerpo vigente de convertir_cotizacion en
-- supabase/migrations/20260709100000_cotizacion_descuentos.sql:73-104
-- Cambio: public._registrar_venta( -> public._register_sale(
create or replace function public.convert_quote(
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

  v_sale := public._register_sale(v_branch, p_session, v_lines, p_method, p_recv, v_customer, coalesce(v_tot_disc, 0));

  update public.quote set converted = true, sale_id = v_sale.id where id = p_quote;
  return v_sale;
end $$;

-- create_quote ← cuerpo vigente de crear_cotizacion en
-- supabase/migrations/20260709100000_cotizacion_descuentos.sql:19-65
-- Cambio: public.siguiente_folio( -> public.next_folio(
create or replace function public.create_quote(
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
  v_folio    := public.next_folio(p_branch, 'quote');

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

-- issue_credit_note ← cuerpo vigente de emitir_nota_credito en
-- supabase/migrations/20260714090000_credit_note_dte.sql
-- Cambio: public.siguiente_folio( -> public.next_folio(
create or replace function public.issue_credit_note(
  p_branch  uuid,
  p_session uuid,
  p_sale    uuid,
  p_method  public.sale_method,
  p_reason  text,
  p_lines   jsonb,
  p_cod_ref smallint
)
returns public.credit_note
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_total    int := 0;
  v_neto     int;
  v_iva      int;
  v_folio    int;
  v_nc       public.credit_note;
  ln         record;
  v_price    int;
  v_sold     int;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la nota de crédito no tiene líneas';
  end if;

  -- Precio de referencia: si la NC es por boleta, usar el precio congelado de la venta
  -- (price_snapshot); si es manual (sin boleta), el precio actual del producto.
  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    if p_sale is not null then
      select price_snapshot, qty into v_price, v_sold
        from public.sale_line
        where sale_id = p_sale and product_id = ln.product_id
        limit 1;
      -- No se puede devolver más de lo vendido en esa línea de la boleta.
      if ln.qty > coalesce(v_sold, 0) then
        raise exception 'la cantidad a devolver excede la vendida';
      end if;
    end if;
    if v_price is null then
      select price into v_price from public.product where id = ln.product_id;
    end if;
    v_total := v_total + ln.qty * v_price;
    v_price := null;
    v_sold  := null;
  end loop;

  v_neto  := round(v_total / 1.19);
  v_iva   := v_total - v_neto;
  v_folio := public.next_folio(p_branch, 'credit_note');

  insert into public.credit_note (business_id, branch_id, cash_session_id, folio, sale_id,
                                  method, reason, total, neto, iva, cashier_id, cod_ref)
  values (v_business, p_branch, p_session, v_folio, p_sale,
          p_method, p_reason, v_total, v_neto, v_iva, auth.uid(), p_cod_ref)
  returning * into v_nc;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           coalesce((e->>'restock')::boolean, false) as restock
      from jsonb_array_elements(p_lines) e
  loop
    -- Snapshot del precio: de la boleta si existe, si no del producto.
    if p_sale is not null then
      select price_snapshot into v_price
        from public.sale_line where sale_id = p_sale and product_id = ln.product_id limit 1;
    end if;
    insert into public.credit_note_line (credit_note_id, product_id, name_snapshot, price_snapshot, qty, restock)
    select v_nc.id, p.id, p.name, coalesce(v_price, p.price), ln.qty, ln.restock
      from public.product p where p.id = ln.product_id;
    v_price := null;

    if ln.restock then
      insert into public.inventory (product_id, branch_id, stock)
      values (ln.product_id, p_branch, ln.qty)
      on conflict (product_id, branch_id)
        do update set stock = public.inventory.stock + ln.qty;
    end if;
  end loop;

  return v_nc;
end;
$$;

-- Re-aplicar el revoke del núcleo con el nombre y firma nuevos.
revoke execute on function public._register_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, int)
  from public, anon, authenticated;
