-- ============================================================================
-- Migración: descuento por producto (porcentaje del catálogo)
-- product.discount_pct (0-100). Se aplica automáticamente en la venta (lo resuelve
-- el servidor en cobrar_venta), sumado al descuento ad-hoc de admin por línea.
-- El descuento del producto NO requiere rol admin (es configuración del catálogo).
-- ============================================================================

alter table public.product add column discount_pct int not null default 0 check (discount_pct between 0 and 100);

-- Reescribe SOLO el cuerpo de cobrar_venta (misma firma) para sumar el descuento del producto.
create or replace function public.cobrar_venta(
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

  return public._registrar_venta(p_branch, p_session, v_lines, p_method, p_recv, p_customer, v_tot_disc);
end;
$$;
