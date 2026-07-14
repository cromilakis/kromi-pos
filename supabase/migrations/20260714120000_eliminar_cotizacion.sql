-- ============================================================================
-- Migración: eliminar cotización. Borrado físico (hard-delete) vía RPC
-- security definer, ya que `quote` es solo-lectura para el cliente (RLS) y no
-- tiene `deleted_at`. La FK quote_line.quote_id → quote es `on delete cascade`,
-- así que borrar la cotización arrastra sus líneas automáticamente. Ninguna otra
-- tabla referencia quote(id), por lo que el borrado es seguro.
-- Se rechaza eliminar una cotización ya convertida en venta, para no perder la
-- trazabilidad con `sale`.
-- Depende de: 20260707100100_operations.sql, 20260709100000_cotizacion_descuentos.sql
-- ============================================================================

create or replace function public.eliminar_cotizacion(p_quote uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid; v_business uuid; v_converted boolean;
begin
  select branch_id, converted into v_branch, v_converted
    from public.quote where id = p_quote;
  if v_branch is null then raise exception 'la cotización no existe'; end if;
  if v_converted then raise exception 'no se puede eliminar una cotización ya convertida en venta'; end if;

  select business_id into v_business from public.branch where id = v_branch;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  delete from public.quote where id = p_quote;  -- quote_line se borra en cascade
end $$;

grant execute on function public.eliminar_cotizacion(uuid) to authenticated;
