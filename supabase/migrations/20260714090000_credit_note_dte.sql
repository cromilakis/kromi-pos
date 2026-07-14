-- ============================================================================
-- Migración: estado de emisión de nota de crédito electrónica (DTE 61)
-- Contrato: Task 1 del módulo de Notas de Crédito Electrónicas
-- Las escribe la Edge Function emitir-nota-credito (service role); el cliente solo lee.
-- ============================================================================
alter table public.credit_note add column dte_status text not null default 'pendiente'
  check (dte_status in ('pendiente','emitida','rechazada','error'));
alter table public.credit_note add column dte_folio int;
alter table public.credit_note add column dte_timbre text;      -- PNG del timbre en base64
alter table public.credit_note add column dte_track_id text;
alter table public.credit_note add column emitted_at timestamptz;
alter table public.credit_note add column cod_ref smallint;     -- 1 = anula, 3 = devolución parcial
