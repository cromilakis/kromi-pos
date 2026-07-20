-- ============================================================================
-- Test RPC receive_invoice: crea proveedor/productos, mapea, registra
-- factura+líneas (historial de costo), suma inventario; atómica; no duplica.
-- Transacción con ROLLBACK.
-- ============================================================================
begin;
insert into public.business (id, name, rut) values ('bb000000-0000-0000-0000-000000000001','Neg','1-9');
insert into public.branch (id, business_id, name) values ('bc000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','Suc');
insert into public.folio_counter (branch_id, doc_type, next_value) values ('bc000000-0000-0000-0000-000000000001','sale',1);
insert into public.category (id, business_id, key, label) values ('ca000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','x','X');

-- Recepción: proveedor nuevo + 1 producto nuevo + 1 línea
do $$
declare v_inv public.purchase_invoice; v_pid uuid; v_stock int; v_cost int;
begin
  v_inv := public.receive_invoice(
    'bc000000-0000-0000-0000-000000000001',
    '{"razon_social":"Floriterra","rut":"78.964.380-6"}'::jsonb,
    '{"doc_type":"factura","folio":"59763","issued_at":"2026-07-02","neto":14970,"iva":2844,"total":17814}'::jsonb,
    '[{"new_product":{"name":"CTENANTHE LUBESIANA M.15","category_id":"ca000000-0000-0000-0000-000000000001"},"supplier_code":"00T017","description":"CTENANTHE LUBESIANA M.15","qty":3,"unit_cost":4990,"line_total":14970}]'::jsonb,
    'bb000000-0000-0000-0000-000000000001/x.pdf');

  -- proveedor creado
  if not exists (select 1 from public.supplier where rut='78.964.380-6' and business_id='bb000000-0000-0000-0000-000000000001') then
    raise exception 'proveedor no creado'; end if;
  -- producto creado + mapeo supplier_product
  select product_id into v_pid from public.supplier_product where supplier_code='00T017';
  if v_pid is null then raise exception 'mapeo supplier_product no creado'; end if;
  -- stock sumado en la sucursal
  select stock into v_stock from public.inventory where product_id=v_pid and branch_id='bc000000-0000-0000-0000-000000000001';
  if v_stock <> 3 then raise exception 'stock no sumado: %', v_stock; end if;
  -- costo guardado en la línea
  select unit_cost into v_cost from public.purchase_invoice_line where invoice_id=v_inv.id;
  if v_cost <> 4990 then raise exception 'costo no guardado: %', v_cost; end if;
  -- correlativo del proveedor = 1
  if (select seq from public.supplier where rut='78.964.380-6' and business_id='bb000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'seq del proveedor no es 1'; end if;
  -- código interno del producto = 001-00T017
  if (select internal_code from public.product where id=v_pid) <> '001-00T017' then
    raise exception 'internal_code esperado 001-00T017, got %', (select internal_code from public.product where id=v_pid); end if;
end $$;

-- No duplicar la misma factura (mismo proveedor+folio) → unique_violation
do $$
begin
  begin
    perform public.receive_invoice(
      'bc000000-0000-0000-0000-000000000001',
      (select jsonb_build_object('id', id, 'razon_social','Floriterra','rut','78.964.380-6') from public.supplier where rut='78.964.380-6'),
      '{"doc_type":"factura","folio":"59763","issued_at":"2026-07-02","neto":14970,"iva":2844,"total":17814}'::jsonb,
      '[]'::jsonb, 'x/y.pdf');
    raise exception 'FALLO: se cargó dos veces la misma factura';
  exception when unique_violation then null;
    when others then if sqlerrm like 'FALLO:%' then raise; end if;
  end;
end $$;

-- Segundo proveedor (seq=2) que trae el MISMO producto (enlazado por product_id)
-- + un producto nuevo con supplier_code vacío (respaldo de código por índice).
do $$
declare v_pid uuid; v_stock int; v_seq int; v_new_code text;
begin
  select product_id into v_pid from public.supplier_product where supplier_code='00T017';
  perform public.receive_invoice(
    'bc000000-0000-0000-0000-000000000001',
    '{"razon_social":"Vivero Sur","rut":"77.111.222-3"}'::jsonb,
    '{"doc_type":"factura","folio":"1001","issued_at":"2026-07-03","neto":10000,"iva":1900,"total":11900}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('product_id', v_pid, 'supplier_code','VS-99','description','mismo prod','qty',2,'unit_cost',5000,'line_total',10000),
      jsonb_build_object('new_product', jsonb_build_object('name','SIN CODIGO','category_id','ca000000-0000-0000-0000-000000000001'), 'supplier_code','','description','sin codigo','qty',1,'unit_cost',0,'line_total',0)
    ),
    'bb000000-0000-0000-0000-000000000001/z.pdf');

  -- seq del segundo proveedor = 2
  select seq into v_seq from public.supplier where rut='77.111.222-3';
  if v_seq <> 2 then raise exception 'seq del 2do proveedor esperado 2, got %', v_seq; end if;
  -- internal_code del producto compartido NO cambió (sigue 001-00T017)
  if (select internal_code from public.product where id=v_pid) <> '001-00T017' then
    raise exception 'internal_code del producto compartido cambió'; end if;
  -- stock sumado: 3 (1ra recepción) + 2 (2da) = 5
  select stock into v_stock from public.inventory where product_id=v_pid and branch_id='bc000000-0000-0000-0000-000000000001';
  if v_stock <> 5 then raise exception 'stock esperado 5, got %', v_stock; end if;
  -- producto nuevo con supplier_code vacío usa respaldo por correlativo de proveedor: 002-S%
  select internal_code into v_new_code from public.product where name='SIN CODIGO';
  if v_new_code not like '002-S%' then raise exception 'internal_code de respaldo esperado 002-S%%, got %', v_new_code; end if;
