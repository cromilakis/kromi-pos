# Mapeo proveedor↔producto + panel compacto — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al proveedor un ID interno correlativo por negocio y a cada producto un código interno único `{seq}-{código proveedor}`, autocompletar giro/dirección del proveedor desde la factura, y mostrar proveedor + líneas de forma compacta.

**Architecture:** Migración que agrega `supplier.seq` y `product.internal_code` y reescribe la RPC `recepcionar_factura` (asignación atómica de correlativo + generación de código). La edge function amplía la extracción del proveedor (giro, dirección). La UI de confirmación pasa a tabla compacta y autocompleta el panel de proveedor.

**Tech Stack:** Postgres/Supabase (SQL, plpgsql SECURITY DEFINER), Deno (edge function), React + TypeScript + Vite, TanStack Query, Tailwind v4, Vitest.

## Global Constraints

- Identidad de commits: autor y committer **solo** `Cromilakis <ipcromilakis@gmail.com>`. PROHIBIDO `Co-Authored-By` y cualquier atribución a Claude/Anthropic.
- `OPENAI_API_KEY` y secretos: nunca en cliente ni en variables `VITE_`; solo como secret de la edge function.
- Escritura de tablas críticas (`supplier`, `product`, `inventory`, `purchase_invoice*`, `supplier_product`) en este flujo **solo** vía la RPC `recepcionar_factura` (SECURITY DEFINER). El cliente no las escribe directamente aquí.
- Nunca `git add -A` (usar rutas explícitas). No tocar `src-tauri/*`.
- Color de marca vía `var(--brand)`. Prosa en español; identificadores en inglés.
- Rama de trabajo: `feature/recepcion-facturas` (no crear rama nueva).
- ID interno del proveedor: correlativo numérico automático por negocio, mostrado con 3 dígitos (`001`).
- Código interno del producto: auto-generado y **fijo**, formato `{seq 3 dígitos}-{código proveedor}` (ej. `001-ABC123`).
- No hay productos existentes: sin backfill.

---

### Task 1: Migración — correlativo de proveedor + código interno de producto + RPC

**Files:**
- Create: `supabase/migrations/20260707140000_supplier_product_codes.sql`
- Modify (test): `supabase/tests/purchases_test.sql`

**Interfaces:**
- Consumes: tablas `supplier`, `product`, `supplier_product`, `purchase_invoice`, `inventory`, `branch`; funciones `public.current_business_id()`, `public.is_kromi()` (de ①); RPC `recepcionar_factura(p_branch uuid, p_supplier jsonb, p_doc jsonb, p_lines jsonb, p_pdf_path text)` definida en `20260707130000_purchases.sql`.
- Produces: columna `supplier.seq int` (correlativo por negocio, único), columna `product.internal_code text` (único por negocio), y RPC `recepcionar_factura` reescrita con la MISMA firma que asigna `seq` y genera `internal_code`.

- [ ] **Step 1: Escribir la migración (columnas + índices + RPC reescrita)**

Crear `supabase/migrations/20260707140000_supplier_product_codes.sql` con exactamente:

```sql
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
  v_idx      int := 0;
  ln         jsonb;
begin
  select business_id into v_business from public.branch where id = p_branch;
  if v_business is null then raise exception 'la sucursal no existe'; end if;
  if auth.uid() is not null and v_business is distinct from public.current_business_id() and not public.is_kromi() then
    raise exception 'no autorizado para operar en este negocio';
  end if;

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
    v_idx := v_idx + 1;
    v_pid := nullif(ln->>'product_id','')::uuid;
    -- Crear producto nuevo si corresponde, con código interno {seq}-{código proveedor}
    if v_pid is null and (ln->'new_product') is not null then
      v_code := lpad(v_seq::text, 3, '0') || '-' || coalesce(nullif(ln->>'supplier_code',''), v_idx::text);
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
```

- [ ] **Step 2: Ampliar el test de BD con las nuevas aserciones (debe fallar antes de aplicar la migración)**

En `supabase/tests/purchases_test.sql`, dentro del PRIMER bloque `do $$ ... end $$;` (el de la recepción con proveedor nuevo), añadir estas aserciones **antes** de su `end $$;` (después de la verificación de costo, línea 34):

```sql
  -- correlativo del proveedor = 1
  if (select seq from public.supplier where rut='78.964.380-6' and business_id='bb000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'seq del proveedor no es 1'; end if;
  -- código interno del producto = 001-00T017
  if (select internal_code from public.product where id=v_pid) <> '001-00T017' then
    raise exception 'internal_code esperado 001-00T017, got %', (select internal_code from public.product where id=v_pid); end if;
```

