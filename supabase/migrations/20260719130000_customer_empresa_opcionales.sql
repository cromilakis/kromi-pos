-- ============================================================================
-- Migración: Datos opcionales de empresa para el receptor de factura 33
-- (ciudad, despacho, contacto y observaciones). Todos nullable: no afectan
-- clientes/empresas existentes.
-- ============================================================================
alter table public.customer
  add column if not exists ciudad             text,
  add column if not exists direccion_despacho text,
  add column if not exists comuna_despacho    text,
  add column if not exists contacto           text,
  add column if not exists observaciones      text;
