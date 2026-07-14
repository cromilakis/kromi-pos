-- ============================================================================
-- Migración: guardar el invariante "los servicios nunca tienen fila en
-- inventory" en el restock de la nota de crédito.
-- Depende de: 20260714130000_rename_functions_english.sql (issue_credit_note)
-- Recrea issue_credit_note para que el bloque de restock NO cree/incremente
-- inventory cuando la línea corresponde a un producto servicio. Firma de
-- issue_credit_note sin cambios.
-- ============================================================================

-- issue_credit_note ← cuerpo vigente de
-- supabase/migrations/20260714130000_rename_functions_english.sql:321-419
-- Cambio: el insert/on-conflict de restock ahora excluye productos servicio.
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

    -- Servicios: no tienen fila en inventory, por lo tanto nunca se reponen.
    -- Guarda explícita del invariante "servicio ⇒ sin fila en inventory".
    if ln.restock
       and not exists (select 1 from public.product where id = ln.product_id and is_service) then
      insert into public.inventory (product_id, branch_id, stock)
      values (ln.product_id, p_branch, ln.qty)
      on conflict (product_id, branch_id)
        do update set stock = public.inventory.stock + ln.qty;
    end if;
  end loop;

  return v_nc;
end;
$$;