end $$;

-- Segunda recepción del MISMO proveedor (Vivero Sur) con OTRO folio y otra línea
-- new_product con supplier_code vacío: no debe colisionar con el código de respaldo
-- generado en la recepción anterior (prueba el fix de la colisión entre facturas).
do $$
declare v_new_code1 text; v_new_code2 text;
begin
  select internal_code into v_new_code1 from public.product where name='SIN CODIGO';

  perform public.receive_invoice(
    'bc000000-0000-0000-0000-000000000001',
    (select jsonb_build_object('id', id, 'razon_social','Vivero Sur','rut','77.111.222-3') from public.supplier where rut='77.111.222-3'),
    '{"doc_type":"factura","folio":"1002","issued_at":"2026-07-04","neto":5000,"iva":950,"total":5950}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('new_product', jsonb_build_object('name','SIN CODIGO 2','category_id','ca000000-0000-0000-0000-000000000001'), 'supplier_code','','description','sin codigo 2','qty',1,'unit_cost',0,'line_total',0)
    ),
    'bb000000-0000-0000-0000-000000000001/w.pdf');

  select internal_code into v_new_code2 from public.product where name='SIN CODIGO 2';
  if v_new_code2 not like '002-S%' then raise exception 'internal_code de respaldo esperado 002-S%%, got %', v_new_code2; end if;
  if v_new_code2 = v_new_code1 then
    raise exception 'colisión: el código de respaldo se repitió entre facturas: %', v_new_code2; end if;
end $$;

-- Código de proveedor REPETIDO en varias líneas de la MISMA factura: debe crear
-- UN solo producto y SUMAR el stock, sin unique_violation (fix del 409).
do $$
declare v_pid uuid; v_stock int; v_n int;
begin
  perform public.receive_invoice(
    'bc000000-0000-0000-0000-000000000001',
    '{"razon_social":"Repetido SA","rut":"76.555.444-2"}'::jsonb,
    '{"doc_type":"factura","folio":"7000","issued_at":"2026-07-05","neto":3000,"iva":570,"total":3570}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('new_product', jsonb_build_object('name','DUP A','category_id','ca000000-0000-0000-0000-000000000001'), 'supplier_code','DUP1','description','dup a','qty',2,'unit_cost',500,'line_total',1000),
      jsonb_build_object('new_product', jsonb_build_object('name','DUP A (repetida)','category_id','ca000000-0000-0000-0000-000000000001'), 'supplier_code','DUP1','description','dup a','qty',4,'unit_cost',500,'line_total',2000)
    ),
    'bb000000-0000-0000-0000-000000000001/dup.pdf');

  -- Un solo producto creado para ese proveedor (no dos con el mismo internal_code)
  select count(distinct sp.product_id) into v_n from public.supplier_product sp join public.supplier s on s.id=sp.supplier_id where s.rut='76.555.444-2';
  if v_n <> 1 then raise exception 'esperaba 1 producto creado para código repetido, got %', v_n; end if;
  -- Stock sumado: 2 + 4 = 6
  select product_id into v_pid from public.supplier_product where supplier_code='DUP1';
  select stock into v_stock from public.inventory where product_id=v_pid and branch_id='bc000000-0000-0000-0000-000000000001';
  if v_stock <> 6 then raise exception 'stock esperado 6 para código repetido, got %', v_stock; end if;
end $$;

\echo 'purchases_test OK'
rollback;
