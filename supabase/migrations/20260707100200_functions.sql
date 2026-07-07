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

-- ----------------------------------------------------------------------------
-- cobrar_venta — cobro atómico: valida stock, folio, inserta venta, baja stock,
-- suma fidelización. p_lines = [{product_id, qty}].
-- ----------------------------------------------------------------------------
create or replace function public.cobrar_venta(
  p_branch   uuid,
  p_session  uuid,
  p_lines    jsonb,
  p_method   public.sale_method,
  p_recv     int,
  p_customer uuid default null
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_total    int := 0;
  v_neto     int;
  v_iva      int;
  v_points   int;
  v_recv     int;
  v_change   int;
  v_folio    int;
  v_sale     public.sale;
  ln         record;
begin
  -- Sesión abierta y perteneciente a la sucursal
  select business_id into v_business
    from public.cash_session
   where id = p_session and branch_id = p_branch and status = 'open';
  if v_business is null then
    raise exception 'la caja no está abierta para esta sucursal';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la venta no tiene líneas';
  end if;

  -- Validar stock y acumular total (precio actual del producto)
  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    if ln.qty is null or ln.qty <= 0 then
      raise exception 'cantidad inválida en una línea';
    end if;
    perform 1 from public.inventory
      where product_id = ln.product_id and branch_id = p_branch and stock >= ln.qty;
    if not found then
      raise exception 'stock insuficiente para el producto %', ln.product_id;
    end if;
    v_total := v_total + ln.qty * (select price from public.product where id = ln.product_id);
  end loop;

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
                           total, neto, iva, recv, change, points, customer_id, cashier_id)
  values (v_business, p_branch, p_session, v_folio, p_method,
          v_total, v_neto, v_iva, v_recv, v_change, v_points, p_customer, auth.uid())
  returning * into v_sale;

  -- Líneas (snapshot) + baja de stock
  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    insert into public.sale_line (sale_id, product_id, name_snapshot, price_snapshot, category_snapshot, qty)
    select v_sale.id, p.id, p.name, p.price,
           (select key from public.category c where c.id = p.category_id), ln.qty
      from public.product p where p.id = ln.product_id;

    update public.inventory
       set stock = stock - ln.qty
     where product_id = ln.product_id and branch_id = p_branch;
  end loop;

  -- Fidelización
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

-- ----------------------------------------------------------------------------
-- emitir_nota_credito — inserta NC + líneas y repone stock (restock=true)
-- p_lines = [{product_id, qty, restock}].
-- ----------------------------------------------------------------------------
create or replace function public.emitir_nota_credito(
  p_branch  uuid,
  p_session uuid,
  p_sale    uuid,
  p_method  public.sale_method,
  p_reason  text,
  p_lines   jsonb
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
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'la nota de crédito no tiene líneas';
  end if;

  for ln in
    select (e->>'product_id')::uuid as product_id, (e->>'qty')::int as qty
      from jsonb_array_elements(p_lines) e
  loop
    v_total := v_total + ln.qty * (select price from public.product where id = ln.product_id);
  end loop;

  v_neto  := round(v_total / 1.19);
  v_iva   := v_total - v_neto;
  v_folio := public.siguiente_folio(p_branch, 'credit_note');

  insert into public.credit_note (business_id, branch_id, cash_session_id, folio, sale_id,
                                  method, reason, total, neto, iva, cashier_id)
  values (v_business, p_branch, p_session, v_folio, p_sale,
          p_method, p_reason, v_total, v_neto, v_iva, auth.uid())
  returning * into v_nc;

  for ln in
    select (e->>'product_id')::uuid as product_id,
           (e->>'qty')::int as qty,
           coalesce((e->>'restock')::boolean, false) as restock
      from jsonb_array_elements(p_lines) e
  loop
    insert into public.credit_note_line (credit_note_id, product_id, name_snapshot, price_snapshot, qty, restock)
    select v_nc.id, p.id, p.name, p.price, ln.qty, ln.restock
      from public.product p where p.id = ln.product_id;

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

-- ----------------------------------------------------------------------------
-- convertir_cotizacion — valida vigencia y reusa cobrar_venta
-- ----------------------------------------------------------------------------
create or replace function public.convertir_cotizacion(
  p_quote   uuid,
  p_session uuid,
  p_method  public.sale_method,
  p_recv    int
)
returns public.sale
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch   uuid;
  v_customer uuid;
  v_valid    date;
  v_lines    jsonb;
  v_sale     public.sale;
begin
  select branch_id, customer_id, valid_until into v_branch, v_customer, v_valid
    from public.quote where id = p_quote and converted = false;
  if v_branch is null then
    raise exception 'la cotización no existe o ya fue convertida';
  end if;
  if v_valid < current_date then
    raise exception 'la cotización está vencida';
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty))
    into v_lines
    from public.quote_line where quote_id = p_quote;

  v_sale := public.cobrar_venta(v_branch, p_session, v_lines, p_method, p_recv, v_customer);

  update public.quote set converted = true, sale_id = v_sale.id where id = p_quote;
  return v_sale;
end;
$$;
