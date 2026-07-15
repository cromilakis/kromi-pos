-- ============================================================================
-- Migración: impresión diferida en caja (Task 1) — registrar la primera
-- impresión de una boleta.
-- `sale.printed_at`: null = nunca impresa; se setea una única vez (idempotente)
-- vía RPC security definer, ya que el cliente `authenticated` NO tiene UPDATE
-- sobre `sale` por RLS (ver supabase/migrations/20260707100400_rls.sql —
-- `sale` es un documento financiero de solo-lectura para el cliente).
-- ============================================================================

alter table public.sale add column if not exists printed_at timestamptz;

-- mark_sale_printed: marca la venta como impresa (una sola vez). Valida
-- tenancy con el mismo patrón que charge_sale/issue_credit_note: el negocio
-- de la venta debe coincidir con el del usuario autenticado (o ser kromi).
create or replace function public.mark_sale_printed(p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business
    from public.sale
   where id = p_sale;

  if v_business is null then
    raise exception 'la venta no existe';
  end if;

  if auth.uid() is not null
     and v_business is distinct from public.current_business_id()
     and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  update public.sale
     set printed_at = now()
   where id = p_sale
     and printed_at is null;
end;
$$;

grant execute on function public.mark_sale_printed(uuid) to authenticated;
