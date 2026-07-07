-- ============================================================================
-- Test RLS: aislamiento por negocio (Task 7). Transacción con ROLLBACK.
--   docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/rls_test.sql
-- ============================================================================
begin;

-- Fixtures: dos negocios, un usuario admin en cada uno.
insert into public.business (id, name, rut) values
  ('a1111111-0000-0000-0000-000000000001','Neg A','1-9'),
  ('a2222222-0000-0000-0000-000000000002','Neg B','2-7');
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1111111-0000-0000-0000-000000000001','ua@pos.kromi.local',
    jsonb_build_object('business_id','a1111111-0000-0000-0000-000000000001','name','UA','rut','1-9','role','admin')),
  ('e2222222-0000-0000-0000-000000000002','ub@pos.kromi.local',
    jsonb_build_object('business_id','a2222222-0000-0000-0000-000000000002','name','UB','rut','2-7','role','admin'));
insert into public.category (business_id, key, label) values
  ('a1111111-0000-0000-0000-000000000001','x','X de A'),
  ('a2222222-0000-0000-0000-000000000002','y','Y de B');

-- Simular sesión del usuario A
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','e1111111-0000-0000-0000-000000000001','role','authenticated')::text, true);

-- A ve solo su categoría
do $$
declare n int; nb int;
begin
  select count(*) into n  from public.category where business_id = 'a1111111-0000-0000-0000-000000000001';
  select count(*) into nb from public.category where business_id = 'a2222222-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'A no ve su categoría (%).', n; end if;
  if nb <> 0 then raise exception 'FUGA: A ve categorías de B (%).', nb; end if;
end $$;

reset role;
\echo 'rls_test OK'
rollback;
