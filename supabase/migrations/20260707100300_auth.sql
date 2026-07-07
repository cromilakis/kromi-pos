-- ============================================================================
-- Migración: auth RUT+PIN — espejo auth.users -> app_user y helpers de sesión
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §7.1
-- El PIN vive como password en Supabase Auth (bcrypt). El alta real de
-- auth.users se hace vía Admin API (service_role) desde el servidor/seed; este
-- trigger mantiene el espejo en app_user con los metadatos.
-- Depende de: 20260707100000_catalog.sql
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo crea espejo si vienen los metadatos del POS (business_id).
  if new.raw_user_meta_data ? 'business_id' then
    insert into public.app_user (id, business_id, name, rut, role, active)
    values (
      new.id,
      (new.raw_user_meta_data->>'business_id')::uuid,
      coalesce(new.raw_user_meta_data->>'name', ''),
      coalesce(new.raw_user_meta_data->>'rut', ''),
      coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'cajero'),
      true
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Helpers de sesión (para RLS) — SECURITY DEFINER evita recursión de RLS.
-- ----------------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select business_id from public.app_user
   where id = auth.uid() and deleted_at is null;
$$;

create or replace function public.current_role_pos()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.app_user
   where id = auth.uid() and deleted_at is null;
$$;
