-- ============================================================================
-- Migración: RLS de escritura para cotizaciones (Task 5, ③a)
-- Contexto: en ① `quote`/`quote_line` quedaron SOLO-LECTURA para el cliente
-- (documentos financieros creados vía RPC security definer, como sale/credit_note).
-- Cotizar NO mueve caja ni stock (a diferencia de vender o emitir NC), por lo que
-- un usuario del negocio puede crearlas/editarlas directamente, igual que `customer`.
-- Postgres combina políticas del mismo comando con OR: esta política de escritura
-- convive sin conflicto con `quote_read`/`quote_line_read` ya existentes.
-- Depende de: 20260707100400_rls.sql
-- ============================================================================

create policy quote_write on public.quote for all
  using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

create policy quote_line_write on public.quote_line for all
  using (exists (select 1 from public.quote q where q.id = quote_id and q.business_id = public.current_business_id()))
  with check (exists (select 1 from public.quote q where q.id = quote_id and q.business_id = public.current_business_id()));
