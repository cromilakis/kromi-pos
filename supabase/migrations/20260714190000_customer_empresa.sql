-- Datos tributarios de empresa en el cliente (para receptor identificado en factura 33).
alter table public.customer
  add column if not exists is_company   boolean not null default false,
  add column if not exists rut          text,
  add column if not exists razon_social text,
  add column if not exists giro         text,
  add column if not exists direccion    text,
  add column if not exists comuna       text;
