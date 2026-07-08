-- ============================================================================
-- Migración: estado de emisión de boleta electrónica (DTE 39) por venta
-- Contrato: docs/superpowers/specs/2026-07-08-boleta-electronica-sii-simplefactura-design.md
-- Las escribe la Edge Function emitir-boleta (service role); el cliente solo lee.
-- ============================================================================
alter table public.sale add column dte_status text not null default 'pendiente'
  check (dte_status in ('pendiente','emitida','rechazada','error'));
alter table public.sale add column dte_folio int;
alter table public.sale add column dte_timbre text;        -- PNG del timbre en base64
alter table public.sale add column dte_track_id text;
alter table public.sale add column emitted_at timestamptz;
