-- ============================================================================
-- Migración: charge_sale acepta p_discount_id (descuento predefinido, Task 2.1).
-- Depende de: 20260714130000_rename_functions_english.sql (charge_sale, _register_sale)
--             20260714140000_discount.sql (tabla discount, sale.discount_id)
-- Cambia la firma (8º parámetro p_discount_id) -> drop de la firma vieja + create nuevo + grant.
-- ============================================================================

drop function public.charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb);

-- charge_sale ← cuerpo vigente de
-- supabase/migrations/20260714130000_rename_functions_english.sql:150-229
-- Cambios: + p_discount_id uuid default null (8º parámetro); descuento
-- predefinido (tabla discount) tiene prioridad sobre el ad-hoc y no exige
-- is_pos_admin(); se persiste sale.discount_id.
create or replace function public.charge_sale(
  p_branch      uuid,
  p_session     uuid,
  p_lines       jsonb,
  p_method      public.sale_method,
  p_recv        int,
  p_customer    uuid default null,
  p_total_disc  jsonb default null,
  p_discount_id uuid default null
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
  v_sale      public.sale;
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

  -- Descuento predefinido (config admin): tiene prioridad sobre el ad-hoc.
  -- No requiere rol admin en el momento del cobro (ya fue aprobado por el
  -- admin al configurarlo en public.discount). El descuento de línea
  -- (v_has_disc) sigue exigiendo admin en todos los casos.
  if p_discount_id is not null then
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
  return v_sale;
end;
$$;

grant execute on function public.charge_sale(uuid, uuid, jsonb, public.sale_method, int, uuid, jsonb, uuid) to authenticated;
