-- ============================================================================
-- Migración: nombre comercial del negocio (aparece en el título del POS y en la
-- boleta, antes de la razón social, entre asteriscos: * Nombre Comercial *).
-- ============================================================================
alter table public.business add column nombre_comercial text;
