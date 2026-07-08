-- ============================================================================
-- Migración: código de barras de productos
-- Contrato: docs/superpowers/specs/2026-07-08-modulo-ventas-full-design.md (sub-proyecto 3)
-- barcode dedicado (distinto de internal_code). Único por negocio cuando no es null.
-- ============================================================================

alter table public.product add column barcode text;

create unique index product_barcode_unique
  on public.product(business_id, barcode)
  where barcode is not null;
