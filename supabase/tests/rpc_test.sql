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
  end;
end $$;

\echo 'rpc_test (folios+caja) OK'
rollback;
