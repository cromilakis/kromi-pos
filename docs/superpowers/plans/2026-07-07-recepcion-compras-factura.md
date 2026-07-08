# Recepción de compras por factura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir una factura de compra (PDF), extraer sus datos con IA de visión (OpenAI `gpt-5-nano`), confirmarlos en pantalla y cargar stock masivo — creando proveedor/productos faltantes, guardando historial de costos y archivando el PDF.

**Architecture:** Edge function (Supabase, Deno) que envía el PDF a OpenAI (Responses API + structured outputs) y devuelve JSON estructurado; el PDF se archiva en Storage. El frontend muestra una pantalla de confirmación (proveedor por RUT, auto-mapeo de líneas por código de proveedor, crear productos) y al confirmar llama una RPC atómica `recepcionar_factura` que crea/mapea/registra y suma inventario. El precio de venta no se toca; se guarda el costo (historial).

**Tech Stack:** Supabase (Postgres, Edge Functions/Deno, Storage), OpenAI Responses API (`gpt-5-nano`, `input_file` + `text.format` json_schema), React 18 + TS + TanStack Query, Vitest.

## Global Constraints

- Prosa/UI en español; identificadores/código en inglés.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; PROHIBIDO `Co-Authored-By`/atribución a Claude.
- `git add` de archivos específicos por tarea; nunca `git add -A`. NO tocar `src-tauri/*`.
- **`OPENAI_API_KEY` es secreta**: vive como secret de la edge function (`supabase secrets set` en cloud, `--env-file` en local). NUNCA en el cliente ni en variables `VITE_*`.
- Modelo OpenAI: **`gpt-5-nano`** (alias, última nano de GPT-5), vía **Responses API** con `input_file` (PDF) y **Structured Outputs** (`text.format: { type: "json_schema", strict: true, ... }`).
- Montos en CLP enteros; IVA incluido. La extracción es **sugerencia**: la carga real siempre requiere confirmación del usuario.
- Operaciones críticas (crear proveedor/productos, sumar inventario, registrar factura) SOLO por RPC `recepcionar_factura` (atómica, `security definer`, valida tenancy). El cliente no las escribe sueltas.
- Tablas nuevas con `business_id` + RLS por negocio; bucket de Storage privado por negocio.
- Precio de venta NO se altera; se guarda el costo (historial).

## File Structure

- `supabase/migrations/20260707130000_purchases.sql` — tablas `supplier_product`, `purchase_invoice`, `purchase_invoice_line`; RLS + índices; bucket `purchase-invoices` + storage policies; RPC `recepcionar_factura`.
- `supabase/functions/extract-invoice/index.ts` — edge function (Deno): recibe PDF → sube a Storage → OpenAI → JSON.
- `supabase/functions/extract-invoice/deno.json` — config/imports de la función.
- `supabase/tests/purchases_test.sql` — test de la RPC (atomicidad, mapeo, suma de stock, no-duplicado).
- `src/lib/invoice.ts` + `src/lib/invoice.test.ts` — lógica pura: validación/normalización del JSON extraído, verificación de montos, auto-mapeo por código.
- `src/data/purchases.ts` — hooks/wrappers: `extractInvoice` (llama la función), `useSupplierByRut`, `useSupplierProductMap`, `recepcionarFactura` (RPC), `usePurchaseInvoices`, `invoiceDownloadUrl`.
- `src/modules/stock/InvoiceUpload.tsx` — botón "Cargar desde factura" + subida del PDF.
- `src/modules/stock/InvoiceConfirm.tsx` — pantalla de confirmación (proveedor, líneas, mapeo/crear, verificación de montos, confirmar).
- `src/modules/stock/StockScreen.tsx` (modificar) — botón de entrada.
- `src/modules/compras/PurchaseInvoicesList.tsx` — listado de facturas cargadas + descarga (accesible desde Proveedores/Stock).

**Comandos:** `pnpm db:reset`, `pnpm test:db`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Edge function local: `supabase functions serve extract-invoice --env-file supabase/functions/.env`.

---

### Task 1: Migración de compras (tablas, RLS, bucket, RPC)

