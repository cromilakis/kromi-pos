-- ============================================================================
-- Seed mínimo LOCAL de kromi-pos (arranca vacío: 1 negocio, 1 sucursal, 1 admin)
-- Contrato: docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md §2 (datos iniciales)
-- Solo para desarrollo (supabase db reset). En producción el bootstrap del
-- primer admin se hace vía Admin API al linkear el proyecto cloud.
-- Admin demo: RUT 11.111.111-1  ·  PIN 123456
-- ============================================================================

-- Negocio
insert into public.business (id, name, rut, plan, admin_email)
values ('00000000-0000-0000-0000-0000000000b1','Kromi POS','76.000.000-0','Pro','admin@kromi.local')
on conflict (id) do nothing;

-- Sucursal
insert into public.branch (id, business_id, name)
values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','Casa Matriz')
on conflict (id) do nothing;

-- Caja
insert into public.register (id, branch_id, name)
values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000f1','Caja 1')
on conflict (id) do nothing;

-- Contadores de folio de la sucursal
insert into public.folio_counter (branch_id, doc_type, next_value) values
  ('00000000-0000-0000-0000-0000000000f1','sale',1),
  ('00000000-0000-0000-0000-0000000000f1','quote',1),
  ('00000000-0000-0000-0000-0000000000f1','credit_note',1)
on conflict (branch_id, doc_type) do nothing;

-- Módulos contratados
insert into public.module_state (business_id, module_key, active) values
  ('00000000-0000-0000-0000-0000000000b1','stock',true),
  ('00000000-0000-0000-0000-0000000000b1','clientes',true),
  ('00000000-0000-0000-0000-0000000000b1','metricas',true)
on conflict (business_id, module_key) do nothing;

-- Usuario admin en Supabase Auth (PIN=123456 hasheado bcrypt).
-- El trigger handle_new_user crea el espejo en app_user con los metadatos.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','111111111@pos.kromi.local',
  crypt('123456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'business_id','00000000-0000-0000-0000-0000000000b1',
    'name','Administrador','rut','11.111.111-1','role','admin'),
  now(), now()
)
on conflict (id) do nothing;
