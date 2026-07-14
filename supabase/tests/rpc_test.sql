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

-- next_folio incrementa por sucursal
do $$
declare f1 int; f2 int;
begin
  f1 := public.next_folio('bbbbbbbb-0000-0000-0000-000000000001','sale');
  f2 := public.next_folio('bbbbbbbb-0000-0000-0000-000000000001','sale');
  if f1 <> 1 or f2 <> 2 then raise exception 'next_folio no incrementa: % %', f1, f2; end if;
end $$;

-- open_cash_session crea sesión open; segunda apertura en la misma caja falla
do $$
declare s public.cash_session;
begin
  s := public.open_cash_session('cccccccc-0000-0000-0000-000000000001', 50000);
  if s.status <> 'open' then raise exception 'open_cash_session no dejo status open'; end if;
  begin
    perform public.open_cash_session('cccccccc-0000-0000-0000-000000000001', 50000);
    raise exception 'FALLO: se abrio segunda caja sobre una ya abierta';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like '%ya hay una caja abierta%' then
      raise exception 'FALLO: open_cash_session fallo con mensaje inesperado: %', sqlerrm;
    end if;
  end;
end $$;

-- charge_sale: baja stock, calcula IVA, asigna folio, suma puntos
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

  v_sale := public.charge_sale(
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

-- charge_sale: stock insuficiente revierte todo (atomicidad)
do $$
declare v_folio_antes int; v_folio_despues int;
begin
  select next_value into v_folio_antes from public.folio_counter
    where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and doc_type = 'sale';
  begin
    perform public.charge_sale(
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

-- issue_credit_note: repone stock en líneas con restock=true
do $$
declare v_nc public.credit_note; v_stock int;
begin
  v_nc := public.issue_credit_note(
    'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
    null, 'efectivo', 'devolución',
    '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","qty":1,"restock":true}]'::jsonb,
    3::smallint);
  if v_nc.total <> 14990 then raise exception 'total NC incorrecto: %', v_nc.total; end if;
  if v_nc.cod_ref <> 3 then raise exception 'NC no guardo cod_ref=3: %', v_nc.cod_ref; end if;
  select stock into v_stock from public.inventory
    where product_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and branch_id  = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_stock <> 7 then raise exception 'NC no repuso stock (esperado 7): %', v_stock; end if;
end $$;

-- issue_credit_note: NC por boleta usa el precio de la venta (price_snapshot),
-- no el precio actual del producto; y persiste cod_ref.
do $$
declare
  v_product uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_sale    public.sale;
  v_nc      public.credit_note;
begin
  insert into public.product (id, business_id, name, category_id, price) values
    (v_product,'aaaaaaaa-0000-0000-0000-000000000001','Cactus','dddddddd-0000-0000-0000-000000000001',800);
  insert into public.inventory (product_id, branch_id, stock) values
    (v_product,'bbbbbbbb-0000-0000-0000-000000000001',5);

  v_sale := public.charge_sale(
    'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
    ('[{"product_id":"'||v_product||'","qty":1}]')::jsonb,
    'efectivo', 800, null);

  -- El precio del producto SUBE tras la venta (800 -> 1000). La NC por boleta
  -- DEBE usar el precio congelado en la venta (price_snapshot = 800), no el nuevo.
  update public.product set price = 1000 where id = v_product;

  v_nc := public.issue_credit_note(
    'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
    v_sale.id, 'efectivo', 'anula',
    ('[{"product_id":"'||v_product||'","qty":1,"restock":true}]')::jsonb,
    1::smallint);

  if v_nc.total <> 800 then
    raise exception 'NC por boleta no uso price_snapshot (esperado 800): %', v_nc.total;
  end if;
  if v_nc.cod_ref <> 1 then raise exception 'NC no guardo cod_ref=1: %', v_nc.cod_ref; end if;
end $$;

-- issue_credit_note: NC por boleta rechaza devolver más de lo vendido.
do $$
declare
  v_product uuid := 'eeeeeeee-0000-0000-0000-000000000003';
  v_sale    public.sale;
begin
  insert into public.product (id, business_id, name, category_id, price) values
    (v_product,'aaaaaaaa-0000-0000-0000-000000000001','Suculenta','dddddddd-0000-0000-0000-000000000001',500);
  insert into public.inventory (product_id, branch_id, stock) values
    (v_product,'bbbbbbbb-0000-0000-0000-000000000001',10);

  -- Venta de qty=2 de ese producto.
  v_sale := public.charge_sale(
    'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
    ('[{"product_id":"'||v_product||'","qty":2}]')::jsonb,
    'efectivo', 1000, null);

  -- Intentar devolver qty=3 (más de lo vendido) debe ser rechazado.
  begin
    perform public.issue_credit_note(
      'bbbbbbbb-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
      v_sale.id, 'efectivo', 'anula',
      ('[{"product_id":"'||v_product||'","qty":3,"restock":true}]')::jsonb,
      1::smallint);
    raise exception 'FALLO: NC devolvió más de lo vendido sin rechazar';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like '%excede la vendida%' then
      raise exception 'error inesperado al validar over-return: %', sqlerrm;
    end if;
  end;
end $$;

-- handle_new_user: al insertar en auth.users se crea el espejo en app_user
do $$
declare v_uid uuid := '99999999-0000-0000-0000-000000000001'; v_name text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_uid, '222222222@pos.kromi.local',
          jsonb_build_object(
            'business_id','aaaaaaaa-0000-0000-0000-000000000001',
            'name','Daniela Soto','rut','22.222.222-2','role','admin'));
  select name into v_name from public.app_user where id = v_uid;
  if v_name is distinct from 'Daniela Soto' then
    raise exception 'espejo app_user no creado o nombre incorrecto: %', v_name;
  end if;
end $$;

-- convert_quote: crea venta desde una cotización vigente, baja stock y
-- marca la cotización como convertida con sale_id apuntando a la venta.
do $$
declare
  v_session uuid := 'f0000000-0000-0000-0000-000000000002';
  v_quote   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_sale    public.sale;
  v_converted boolean; v_sale_id uuid;
begin
  -- Caja 3 + sesión abierta propia (índice único de sesión abierta por register).
  insert into public.register (id, branch_id, name) values
    ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','Caja 3')
    on conflict do nothing;
  insert into public.cash_session (id, business_id, branch_id, register_id, status)
    values (v_session,'aaaaaaaa-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','open')
    on conflict do nothing;

  -- Cotización vigente (valid_until futura) con una línea del producto con stock.
  -- El price_snapshot cotizado es 14990 (precio al momento de cotizar).
  insert into public.quote (id, business_id, branch_id, folio, valid_until, total, neto, iva) values
    (v_quote,'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
     public.next_folio('bbbbbbbb-0000-0000-0000-000000000001','quote'),
     current_date + 30, 14990, round(14990/1.19), 14990 - round(14990/1.19));
  insert into public.quote_line (quote_id, product_id, name_snapshot, price_snapshot, qty) values
    (v_quote,'eeeeeeee-0000-0000-0000-000000000001','Monstera',14990,1);

  -- El precio del producto SUBE tras cotizar (14990 -> 29980). La conversión DEBE
  -- cobrar al precio COTIZADO (price_snapshot = 14990), NO al precio nuevo (29980).
  update public.product set price = 29980
    where id = 'eeeeeeee-0000-0000-0000-000000000001';

  v_sale := public.convert_quote(v_quote, v_session, 'efectivo', 20000);

  -- Restaura el precio para no afectar assertions posteriores de otros bloques.
  update public.product set price = 14990
    where id = 'eeeeeeee-0000-0000-0000-000000000001';

  -- (a) se cobró al precio COTIZADO: total = price_snapshot·qty = 14990, vuelto = 5010.
  if v_sale.id is null then raise exception 'convert_quote no creó venta'; end if;
  if v_sale.folio <= 0 then raise exception 'folio de venta inválido: %', v_sale.folio; end if;
  if v_sale.total <> 14990 then raise exception 'convert_quote no cobró el precio cotizado (esperado 14990, price_snapshot): %', v_sale.total; end if;
  if v_sale.change <> 5010 then raise exception 'vuelto venta convertida incorrecto: %', v_sale.change; end if;

  -- (a.2) la sale_line quedó con el precio cotizado, no el precio nuevo del producto.
  if (select price_snapshot from public.sale_line where sale_id = v_sale.id
        and product_id = 'eeeeeeee-0000-0000-0000-000000000001') <> 14990 then
    raise exception 'sale_line.price_snapshot no es el precio cotizado (14990)';
  end if;

  -- (b) la cotización quedó convertida y con sale_id apuntando a la venta.
  select converted, sale_id into v_converted, v_sale_id from public.quote where id = v_quote;
  if v_converted is not true then raise exception 'quote.converted no quedó true'; end if;
  if v_sale_id is distinct from v_sale.id then
    raise exception 'quote.sale_id no apunta a la venta: % vs %', v_sale_id, v_sale.id;
  end if;
end $$;

\echo 'rpc_test (folios+caja) OK'
rollback;
