# Código de barras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar productos al carrito de venta escaneando su código de barras: el lector (que actúa como teclado) escribe el código en la búsqueda y, al Enter, se agrega el producto cuyo `barcode` coincide exactamente.

**Architecture:** Nueva columna `barcode` en `product` con índice único por negocio. El formulario de producto la edita; la capa de datos la lee/escribe. En `VentaScreen`, al presionar Enter en el buscador se busca un producto por `barcode` exacto (helper puro testeable) y se agrega al carrito.

**Tech Stack:** React + Vite + TypeScript, Supabase/Postgres, Vitest.

## Global Constraints

- Prosa en español; identificadores/código en inglés.
- Gestor de paquetes: **pnpm**. Tests: `pnpm test`. Build: `pnpm build`.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; sin `Co-Authored-By` ni atribución a Claude.
- **La app usa el Supabase REMOTO** (`immuembrvocwbdpprypk`), no el local. Las migraciones se aplican al remoto con `supabase db push` (previa confirmación del usuario, es base de producción).
- `product` ya tiene RLS y grants; agregar una columna no requiere nuevos grants.

---

### Task 1: Migración de la columna `barcode`

**Files:**
- Create: `supabase/migrations/20260708110000_product_barcode.sql`

**Interfaces:**
- Produces: columna `product.barcode text` + índice único parcial `(business_id, barcode)`.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260708110000_product_barcode.sql`:

```sql
-- ============================================================================
-- Migración: código de barras de productos
-- Contrato: docs/superpowers/specs/2026-07-08-modulo-ventas-full-design.md (sub-proyecto 3)
-- barcode dedicado (distinto de internal_code). Único por negocio cuando no es null.
-- ============================================================================

alter table public.product add column barcode text;

create unique index product_barcode_unique
  on public.product(business_id, barcode)
  where barcode is not null;
```

- [ ] **Step 2: Aplicar al remoto (requiere confirmación del usuario)**

Confirmar el estado del link (read-only):

Run: `npx supabase migration list --linked`
Expected: `20260708110000` aparece con `local` seteado y `remote` vacío.

Aplicar:

Run: `echo "y" | npx supabase db push`
Expected: "Applying migration 20260708110000_product_barcode.sql..." y "Finished". (Un warning de `pg-delta`/certificado es de un paso secundario y no impide la aplicación.)

Verificar:

Run: `npx supabase migration list --linked`
Expected: `"local":"20260708110000","remote":"20260708110000"`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260708110000_product_barcode.sql
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(stock): columna barcode en product (unica por negocio)"
```

---

### Task 2: Capa de datos con `barcode` + helper de búsqueda

**Files:**
- Modify: `src/data/stock.ts`
- Test: `src/data/stock.test.ts`

**Interfaces:**
- Consumes: `ProductRow`.
- Produces:
  - `ProductRow` gana `barcode: string | null`.
  - `useProductsWithStock` selecciona `barcode`.
  - `createProduct`/`updateProduct` aceptan `barcode: string | null`.
  - `findByBarcode(products: ProductRow[], code: string): ProductRow | undefined` — match exacto por `barcode` (trim; cadena vacía → undefined).

- [ ] **Step 1: Escribir el test del helper `findByBarcode`**

Añadir a `src/data/stock.test.ts` (crear el bloque; el archivo ya existe):

```ts
import { describe, expect, it } from "vitest";
import { findByBarcode, type ProductRow } from "./stock";

function p(id: string, barcode: string | null): ProductRow {
  return { id, name: id, category_id: null, price: 0, min_stock: 0, critical: false, img_url: null, supplier_id: null, internal_code: null, barcode, stock: 0 };
}

describe("findByBarcode", () => {
  const products = [p("a", "7801234500001"), p("b", null), p("c", "0099")];

  it("encuentra el producto por barcode exacto (con trim)", () => {
    expect(findByBarcode(products, "7801234500001")?.id).toBe("a");
    expect(findByBarcode(products, "  0099 ")?.id).toBe("c");
  });

  it("devuelve undefined si no hay match o el código es vacío", () => {
    expect(findByBarcode(products, "9999")).toBeUndefined();
    expect(findByBarcode(products, "")).toBeUndefined();
    expect(findByBarcode(products, "   ")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `pnpm test -- src/data/stock.test.ts`
Expected: FAIL (`findByBarcode` no existe / `barcode` no está en `ProductRow`).

- [ ] **Step 3: Implementar los cambios en `src/data/stock.ts`**

En la interfaz `ProductRow`, añadir el campo tras `internal_code`:

```ts
  internal_code: string | null;
  barcode: string | null;
  stock: number;
```

En `useProductsWithStock`, agregar `barcode` al `select`:

```ts
        .select("id,name,category_id,price,min_stock,critical,img_url,supplier_id,internal_code,barcode")
