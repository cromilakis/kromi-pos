-- ============================================================================
-- Migración: recepción de compras por factura
-- Contrato: docs/superpowers/specs/2026-07-07-recepcion-compras-factura-design.md
-- Tablas: supplier_product (mapeo + último costo), purchase_invoice, purchase_invoice_line.
-- Bucket privado purchase-invoices. RPC recepcionar_factura (atómica).
-- ============================================================================

create table public.supplier_product (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.business(id) on delete cascade,
  supplier_id   uuid not null references public.supplier(id) on delete cascade,
  supplier_code text not null,
  product_id    uuid not null references public.product(id) on delete cascade,
  last_cost     int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (supplier_id, supplier_code)
);

create table public.purchase_invoice (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  supplier_id uuid not null references public.supplier(id) on delete restrict,
  branch_id   uuid not null references public.branch(id) on delete restrict,
  doc_type    text,
  folio       text not null,
  issued_at   date,
  neto        int not null default 0,
  iva         int not null default 0,
  total       int not null default 0,
  pdf_path    text,
  created_by  uuid references public.app_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (business_id, supplier_id, folio)
);

create table public.purchase_invoice_line (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.purchase_invoice(id) on delete cascade,
  product_id    uuid references public.product(id) on delete set null,
  supplier_code text,
  description   text,
  qty           int not null check (qty > 0),
  unit_cost     int not null check (unit_cost >= 0),
  line_total    int not null
);

-- Triggers updated_at (reutiliza public.set_updated_at de ①)
create trigger trg_supplier_product_updated before update on public.supplier_product
  for each row execute function public.set_updated_at();

-- Índices
create index idx_supplier_product_business on public.supplier_product(business_id);
create index idx_supplier_product_product on public.supplier_product(product_id);
create index idx_purchase_invoice_business on public.purchase_invoice(business_id);
create index idx_purchase_invoice_supplier on public.purchase_invoice(supplier_id);
create index idx_purchase_invoice_line_invoice on public.purchase_invoice_line(invoice_id);
create index idx_purchase_invoice_line_product on public.purchase_invoice_line(product_id);

-- RPC atómica: recepcionar_factura
create or replace function public.recepcionar_factura(
  p_branch uuid, p_supplier jsonb, p_doc jsonb, p_lines jsonb, p_pdf_path text
)
returns public.purchase_invoice
language plpgsql security definer set search_path = ''
as $$
declare
  v_business uuid;
  v_supplier uuid;
  v_inv      public.purchase_invoice;
  v_pid      uuid;
  ln         jsonb;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

  -- Proveedor: usar el id dado o crear
  v_supplier := nullif(p_supplier->>'id','')::uuid;
  if v_supplier is null then
    insert into public.supplier (business_id, razon_social, rut, giro, email, phone, address)
    values (v_business, p_supplier->>'razon_social', p_supplier->>'rut',
            p_supplier->>'giro', p_supplier->>'email', p_supplier->>'phone', p_supplier->>'address')
    returning id into v_supplier;
  end if;

  -- Cabecera de la factura (unique business+supplier+folio evita duplicados)
  insert into public.purchase_invoice (business_id, supplier_id, branch_id, doc_type, folio, issued_at, neto, iva, total, pdf_path, created_by)
  values (v_business, v_supplier, p_branch, p_doc->>'doc_type', p_doc->>'folio',
          nullif(p_doc->>'issued_at','')::date, coalesce((p_doc->>'neto')::int,0),
          coalesce((p_doc->>'iva')::int,0), coalesce((p_doc->>'total')::int,0), p_pdf_path, auth.uid())
  returning * into v_inv;

  -- Líneas
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_pid := nullif(ln->>'product_id','')::uuid;
    -- Crear producto nuevo si corresponde
    if v_pid is null and (ln->'new_product') is not null then
      insert into public.product (business_id, name, category_id, price, supplier_id)
      values (v_business, ln->'new_product'->>'name',
              nullif(ln->'new_product'->>'category_id','')::uuid, 0, v_supplier)
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

-- RLS
alter table public.supplier_product enable row level security;
alter table public.purchase_invoice enable row level security;
alter table public.purchase_invoice_line enable row level security;

create policy supplier_product_read on public.supplier_product for select
  using (business_id = public.current_business_id() or public.is_kromi());
create policy purchase_invoice_read on public.purchase_invoice for select
  using (business_id = public.current_business_id() or public.is_kromi());
create policy purchase_invoice_line_read on public.purchase_invoice_line for select
  using (exists (select 1 from public.purchase_invoice pi where pi.id = invoice_id
    and (pi.business_id = public.current_business_id() or public.is_kromi())));
-- Escritura: solo vía RPC (security definer). Sin políticas de write para el cliente.

-- Bucket privado de facturas + policies por negocio (ruta {business_id}/...)
insert into storage.buckets (id, name, public) values ('purchase-invoices','purchase-invoices', false)
  on conflict (id) do nothing;

create policy purchase_invoices_read on storage.objects for select to authenticated
  using (bucket_id = 'purchase-invoices'
    and (storage.foldername(name))[1] = public.current_business_id()::text);
create policy purchase_invoices_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-invoices'
    and (storage.foldername(name))[1] = public.current_business_id()::text);

grant execute on function public.recepcionar_factura(uuid, jsonb, jsonb, jsonb, text) to authenticated;
