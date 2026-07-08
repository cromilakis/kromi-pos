-- ============================================================================
-- Migración: correlativo interno de proveedor (supplier.seq) + código interno
-- único de producto (product.internal_code) generado como {seq}-{código proveedor}.
-- Reescribe recepcionar_factura para asignar el correlativo atómicamente y
-- generar el código al crear productos. Contrato:
-- docs/superpowers/specs/2026-07-07-mapeo-proveedor-producto-design.md
-- ============================================================================

alter table public.supplier add column if not exists seq int;
create unique index if not exists uq_supplier_seq
  on public.supplier(business_id, seq) where seq is not null;

alter table public.product add column if not exists internal_code text;
create unique index if not exists uq_product_internal_code
  on public.product(business_id, internal_code) where internal_code is not null;

create or replace function public.recepcionar_factura(
  p_branch uuid, p_supplier jsonb, p_doc jsonb, p_lines jsonb, p_pdf_path text
)
returns public.purchase_invoice
language plpgsql security definer set search_path = ''
as $$
declare
  v_business uuid;
  v_supplier uuid;
  v_seq      int;
  v_inv      public.purchase_invoice;
  v_pid      uuid;
  v_code     text;
  ln         jsonb;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  -- Serializa la asignación de seq (proveedor y código de respaldo) por negocio
  perform pg_advisory_xact_lock(hashtext('supplier_seq:' || v_business::text));

  -- Proveedor: usar el id dado o crear, asignando correlativo por negocio
  v_supplier := nullif(p_supplier->>'id','')::uuid;
  if v_supplier is null then
    select coalesce(max(seq), 0) + 1 into v_seq from public.supplier where business_id = v_business;
    insert into public.supplier (business_id, seq, razon_social, rut, giro, email, phone, address)
    values (v_business, v_seq, p_supplier->>'razon_social', p_supplier->>'rut',
            p_supplier->>'giro', p_supplier->>'email', p_supplier->>'phone', p_supplier->>'address')
    returning id into v_supplier;
  else
    select seq into v_seq from public.supplier where id = v_supplier;
    if v_seq is null then
      select coalesce(max(seq), 0) + 1 into v_seq from public.supplier where business_id = v_business;
      update public.supplier set seq = v_seq where id = v_supplier;
    end if;
  end if;

  -- Cabecera de la factura (unique business+supplier+doc_type+folio evita duplicados)
  insert into public.purchase_invoice (business_id, supplier_id, branch_id, doc_type, folio, issued_at, neto, iva, total, pdf_path, created_by)
  values (v_business, v_supplier, p_branch, p_doc->>'doc_type', p_doc->>'folio',
          nullif(p_doc->>'issued_at','')::date, coalesce((p_doc->>'neto')::int,0),
          coalesce((p_doc->>'iva')::int,0), coalesce((p_doc->>'total')::int,0), p_pdf_path, auth.uid())
  returning * into v_inv;

  -- Líneas
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_pid := nullif(ln->>'product_id','')::uuid;
    -- Crear producto nuevo si corresponde, con código interno {seq}-{código proveedor}
    if v_pid is null and (ln->'new_product') is not null then
      v_code := lpad(v_seq::text, 3, '0') || '-' ||
                coalesce(nullif(ln->>'supplier_code',''),
                         'S' || (select count(*) + 1 from public.product where business_id = v_business and supplier_id = v_supplier)::text);
      insert into public.product (business_id, name, category_id, price, supplier_id, internal_code)
      values (v_business, ln->'new_product'->>'name',
              nullif(ln->'new_product'->>'category_id','')::uuid, 0, v_supplier, v_code)
      returning id into v_pid;
    end if;
    if v_pid is null then raise exception 'línea sin producto (product_id o new_product requerido)'; end if;

    -- Recordar mapeo proveedor→código→producto + último costo
    insert into public.supplier_product (business_id, supplier_id, supplier_code, product_id, last_cost)
    values (v_business, v_supplier, ln->>'supplier_code', v_pid, (ln->>'unit_cost')::int)
    on conflict (supplier_id, supplier_code)
      do update set product_id = excluded.product_id, last_cost = excluded.last_cost, updated_at = now();

    -- Línea de factura (historial de costo)
    insert into public.purchase_invoice_line (invoice_id, product_id, supplier_code, description, qty, unit_cost, line_total)
    values (v_inv.id, v_pid, ln->>'supplier_code', ln->>'description',
            (ln->>'qty')::int, (ln->>'unit_cost')::int, coalesce((ln->>'line_total')::int, 0));

    -- Sumar stock en la sucursal
    insert into public.inventory (product_id, branch_id, stock)
    values (v_pid, p_branch, (ln->>'qty')::int)
    on conflict (product_id, branch_id) do update set stock = public.inventory.stock + (ln->>'qty')::int;
  end loop;

  return v_inv;
end;
$$;