```

En `createProduct`, añadir `barcode` al tipo del input y (por el spread `input`) se inserta solo:

```ts
export async function createProduct(input: {
  business_id: string;
  name: string;
  category_id: string | null;
  price: number;
  min_stock: number;
  critical: boolean;
  img_url: string | null;
  supplier_id: string | null;
  barcode: string | null;
}) {
```

En `updateProduct`, añadir `barcode` al tipo del `Partial`:

```ts
  input: Partial<{
    name: string;
    category_id: string | null;
    price: number;
    min_stock: number;
    critical: boolean;
    img_url: string | null;
    supplier_id: string | null;
    barcode: string | null;
  }>,
```

Añadir el helper puro (al final del archivo o junto a `mapProductsWithStock`):

```ts
/** Busca un producto por código de barras exacto (ignora espacios). Cadena vacía → undefined. */
export function findByBarcode(products: ProductRow[], code: string): ProductRow | undefined {
  const c = code.trim();
  if (!c) return undefined;
  return products.find((p) => p.barcode === c);
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `pnpm test -- src/data/stock.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar tipos**

Run: `pnpm build`
Expected: `tsc -b` falla en `ProductForm.tsx` (createProduct ahora exige `barcode`). Se resuelve en Task 3. Confirmar que ése es el único error.

- [ ] **Step 6: Commit**

```bash
git add src/data/stock.ts src/data/stock.test.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(stock): barcode en la capa de datos + findByBarcode"
```

---

### Task 3: Campo `barcode` en el formulario de producto

**Files:**
- Modify: `src/modules/stock/ProductForm.tsx`

**Interfaces:**
- Consumes: `createProduct`/`updateProduct` con `barcode` (Task 2).
- Produces: el formulario edita `barcode`.

- [ ] **Step 1: Estado del campo**

Añadir junto a los otros `useState`:

```tsx
  const [barcode, setBarcode] = useState("");
```

En el `useEffect`, en la rama `if (product)` añadir `setBarcode(product.barcode ?? "");` y en la rama `else` añadir `setBarcode("");`.

- [ ] **Step 2: Incluir `barcode` en createProduct y updateProduct**

En ambas llamadas (`createProduct({...})` y `updateProduct(product.id, {...})`), añadir la propiedad:

```tsx
        barcode: barcode.trim() || null,
```

- [ ] **Step 3: Input en el formulario**

Añadir un campo tras el de "Imagen (URL, opcional)" (dentro del contenedor scrolleable):

```tsx
          <div>
            <label style={labelStyle}>Código de barras (opcional)</label>
            <input style={inputStyle} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Escanea o escribe el código" />
          </div>
```

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: `tsc -b` sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock/ProductForm.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(stock): campo codigo de barras en el formulario de producto"
```

---

### Task 4: Escaneo por Enter en la búsqueda de venta

**Files:**
- Modify: `src/modules/venta/VentaScreen.tsx`

**Interfaces:**
- Consumes: `findByBarcode` (Task 2); `addToCart`, `query`, `setQuery`, `allProducts` (ya existen en `VentaScreen`).
- Produces: al Enter en el buscador, si el texto coincide con un `barcode`, se agrega ese producto y se limpia la búsqueda.

- [ ] **Step 1: Importar el helper**

En el import de `@/data/stock` de `VentaScreen`, añadir `findByBarcode`:

```tsx
import { useProductsWithStock, useCategories, findByBarcode } from "@/data/stock";
```

(El import exacto puede variar; añadir `findByBarcode` a la lista de nombres importados desde `@/data/stock`.)

- [ ] **Step 2: Handler de escaneo**

Añadir dentro de `VentaScreen()` (junto a `addToCart`):

```tsx
function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  const match = findByBarcode(allProducts, query);
  if (match) {
    addToCart(match);
    setQuery("");
  }
}
```

- [ ] **Step 3: Conectar el handler al input de búsqueda**

En el `<input>` del buscador de productos de venta, añadir `onKeyDown={handleSearchKeyDown}`:

```tsx
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar planta, maceta, accesorio…"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#0F2A1B] outline-none"
              />
```

- [ ] **Step 4: Verificar build y tests**

Run: `pnpm build && pnpm test`
Expected: `tsc -b` sin errores; todos los tests pasan.

- [ ] **Step 5: Verificación manual**

Run: `pnpm dev`.
- En **Stock**, editar un producto y ponerle un código de barras; guardar.
- En **Venta**, escribir/escanear ese código en el buscador y presionar Enter: el producto se agrega al carrito y la búsqueda se limpia.
- Un código inexistente + Enter no rompe nada (la búsqueda por nombre sigue funcionando al escribir).

Expected: escaneo agrega el producto correcto.

- [ ] **Step 6: Commit**

```bash
git add src/modules/venta/VentaScreen.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "feat(venta): agregar al carrito escaneando codigo de barras (Enter en la busqueda)"
```

---

## Self-review (cobertura del spec)

- Columna `barcode` dedicada + índice único → Task 1.
- `barcode` en capa de datos y formulario de producto → Tasks 2-3.
- Escaneo (lector como teclado) que agrega por barcode al Enter, sin atajos globales → Task 4.
- Migración aplicada al remoto (entorno real de la app) → Task 1 Step 2.
