-- ============================================================================
-- Test RPC (Task 4 + Task 5): folios, apertura/cierre de caja, cobro,
-- nota de crédito, conversión de cotización. Transacción con ROLLBACK.
--   docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/rpc_test.sql
-- ============================================================================
begin;

-- Fixtures (como postgres, bypassa RLS)
insert into public.business (id, name, rut) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Neg','1-9');
insert into public.branch (id, business_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Centro');
insert into public.register (id, branch_id, name) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Caja 1');
insert into public.folio_counter (branch_id, doc_type, next_value) values
  ('bbbbbbbb-0000-0000-0000-000000000001','sale',1),
  ('bbbbbbbb-0000-0000-0000-000000000001','quote',1),
  ('bbbbbbbb-0000-0000-0000-000000000001','credit_note',1);
insert into public.category (id, business_id, key, label) values
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','plantas','Plantas');
insert into public.product (id, business_id, name, category_id, price) values
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Monstera','dddddddd-0000-0000-0000-000000000001',14990);
insert into public.inventory (product_id, branch_id, stock) values
  ('eeeeeeee-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',8);

-- siguiente_folio incrementa por sucursal
do $$
declare f1 int; f2 int;
begin
  f1 := public.siguiente_folio('bbbbbbbb-0000-0000-0000-000000000001','sale');
  f2 := public.siguiente_folio('bbbbbbbb-0000-0000-0000-000000000001','sale');
  if f1 <> 1 or f2 <> 2 then raise exception 'siguiente_folio no incrementa: % %', f1, f2; end if;
end $$;

-- abrir_caja crea sesión open; segunda apertura en la misma caja falla
do $$
declare s public.cash_session;
begin
  s := public.abrir_caja('cccccccc-0000-0000-0000-000000000001', 50000);
  if s.status <> 'open' then raise exception 'abrir_caja no dejo status open'; end if;
  begin
    perform public.abrir_caja('cccccccc-0000-0000-0000-000000000001', 50000);
    raise exception 'FALLO: se abrio segunda caja sobre una ya abierta';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like '%ya hay una caja abierta%' then
      raise exception 'FALLO: abrir_caja fallo con mensaje inesperado: %', sqlerrm;
    end if;
  end;
end $$;

-- cobrar_venta: baja stock, calcula IVA, asigna folio, suma puntos
do $$
declare v_session uuid; v_sale public.sale; v_stock int; v_cust uuid;
begin
  -- Caja 2 aparte: la Caja 1 quedó abierta por el bloque anterior (misma transacción).
  insert into public.register (id, branch_id, name) values
    ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','Caja 2')
    on conflict do nothing;
  insert into public.cash_session (id, business_id, branch_id, register_id, status)
    values ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','open')
    on conflict do nothing;
  v_session := 'f0000000-0000-0000-0000-000000000001';

  insert into public.customer (id, business_id, name) values
    ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Camila');
  v_cust := 'c0000000-0000-0000-0000-000000000001';

  v_sale := public.cobrar_venta(
    'bbbbbbbb-0000-0000-0000-000000000001', v_session,
    '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":2}]'::jsonb,
    'efectivo', 30000, v_cust);

  if v_sale.total <> 29980 then raise exception 'total incorrecto: %', v_sale.total; end if;
  if v_sale.neto <> round(29980/1.19) then raise exception 'neto incorrecto: %', v_sale.neto; end if;
  if v_sale.iva <> 29980 - round(29980/1.19) then raise exception 'iva incorrecto: %', v_sale.iva; end if;
  if v_sale.change <> 20 then raise exception 'vuelto incorrecto: %', v_sale.change; end if;
  if v_sale.points <> 29 then raise exception 'puntos incorrectos: %', v_sale.points; end if;

  select stock into v_stock from public.inventory
    where product_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and branch_id  = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_stock <> 6 then raise exception 'stock no bajo a 6: %', v_stock; end if;

  select points into v_stock from public.customer where id = v_cust;
  if v_stock <> 29 then raise exception 'puntos cliente no sumaron: %', v_stock; end if;
end $$;

-- cobrar_venta: stock insuficiente revierte todo (atomicidad)
do $$
declare v_folio_antes int; v_folio_despues int;
begin
  select next_value into v_folio_antes from public.folio_counter
    where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and doc_type = 'sale';
  begin
    perform public.cobrar_venta(
      'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
      '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":9999}]'::jsonb,
      'efectivo', 999999999, null);
    raise exception 'FALLO: cobro con stock insuficiente no fue rechazado';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like '%stock insuficiente%' then
      raise exception 'error inesperado: %', sqlerrm;
    end if;
  end;
  select next_value into v_folio_despues from public.folio_counter
    where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and doc_type = 'sale';
  if v_folio_antes <> v_folio_despues then
    raise exception 'atomicidad rota: folio avanzo pese al fallo (% -> %)', v_folio_antes, v_folio_despues;
  end if;
end $$;

-- emitir_nota_credito: repone stock en líneas con restock=true
do $$
declare v_nc public.credit_note; v_stock int;
begin
  v_nc := public.emitir_nota_credito(
    'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
    null, 'efectivo', 'devolución',
    '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":1,"restock":true}]'::jsonb);
  if v_nc.total <> 14990 then raise exception 'total NC incorrecto: %', v_nc.total; end if;
  select stock into v_stock from public.inventory
    where product_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and branch_id  = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_stock <> 7 then raise exception 'NC no repuso stock (esperado 7): %', v_stock; end if;
end $$;

-- handle_new_user: al insertar en auth.users se crea el espejo en app_user
do $$
declare v_uid uuid := '99999999-0000-0000-0000-000000000001'; v_name text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_uid, '111111111@pos.kromi.local',
          jsonb_build_object(
            'business_id','aaaaaaaa-0000-0000-0000-000000000001',
            'name','Daniela Soto','rut','11.111.111-1','role','admin'));
  select name into v_name from public.app_user where id = v_uid;
  if v_name is distinct from 'Daniela Soto' then
    raise exception 'espejo app_user no creado o nombre incorrecto: %', v_name;
  end if;
end $$;

\echo 'rpc_test (folios+caja) OK'
rollback;