**Files:**
- Create: `supabase/migrations/20260707130000_purchases.sql`, `supabase/tests/purchases_test.sql`

**Interfaces:**
- Produces: tablas `supplier_product`, `purchase_invoice`, `purchase_invoice_line`; RPC `public.recepcionar_factura(p_branch uuid, p_supplier jsonb, p_doc jsonb, p_lines jsonb, p_pdf_path text) returns public.purchase_invoice`; bucket `purchase-invoices`.
  - `p_supplier`: `{ id?: uuid, razon_social, rut, ... }` (si `id` viene, usa ese proveedor; si no, lo crea).
  - `p_lines`: `[{ product_id?: uuid, new_product?: {name, category_id}, supplier_code, description, qty, unit_cost, line_total }]`.
  - `p_doc`: `{ doc_type, folio, issued_at, neto, iva, total }`.

- [ ] **Step 1: Escribir el test de la RPC (falla)**

`supabase/tests/purchases_test.sql`:
```sql
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
```
> Nota: el `iva`/`total` del fixture son ilustrativos; la RPC guarda los montos del `p_doc` tal cual (no los recalcula). Ajustar el `\echo` si se añaden asserts.

- [ ] **Step 2: Correr el test (falla)**

Run: `cd /c/Kromi/kromi-pos && docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/purchases_test.sql`
Expected: FALLA (`relation "public.supplier_product" does not exist` / función inexistente).

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20260707130000_purchases.sql`:
```sql
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
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/purchases_test.sql`
Expected: `purchases_test OK`. Además `pnpm test:db` sigue OK.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260707130000_purchases.sql supabase/tests/purchases_test.sql
git commit -m "feat(compras): tablas de compras, RLS, bucket y RPC recepcionar_factura" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 2: Edge function `extract-invoice` (OpenAI visión)

**Files:**
- Create: `supabase/functions/extract-invoice/index.ts`, `supabase/functions/extract-invoice/deno.json`, `supabase/functions/.env.example`

**Interfaces:**
- Produces: endpoint POST que recibe el PDF (multipart `file`) autenticado; sube el PDF a Storage `purchase-invoices/{business_id}/{uuid}.pdf`; llama OpenAI; devuelve `{ pdf_path, extraction: { proveedor, documento, lineas } }`.

- [ ] **Step 1: Config e imports**

`supabase/functions/extract-invoice/deno.json`:
```json
{ "imports": { "@supabase/supabase-js": "npm:@supabase/supabase-js@2" } }
```
`supabase/functions/.env.example`:
```
OPENAI_API_KEY=sk-...
```
> El secret real NO se commitea. Local: crear `supabase/functions/.env` (gitignored) con `OPENAI_API_KEY=...` (copiar de la raíz `.env.local`). Cloud: `supabase secrets set OPENAI_API_KEY=...`. Asegurar que `supabase/functions/.env` esté en `.gitignore`.

- [ ] **Step 2: Implementar la función**

`supabase/functions/extract-invoice/index.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Esquema de extracción (structured outputs).
const schema = {
  name: "invoice_extraction",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["proveedor", "documento", "lineas"],
    properties: {
      proveedor: { type: "object", additionalProperties: false, required: ["razon_social", "rut"],
        properties: { razon_social: { type: "string" }, rut: { type: "string" } } },
      documento: { type: "object", additionalProperties: false, required: ["tipo", "folio", "fecha", "neto", "iva", "total"],
        properties: { tipo: { type: "string" }, folio: { type: "string" }, fecha: { type: "string" },
          neto: { type: "number" }, iva: { type: "number" }, total: { type: "number" } } },
      lineas: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["supplier_code", "description", "qty", "unit_cost", "line_total"],
        properties: { supplier_code: { type: "string" }, description: { type: "string" },
          qty: { type: "number" }, unit_cost: { type: "number" }, line_total: { type: "number" } } } },
    },
  },
};

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // Cliente con el JWT del usuario (para resolver su business_id vía RLS/RPC).
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const form = await req.formData();
    const file = form.get("file") as File;
    if (!file) return json({ error: "Falta el archivo 'file'." }, 400);

    // business_id del usuario autenticado
    const { data: prof } = await supa.from("app_user").select("business_id").maybeSingle();
    const businessId = prof?.business_id;
    if (!businessId) return json({ error: "Usuario sin negocio." }, 403);

    // Subir el PDF a Storage
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfPath = `${businessId}/${crypto.randomUUID()}.pdf`;
    const up = await admin.storage.from("purchase-invoices").upload(pdfPath, bytes, { contentType: "application/pdf" });
    if (up.error) return json({ error: "No se pudo archivar el PDF." }, 500);

    // Subir el PDF a OpenAI Files → file_id
    const oaForm = new FormData();
    oaForm.append("purpose", "user_data");
    oaForm.append("file", new Blob([bytes], { type: "application/pdf" }), "factura.pdf");
    const upf = await fetch("https://api.openai.com/v1/files", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: oaForm });
    const upfJson = await upf.json();
    if (!upf.ok) return json({ error: "OpenAI files: " + JSON.stringify(upfJson) }, 502);
    const fileId = upfJson.id;

    // Responses API con input_file + structured outputs
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-nano",
        input: [{ role: "user", content: [
          { type: "input_text", text: "Extrae los datos de esta factura de compra chilena en el formato indicado. Montos en pesos (enteros, sin separadores). El proveedor es el emisor." },
          { type: "input_file", file_id: fileId },
        ] }],
        text: { format: { type: "json_schema", ...schema } },
      }),
    });
    const respJson = await resp.json();
    if (!resp.ok) return json({ error: "OpenAI responses: " + JSON.stringify(respJson) }, 502);

    // Extraer el JSON del output
    const text = respJson.output_text
      ?? respJson.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text;
    const extraction = JSON.parse(text);

    return json({ pdf_path: pdfPath, extraction }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
```
> Nota: los nombres exactos de la Responses API (`input_file`, `text.format`, `output_text`) deben confirmarse contra la doc vigente de OpenAI al implementar (developers.openai.com/api/docs/guides/file-inputs y /structured-outputs); ajustar si cambió. `gpt-5-nano` es alias a la última nano.

- [ ] **Step 3: Configurar la key y verificar localmente**

```bash
# Copiar la key desde la raíz .env.local al entorno de funciones (gitignored)
grep '^OPENAI_API_KEY=' /c/Kromi/kromi-pos/.env.local > /c/Kromi/kromi-pos/supabase/functions/.env
cd /c/Kromi/kromi-pos && supabase functions serve extract-invoice --env-file supabase/functions/.env
```
Verificar con la factura real (en otra terminal), usando un JWT de un usuario del negocio:
```bash
curl -s -X POST http://localhost:55321/functions/v1/extract-invoice \
  -H "Authorization: Bearer <JWT_USUARIO>" \
  -F "file=@/c/Users/Cromi/Downloads/Factura Electrónica59763.pdf" | head -c 800
```
Expected: JSON con `pdf_path` y `extraction.proveedor.rut = "78.964.380-6"` y ~24 líneas.
> Obtener el JWT: iniciar sesión en la app (o `supabase.auth.signInWithPassword`) y copiar el access token. Si la verificación en vivo con OpenAI no es posible en este entorno, documentarlo y dejar la verificación para el usuario.

- [ ] **Step 4: Asegurar .gitignore y commit**

Confirmar que `supabase/functions/.env` está ignorado (`git check-ignore supabase/functions/.env`; si no, agregarlo a `.gitignore`).
```bash
git add supabase/functions/extract-invoice/index.ts supabase/functions/extract-invoice/deno.json supabase/functions/.env.example .gitignore
git commit -m "feat(compras): edge function extract-invoice (OpenAI gpt-5-nano, structured outputs)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 3: Lógica pura de factura + hooks de datos (TDD)

**Files:**
- Create: `src/lib/invoice.ts`, `src/lib/invoice.test.ts`, `src/data/purchases.ts`

**Interfaces:**
- Produces:
  - `normalizeExtraction(raw): Extraction` (valida/coerce números y RUT).
  - `checkTotals(lines): { computed: number }` y `totalsMatch(computed, docTotal, tol=2): boolean`.
  - `Extraction`, `ExtractedLine` types.
  - hooks: `useSupplierByRut(rut)`, `useSupplierProductMap(supplierId)`, `recepcionarFactura(args)`, `usePurchaseInvoices(businessId)`, `invoiceDownloadUrl(pdfPath)`.

- [ ] **Step 1: Test de lógica pura (falla)**

`src/lib/invoice.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeExtraction, checkLineTotal, totalsMatch } from "./invoice";

describe("normalizeExtraction", () => {
  it("coacciona montos a enteros y conserva líneas", () => {
    const r = normalizeExtraction({
      proveedor: { razon_social: "Floriterra", rut: "78.964.380-6" },
      documento: { tipo: "factura", folio: "59763", fecha: "2026-07-02", neto: 493210, iva: 93710, total: 586920 },
      lineas: [{ supplier_code: "00T017", description: "CTENANTHE", qty: 3, unit_cost: 4990, line_total: 14970 }],
    });
    expect(r.documento.total).toBe(586920);
    expect(r.lineas[0].qty).toBe(3);
  });
});

describe("checkLineTotal / totalsMatch", () => {
  it("detecta que qty*unit_cost coincide con line_total", () => {
    expect(checkLineTotal({ qty: 3, unit_cost: 4990, line_total: 14970 } as any)).toBe(true);
    expect(checkLineTotal({ qty: 3, unit_cost: 4990, line_total: 999 } as any)).toBe(false);
  });
  it("totalsMatch tolera diferencia de redondeo pequeña", () => {
    expect(totalsMatch(493210, 493210)).toBe(true);
    expect(totalsMatch(493210, 490000)).toBe(false);
  });
});
```
Run: `pnpm test src/lib/invoice.test.ts` → FALLA.

- [ ] **Step 2: Implementar `invoice.ts`**

`src/lib/invoice.ts`:
```ts
export interface ExtractedLine { supplier_code: string; description: string; qty: number; unit_cost: number; line_total: number; }
export interface Extraction {
  proveedor: { razon_social: string; rut: string };
  documento: { tipo: string; folio: string; fecha: string; neto: number; iva: number; total: number };
  lineas: ExtractedLine[];
}

const int = (n: unknown) => Math.round(Number(n) || 0);

export function normalizeExtraction(raw: any): Extraction {
  return {
    proveedor: { razon_social: String(raw?.proveedor?.razon_social ?? "").trim(), rut: String(raw?.proveedor?.rut ?? "").trim() },
    documento: {
      tipo: String(raw?.documento?.tipo ?? ""), folio: String(raw?.documento?.folio ?? ""),
      fecha: String(raw?.documento?.fecha ?? ""),
      neto: int(raw?.documento?.neto), iva: int(raw?.documento?.iva), total: int(raw?.documento?.total),
    },
    lineas: (raw?.lineas ?? []).map((l: any) => ({
      supplier_code: String(l?.supplier_code ?? "").trim(), description: String(l?.description ?? "").trim(),
      qty: int(l?.qty), unit_cost: int(l?.unit_cost), line_total: int(l?.line_total),
    })),
  };
}

export function checkLineTotal(l: ExtractedLine): boolean { return l.qty * l.unit_cost === l.line_total; }
export function totalsMatch(computed: number, docTotal: number, tol = 2): boolean { return Math.abs(computed - docTotal) <= tol; }
export function sumLineTotals(lines: ExtractedLine[]): number { return lines.reduce((s, l) => s + l.line_total, 0); }
```
Run: `pnpm test src/lib/invoice.test.ts` → PASS.

- [ ] **Step 3: Hooks de datos (`purchases.ts`)**

`src/data/purchases.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Extraction } from "@/lib/invoice";

/** Llama la edge function extract-invoice con el PDF. */
export async function extractInvoice(file: File): Promise<{ pdf_path: string; extraction: Extraction }> {
  const form = new FormData();
  form.append("file", file);
  const { data, error } = await supabase.functions.invoke("extract-invoice", { body: form });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { pdf_path: string; extraction: Extraction };
}

export function useSupplierByRut(rut: string | undefined) {
  return useQuery({
    queryKey: ["supplier-by-rut", rut], enabled: !!rut,
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier").select("id,razon_social,rut").eq("rut", rut!).maybeSingle();
      if (error) throw error; return data;
    },
  });
}

export function useSupplierProductMap(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["supplier-product-map", supplierId], enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier_product").select("supplier_code,product_id").eq("supplier_id", supplierId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.supplier_code, r.product_id]));
    },
  });
}

export async function recepcionarFactura(args: {
  p_branch: string;
  p_supplier: Record<string, unknown>;
  p_doc: Record<string, unknown>;
  p_lines: Record<string, unknown>[];
  p_pdf_path: string;
}) {
  const { data, error } = await supabase.rpc("recepcionar_factura", args);
  if (error) throw error; return data;
}

export function usePurchaseInvoices(businessId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-invoices", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_invoice")
        .select("id,folio,issued_at,total,pdf_path,supplier:supplier_id(razon_social)")
        .eq("business_id", businessId!).order("created_at", { ascending: false }).limit(50);
      if (error) throw error; return data ?? [];
    },
  });
}

export async function invoiceDownloadUrl(pdfPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("purchase-invoices").createSignedUrl(pdfPath, 60);
  if (error) throw error; return data.signedUrl;
}
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm typecheck && pnpm test` → OK.
```bash
git add src/lib/invoice.ts src/lib/invoice.test.ts src/data/purchases.ts
git commit -m "feat(compras): lógica de extracción (validación/montos) y hooks de datos" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 4: UI de subida y confirmación

**Files:**
- Create: `src/modules/stock/InvoiceUpload.tsx`, `src/modules/stock/InvoiceConfirm.tsx`
- Modify: `src/modules/stock/StockScreen.tsx` (botón "Cargar desde factura")

**Interfaces:**
- Consumes: `extractInvoice`, `useSupplierByRut`, `useSupplierProductMap`, `recepcionarFactura`, `useCategories`/`useProductsWithStock` (de stock), `useWork` (branch), `normalizeExtraction`, `checkLineTotal`, `sumLineTotals`, `totalsMatch`, `fmtCLP`.

- [ ] **Step 1: `InvoiceUpload` — subir PDF y extraer**

`src/modules/stock/InvoiceUpload.tsx`: input de archivo (accept `application/pdf`), botón "Subir factura"; al elegir el PDF, llama `extractInvoice(file)` (con estado de carga "Analizando factura…"), y al recibir `{pdf_path, extraction}` pasa a `InvoiceConfirm`. Muestra `toast.error` si falla (PDF ilegible, OpenAI, etc.). Fiel al estilo de la app (Card, botones `var(--brand)`).

- [ ] **Step 2: `InvoiceConfirm` — revisar y confirmar**

`src/modules/stock/InvoiceConfirm.tsx`, recibe `{ pdf_path, extraction }`:
- Normaliza con `normalizeExtraction`.
- **Proveedor**: `useSupplierByRut(extraction.proveedor.rut)`. Si existe → chip "Proveedor: {razon_social}"; si no → bloque editable "Nuevo proveedor" (razón social, RUT, opcionalmente giro/email/teléfono) con aviso "Se creará".
- **Líneas**: `useSupplierProductMap(supplierId)`; para cada línea, si el `supplier_code` está en el mapa → producto vinculado (mostrar nombre vía `useProductsWithStock`); si no → selector de producto existente **o** toggle "Crear nuevo" (usa `description` como nombre + selector de categoría con `useCategories`). Muestra `qty · código · descripción · costo unit · total`; marca en rojo las líneas donde `checkLineTotal` es falso.
- **Verificación de montos**: comparar `sumLineTotals(lineas)` con `documento.neto` vía `totalsMatch`; si no cuadra, banner de advertencia (no bloquea, solo avisa).
- **Confirmar**: arma `p_supplier` (con `id` si existe, o datos si nuevo), `p_doc` (tipo/folio/fecha/neto/iva/total), `p_lines` (cada una con `product_id` o `new_product{name,category_id}`, `supplier_code`, `description`, `qty`, `unit_cost`, `line_total`), y `p_pdf_path`; llama `recepcionarFactura`. Al éxito: `toast.success`, invalida `["products-with-stock"]`, `["critical-stock"]`, `["purchase-invoices"]`, `["supplier-product-map"]`, y vuelve a Stock. Errores (RPC: duplicado, etc.) → `toast.error`.

- [ ] **Step 3: Botón en Stock**

En `StockScreen.tsx`, agregar botón "Cargar desde factura" (visible para admin/kromi, como el resto de escritura de catálogo) que abre `InvoiceUpload` (en un panel/diálogo o vista). No romper el CRUD/CSV existente.

- [ ] **Step 4: Verificar y commit**

Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/modules/stock/InvoiceUpload.tsx src/modules/stock/InvoiceConfirm.tsx src/modules/stock/StockScreen.tsx
git commit -m "feat(compras): UI de subida y confirmación de factura (mapeo, crear proveedor/productos)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 5: Listado y descarga de facturas

**Files:**
- Create: `src/modules/compras/PurchaseInvoicesList.tsx`
- Modify: `src/modules/stock/StockScreen.tsx` (o Proveedores) — acceso al listado

**Interfaces:**
- Consumes: `usePurchaseInvoices`, `invoiceDownloadUrl`, `fmtCLP`.

- [ ] **Step 1: Listado + descarga**

`src/modules/compras/PurchaseInvoicesList.tsx`: tabla de facturas cargadas (proveedor, folio, fecha, total) con botón "Descargar PDF" que llama `invoiceDownloadUrl(pdf_path)` y abre la URL firmada (`window.open` o `<a download>`). Estados vacío/carga. Estilo de la app.

- [ ] **Step 2: Acceso**

Agregar acceso al listado desde Stock (pestaña/botón "Facturas de compra") o desde el módulo Proveedores. Elegir un solo lugar y dejarlo claro.

- [ ] **Step 3: Verificar y commit**

Run: `pnpm typecheck && pnpm test && pnpm build` → OK.
```bash
git add src/modules/compras/PurchaseInvoicesList.tsx src/modules/stock/StockScreen.tsx
git commit -m "feat(compras): listado y descarga de facturas de compra archivadas" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 6: Verificación integral y documentación

**Files:**
- Modify: `docs/frontend.md` (o `supabase/README.md`) — documentar la feature, la edge function y la config de la key.

- [ ] **Step 1: Batería de base + build**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:db && pnpm typecheck && pnpm test && pnpm build`
Expected: tests de BD (incl. `purchases_test` si se añade a `test:db`) OK; typecheck/tests/build OK.

- [ ] **Step 2: Verificación en vivo (usuario)**

Documentar el checklist para el usuario: `supabase functions serve extract-invoice --env-file supabase/functions/.env` + `pnpm tauri dev` → Stock → "Cargar desde factura" → subir la factura de Floriterra → confirmar (Floriterra como nuevo proveedor, crear productos) → verificar stock sumado, factura archivada/descargable → repetir con otra factura del mismo proveedor y ver auto-mapeo por código.

- [ ] **Step 3: Documentar y commit**

Actualizar `docs/frontend.md` con la feature de recepción de compras: flujo, edge function `extract-invoice`, cómo configurar `OPENAI_API_KEY` (local `--env-file`, cloud `supabase secrets set`), tablas y RPC. Commit:
```bash
git add docs/frontend.md
git commit -m "docs(compras): documentar recepción de compras por factura y config de la key" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

## Notas

- Añadir `test:purchases` a `package.json` (mismo patrón que `test:schema`) es opcional; si se hace, incluirlo en `pnpm test:db`.
- La extracción con OpenAI requiere red y la key; en entornos sin acceso, las tareas 1/3/5 se verifican igual (BD/lógica), y la 2/4 se verifican en vivo con el usuario.
- Depende de ③a (Stock) y ① (supplier/inventory/RLS). Implementar tras mergear ③a.
