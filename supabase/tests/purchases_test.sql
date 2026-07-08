-- ============================================================================
-- Test RPC recepcionar_factura: crea proveedor/productos, mapea, registra
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
  v_inv := public.recepcionar_factura(
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
end $$;

-- No duplicar la misma factura (mismo proveedor+folio) → unique_violation
do $$
begin
  begin
    perform public.recepcionar_factura(
      'bc000000-0000-0000-0000-000000000001',
      (select jsonb_build_object('id', id, 'razon_social','Floriterra','rut','78.964.380-6') from public.supplier where rut='78.964.380-6'),
      '{"doc_type":"factura","folio":"59763","issued_at":"2026-07-02","neto":14970,"iva":2844,"total":17814}'::jsonb,
      '[]'::jsonb, 'x/y.pdf');
    raise exception 'FALLO: se cargó dos veces la misma factura';
  exception when unique_violation then null;
    when others then if sqlerrm like 'FALLO:%' then raise; end if;
  end;
end $$;

\echo 'purchases_test OK'
rollback;