Luego, **antes** de la línea `\echo 'purchases_test OK'`, añadir un bloque nuevo que verifica el segundo proveedor (seq=2), el enlace del mismo producto desde otro proveedor (internal_code intacto, stock sumado) y el respaldo de código vacío:

```sql
-- Segundo proveedor (seq=2) que trae el MISMO producto (enlazado por product_id)
-- + un producto nuevo con supplier_code vacío (respaldo de código por índice).
do $$
declare v_pid uuid; v_stock int; v_seq int; v_new_code text;
begin
  select product_id into v_pid from public.supplier_product where supplier_code='00T017';
  perform public.recepcionar_factura(
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
  -- producto nuevo con supplier_code vacío usa respaldo por índice: 002-2
  select internal_code into v_new_code from public.product where name='SIN CODIGO';
  if v_new_code <> '002-2' then raise exception 'internal_code de respaldo esperado 002-2, got %', v_new_code; end if;
end $$;
```

- [ ] **Step 3: Correr los tests de BD y verificar que pasan**

Run: `cd /c/Kromi/kromi-pos && pnpm db:reset && pnpm test:db`
Expected: la salida incluye `purchases_test OK` y no hay excepciones (`seq del proveedor no es 1`, `internal_code esperado...`, etc.). Si `pnpm test:db` no aplica migraciones automáticamente, `pnpm db:reset` las aplica primero.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260707140000_supplier_product_codes.sql supabase/tests/purchases_test.sql
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(compras): correlativo de proveedor + código interno de producto en recepcionar_factura"
```

---

### Task 2: Extracción — giro y dirección del proveedor

**Files:**
- Modify: `supabase/functions/extract-invoice/index.ts` (el objeto `schema`, ~líneas 16-35, y el prompt ~línea 78)
- Modify: `src/lib/invoice.ts` (tipo `Extraction` y `normalizeExtraction`)
- Modify (test): `src/lib/invoice.test.ts`

**Interfaces:**
- Consumes: `normalizeExtraction(raw: any): Extraction` de `src/lib/invoice.ts`.
- Produces: `Extraction.proveedor` con campos adicionales `giro: string` y `direccion: string` (siempre presentes tras normalizar, default `""`). El schema de OpenAI extrae `proveedor.giro` y `proveedor.direccion`.

- [ ] **Step 1: Escribir el test de normalización (debe fallar)**

En `src/lib/invoice.test.ts`, añadir dentro del `describe("normalizeExtraction", ...)` existente (o crear uno si no está) este test:

```ts
it("normaliza giro y dirección del proveedor (trim; default vacío)", () => {
  const out = normalizeExtraction({
    proveedor: { razon_social: "Floriterra", rut: "78.964.380-6", giro: "  Vivero  ", direccion: " Camino Real 123 " },
    documento: {}, lineas: [],
  });
  expect(out.proveedor.giro).toBe("Vivero");
  expect(out.proveedor.direccion).toBe("Camino Real 123");

  const out2 = normalizeExtraction({ proveedor: { razon_social: "X", rut: "1-9" }, documento: {}, lineas: [] });
  expect(out2.proveedor.giro).toBe("");
  expect(out2.proveedor.direccion).toBe("");
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd /c/Kromi/kromi-pos && pnpm test -- invoice`
Expected: FAIL (la propiedad `giro`/`direccion` no existe en el tipo o es `undefined`).

- [ ] **Step 3: Extender el tipo y la normalización**

En `src/lib/invoice.ts`, cambiar la interfaz `Extraction` (líneas 2-6) para que `proveedor` incluya los campos nuevos:

```ts
export interface Extraction {
  proveedor: { razon_social: string; rut: string; giro: string; direccion: string };
  documento: { tipo: string; folio: string; fecha: string; neto: number; iva: number; total: number };
  lineas: ExtractedLine[];
}
```

Y en `normalizeExtraction` (líneas 28-41), actualizar el objeto `proveedor`:

```ts
    proveedor: {
      razon_social: String(raw?.proveedor?.razon_social ?? "").trim(),
      rut: String(raw?.proveedor?.rut ?? "").trim(),
      giro: String(raw?.proveedor?.giro ?? "").trim(),
      direccion: String(raw?.proveedor?.direccion ?? "").trim(),
    },
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd /c/Kromi/kromi-pos && pnpm test -- invoice`
Expected: PASS (todos los tests de invoice, incluidos los nuevos).

- [ ] **Step 5: Ampliar el schema de la edge function y el prompt**

En `supabase/functions/extract-invoice/index.ts`, en el objeto `schema` (líneas 16-35), cambiar la definición de `proveedor` para incluir `giro` y `direccion` (structured outputs strict exige listarlos en `required`):

```ts
      proveedor: { type: "object", additionalProperties: false, required: ["razon_social", "rut", "giro", "direccion"],
        properties: { razon_social: { type: "string" }, rut: { type: "string" },
          giro: { type: "string", description: "Giro/actividad económica del proveedor emisor. Vacío si no aparece." },
          direccion: { type: "string", description: "Dirección del proveedor emisor. Vacío si no aparece." } } },
```

Y en el `input_text` del prompt (línea ~78), añadir al final: `El proveedor es el emisor: extrae también su giro y su dirección (déjalos vacíos si no aparecen).`

- [ ] **Step 6: Verificar typecheck del proyecto**

Run: `cd /c/Kromi/kromi-pos && pnpm typecheck`
Expected: sin errores. (La edge function Deno no entra en `tsc` del frontend; su cambio se valida al desplegar en Task 3/verificación en vivo.)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/extract-invoice/index.ts src/lib/invoice.ts src/lib/invoice.test.ts
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(compras): extraer giro y dirección del proveedor desde la factura"
```

---

### Task 3: UI — panel de proveedor compacto (autocompletado) + líneas en tabla compacta

**Files:**
- Modify: `src/data/stock.ts` (`ProductRow` + `select` de `useProductsWithStock`)
- Modify: `src/data/purchases.ts` (nuevo hook `useNextSupplierSeq`; `useSupplierByRut` devuelve `seq`, `giro`, `address`)
- Modify: `src/modules/stock/InvoiceConfirm.tsx` (panel proveedor + tabla de líneas + envío de `address`)

**Interfaces:**
- Consumes: `Extraction.proveedor.{giro,direccion}` (Task 2); columnas `product.internal_code` y `supplier.seq` (Task 1); RPC `recepcionar_factura` (acepta `p_supplier.address`, ya soportado).
- Produces: `ProductRow.internal_code: string | null`; hook `useNextSupplierSeq(businessId?: string)` → `{ data?: number }` (próximo correlativo, informativo); `useSupplierByRut` retorna además `seq`, `giro`, `address`.

- [ ] **Step 1: Exponer `internal_code` en los productos**

En `src/data/stock.ts`:

En la interfaz `ProductRow` (líneas 4-14), añadir tras `supplier_id`:

```ts
  internal_code: string | null;
```

En `useProductsWithStock`, agregar la columna al `select` del `product` (línea 49):

```ts
          .select("id,name,category_id,price,min_stock,critical,img_url,supplier_id,internal_code")
```

`mapProductsWithStock` no requiere cambios (propaga `...p`).

- [ ] **Step 2: Añadir `seq`/`giro`/`address` a `useSupplierByRut` y crear `useNextSupplierSeq`**

En `src/data/purchases.ts`:

Cambiar el `select` de `useSupplierByRut` (línea 19) para traer los campos que la UI mostrará:

```ts
      const { data, error } = await supabase.from("supplier").select("id,razon_social,rut,seq,giro,address").eq("rut", rut!).maybeSingle();
```

Añadir al final del archivo un hook que calcula el próximo correlativo del negocio (solo informativo para el preview del código; la asignación real es atómica en la RPC):

```ts
export function useNextSupplierSeq(businessId: string | undefined) {
  return useQuery({
    queryKey: ["next-supplier-seq", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier")
        .select("seq").eq("business_id", businessId!).order("seq", { ascending: false }).limit(1);
      if (error) throw error;
      return ((data?.[0]?.seq as number | null) ?? 0) + 1;
    },
  });
}
```

- [ ] **Step 3: Panel de proveedor compacto con dirección + envío de `address`**

En `src/modules/stock/InvoiceConfirm.tsx`:

Importar el hook nuevo y usar los campos extraídos. Cambiar la firma del import de `@/data/purchases` (línea 6) a:

```ts
import { useSupplierByRut, useSupplierProductMap, useNextSupplierSeq, recepcionarFactura } from "@/data/purchases";
```

Prellenar `newSupplier` con giro y dirección de la extracción, e incluir `address` (líneas 48-54):

```ts
  const [newSupplier, setNewSupplier] = useState({
    razon_social: extraction.proveedor.razon_social,
    rut: extraction.proveedor.rut,
    giro: extraction.proveedor.giro,
    direccion: extraction.proveedor.direccion,
    email: "",
    phone: "",
  });
```

Obtener el próximo correlativo para el preview del código:

```ts
  const { data: nextSeq } = useNextSupplierSeq(businessId);
  const supplierSeq = existingSupplier?.seq ?? nextSeq; // number | undefined
```

En `handleConfirm`, al armar `p_supplier` del proveedor nuevo (líneas 96-102), incluir `address`:

```ts
      p_supplier = {
        razon_social: newSupplier.razon_social.trim(),
        rut: newSupplier.rut.trim(),
        giro: newSupplier.giro.trim() || null,
        address: newSupplier.direccion.trim() || null,
        email: newSupplier.email.trim() || null,
        phone: newSupplier.phone.trim() || null,
      };
```

Reemplazar el bloque de render del panel de proveedor (líneas 154-199) por una versión compacta. Proveedor existente → fila con ID interno, razón social, RUT, giro, dirección (solo lectura). Proveedor nuevo → grilla compacta de inputs prellenados incluyendo **dirección**:

```tsx
        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[#9aa8bd]">Proveedor</div>
          {loadingSupplier ? (
            <div className="text-[13.5px] text-[#9aa8bd]">Buscando proveedor…</div>
          ) : existingSupplier ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#E1E5EE] bg-[#F7FAF8] px-4 py-2.5 text-[13px]">
              <span className="rounded-full bg-[#0F2A1B] px-2 py-0.5 text-[12px] font-black text-white">
                {existingSupplier.seq != null ? String(existingSupplier.seq).padStart(3, "0") : "—"}
              </span>
              <span className="font-black text-[#0F2A1B]">{existingSupplier.razon_social}</span>
              <span className="text-[#7C95A8]">RUT {existingSupplier.rut || "—"}</span>
              {existingSupplier.giro && <span className="text-[#7C95A8]">· {existingSupplier.giro}</span>}
              {existingSupplier.address && <span className="text-[#7C95A8]">· {existingSupplier.address}</span>}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#F2E2A8] bg-[#FEF6DD] p-3">
              <div className="mb-2 text-[12.5px] font-bold text-[#8A6D12]">
                Proveedor nuevo — se creará como {supplierSeq != null ? String(supplierSeq).padStart(3, "0") : "…"}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={newSupplier.razon_social} onChange={(e) => setNewSupplier((s) => ({ ...s, razon_social: e.target.value }))}
                  placeholder="Razón social" className="col-span-2 rounded-[10px] border border-[#E1E5EE] px-3 py-1.5 text-[13px] outline-none" />
                <input value={newSupplier.rut} onChange={(e) => setNewSupplier((s) => ({ ...s, rut: e.target.value }))}
                  placeholder="RUT" className="rounded-[10px] border border-[#E1E5EE] px-3 py-1.5 text-[13px] outline-none" />
                <input value={newSupplier.giro} onChange={(e) => setNewSupplier((s) => ({ ...s, giro: e.target.value }))}
                  placeholder="Giro" className="rounded-[10px] border border-[#E1E5EE] px-3 py-1.5 text-[13px] outline-none" />
                <input value={newSupplier.direccion} onChange={(e) => setNewSupplier((s) => ({ ...s, direccion: e.target.value }))}
                  placeholder="Dirección" className="col-span-2 rounded-[10px] border border-[#E1E5EE] px-3 py-1.5 text-[13px] outline-none" />
                <input value={newSupplier.email} onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))}
                  placeholder="Email (opcional)" className="rounded-[10px] border border-[#E1E5EE] px-3 py-1.5 text-[13px] outline-none" />
                <input value={newSupplier.phone} onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))}
                  placeholder="Teléfono (opcional)" className="rounded-[10px] border border-[#E1E5EE] px-3 py-1.5 text-[13px] outline-none" />
              </div>
            </div>
          )}
        </div>
```

- [ ] **Step 4: Líneas en tabla compacta**

En `src/modules/stock/InvoiceConfirm.tsx`, reemplazar el bloque de render de líneas (el `<div className="mb-4">` que contiene `Líneas ({lines.length})` y el `.map`, actuales líneas 201-288) por una tabla compacta. La última columna "Producto interno" muestra el código interno del producto vinculado, o los controles de elegir/crear:

```tsx
        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[#9aa8bd]">Líneas ({lines.length})</div>
          <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#F7FAF8] text-left text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">
                  <th className="px-3 py-2 text-right">Cant</th>
                  <th className="px-3 py-2">Cód. prov</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2 text-right">Costo unit</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Producto interno</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const ok = checkLineTotal(l);
                  const linked = l.product_id ? productById.get(l.product_id) : undefined;
                  return (
                    <tr key={idx} className="border-t border-[#EEF1F6]" style={{ background: ok ? undefined : "#FDECEC" }}>
                      <td className="px-3 py-1.5 text-right font-bold text-[#0F2A1B]">{l.qty}</td>
                      <td className="px-3 py-1.5 font-semibold text-[#7C95A8]">{l.supplier_code || "—"}</td>
                      <td className="px-3 py-1.5 font-semibold text-[#0F2A1B]">{l.description || "Sin descripción"}</td>
                      <td className="px-3 py-1.5 text-right" style={{ color: ok ? "#0F2A1B" : "#9a2533" }}>{fmtCLP(l.unit_cost)}</td>
                      <td className="px-3 py-1.5 text-right font-black" style={{ color: ok ? "#0F2A1B" : "#9a2533" }}>{fmtCLP(l.line_total)}</td>
                      <td className="px-3 py-1.5">
                        {l.product_id ? (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#E7EFE8] px-2 py-0.5 text-[12px] font-bold text-[#0F2A1B]">
                              {linked?.internal_code ? `${linked.internal_code} · ` : "→ "}{linked?.name ?? "Producto vinculado"}
                            </span>
                            <button onClick={() => updateLine(idx, { product_id: "" })} className="text-[11px] font-bold text-[#7C95A8] underline">Cambiar</button>
                          </div>
                        ) : l.newProduct ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#EEF1F6] px-1.5 py-0.5 text-[11px] font-bold text-[#7C95A8]">
                              {supplierSeq != null ? String(supplierSeq).padStart(3, "0") : "…"}-{l.supplier_code || (idx + 1)}
                            </span>
                            <input value={l.newName} onChange={(e) => updateLine(idx, { newName: e.target.value })}
                              placeholder="Nombre del producto" className="min-w-[150px] flex-1 rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none" />
                            <select value={l.newCategoryId} onChange={(e) => updateLine(idx, { newCategoryId: e.target.value })}
                              className="rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none">
                              <option value="">Sin categoría</option>
                              {(categories ?? []).map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                            </select>
                            <button onClick={() => updateLine(idx, { newProduct: false })} className="text-[11px] font-bold text-[#7C95A8] underline">Cancelar</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select value="" onChange={(e) => updateLine(idx, { product_id: e.target.value })}
                              className="min-w-[170px] rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none">
                              <option value="" disabled>Elegir producto…</option>
                              {(products ?? []).map((p) => (
                                <option key={p.id} value={p.id}>{p.internal_code ? `${p.internal_code} · ${p.name}` : p.name}</option>
                              ))}
                            </select>
                            <button onClick={() => updateLine(idx, { newProduct: true })}
                              className="rounded-[8px] border border-[#A7E3C0] bg-[#E6F7EE] px-2 py-1 text-[12px] font-bold text-[#0a6e36]">+ Crear</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
```

> El aviso "Cantidad × costo no coincide" por línea se sustituye por el fondo rojo de la fila (`#FDECEC`) más el banner global de descuadre que ya existe bajo la tabla; no se pierde la señal.

- [ ] **Step 5: Verificar typecheck + tests + build**

Run: `cd /c/Kromi/kromi-pos && pnpm typecheck && pnpm test && pnpm build`
Expected: typecheck sin errores; todos los tests verdes; build genera `dist/` sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/data/stock.ts src/data/purchases.ts src/modules/stock/InvoiceConfirm.tsx
git -c user.name="Cromilakis" -c user.email="ipcromilakis@gmail.com" commit --author="Cromilakis <ipcromilakis@gmail.com>" -m "feat(compras): panel de proveedor autocompletado + líneas en tabla compacta con código interno"
```

---

## Verificación en vivo (con el usuario, tras las tareas)

- Desplegar en cloud: `supabase db push` (aplica la migración 140000) y `supabase functions deploy extract-invoice` (nuevo schema de extracción). Recordar la lección: mergear no aplica migraciones a cloud.
- `pnpm tauri dev` → Stock → "Cargar desde factura" → subir Floriterra → confirmar como proveedor nuevo (queda `001`) → productos creados con `001-<código>` → stock sumado. Revisar que giro/dirección se autocompleten.
- Segunda factura de otro proveedor con un producto ya existente → enlazarlo → verificar que el `internal_code` no cambia y el stock suma.

## Notas de decomposición

- Task 1 es autocontenida (BD + su test) y verificable con `pnpm test:db`.
- Task 2 es autocontenida (extracción + su test de lógica) y verificable con `pnpm test`.
- Task 3 depende de los tipos/campos de Task 1 y Task 2 (columna `internal_code`, `seq`, `Extraction.proveedor.giro/direccion`) y es verificable con `pnpm typecheck && pnpm test && pnpm build`.
