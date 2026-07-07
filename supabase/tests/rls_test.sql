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

-- a) Escritura cross-tenant bloqueada: A intenta crear una categoría en el
-- negocio B. Debe fallar por la policy category_write (with check).
do $$
begin
  begin
    insert into public.category (business_id, key, label) values
      ('a2222222-0000-0000-0000-000000000002','z','Z');
    raise exception 'FUGA: A escribió en el negocio B';
  exception
    when sqlstate '42501' then
      raise notice 'OK: insert cross-tenant bloqueado (RLS 42501)';
  end;
end $$;

reset role;

-- Fixture: usuario CAJERO del negocio A (el trigger handle_new_user crea el
-- espejo en app_user con role='cajero' a partir de raw_user_meta_data).
insert into auth.users (id, email, raw_user_meta_data) values
  ('e3333333-0000-0000-0000-000000000003','uc@pos.kromi.local',
    jsonb_build_object('business_id','a1111111-0000-0000-0000-000000000001','name','UC','rut','3-1','role','cajero'));

-- Simular sesión del cajero
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','e3333333-0000-0000-0000-000000000003','role','authenticated')::text, true);

-- b) Cajero no puede escribir catálogo: intenta crear un producto de SU
-- propio negocio. Debe fallar por is_pos_admin() en la policy product_write.
do $$
begin
  begin
    insert into public.product (business_id, name, price) values
      ('a1111111-0000-0000-0000-000000000001','Prod cajero', 100);
    raise exception 'FUGA: cajero escribió catálogo';
  exception
    when sqlstate '42501' then
      raise notice 'OK: cajero no pudo escribir catálogo (RLS 42501)';
  end;
end $$;

reset role;

-- Fixture: sucursal + caja del negocio B; y una sucursal del negocio A (para el
-- test de inserción directa de documentos por el cliente — FIX I1).
insert into public.branch (id, business_id, name) values
  ('b2222222-0000-0000-0000-000000000002','a2222222-0000-0000-0000-000000000002','Suc B'),
  ('b1111111-0000-0000-0000-000000000001','a1111111-0000-0000-0000-000000000001','Suc A');
insert into public.register (id, branch_id, name) values
  ('c2222222-0000-0000-0000-000000000002','b2222222-0000-0000-0000-000000000002','Caja B');

-- Volver a simular la sesión del usuario A
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','e1111111-0000-0000-0000-000000000001','role','authenticated')::text, true);

-- c) Aislamiento de register: A no debe ver la caja del negocio B.
do $$
declare n int;
begin
  select count(*) into n from public.register where branch_id = 'b2222222-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FUGA: A ve % register(s) del negocio B', n; end if;
end $$;

-- d) FIX I1: los documentos financieros son solo-lectura para el cliente. A NO
-- puede insertar una venta directamente en su propio negocio saltándose la RPC;
-- debe fallar por RLS (42501, no existe política de insert para authenticated).
do $$
begin
  begin
    insert into public.sale (business_id, branch_id, folio, method, total, neto, iva, recv, change, cashier_id)
    values ('a1111111-0000-0000-0000-000000000001','b1111111-0000-0000-0000-000000000001',
            1, 'efectivo', 1000, 840, 160, 1000, 0, 'e1111111-0000-0000-0000-000000000001');
    raise exception 'FUGA: cliente insertó venta directamente saltándose la RPC';
  exception
    when sqlstate '42501' then
      raise notice 'OK: insert directo de venta bloqueado por RLS (42501)';
  end;
end $$;

-- e) Regresión (fix cobro a precio arbitrario): _registrar_venta es el núcleo
-- interno con precio EXPLÍCITO por línea; NO debe ser invocable directamente por
-- authenticated (solo indirectamente vía cobrar_venta/convertir_cotizacion). El
-- chequeo de privilegio de EXECUTE ocurre ANTES de ejecutar el cuerpo, por lo que
-- el 42501 salta sin importar que los args sean dummy/inexistentes.
do $$
begin
  begin
    perform public._registrar_venta(
      '00000000-0000-0000-0000-000000000000'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      '[]'::jsonb,
      'efectivo'::public.sale_method,
      1,
      null);
    raise exception 'FUGA: authenticated pudo llamar _registrar_venta directamente';
  exception
    when sqlstate '42501' then
      raise notice 'OK: _registrar_venta bloqueada para authenticated (RLS/GRANT 42501)';
    when others then
      raise exception 'FUGA: authenticated puede llamar _registrar_venta directamente (%)', sqlerrm;
  end;
end $$;

reset role;
\echo 'rls_test OK'
rollback;
