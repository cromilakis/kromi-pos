# Subida de imágenes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Las imágenes de producto y el logo del negocio se suben como archivo (no URL), redimensionadas y comprimidas en el cliente a WebP para que queden livianas; el popup de producto se amplía sin scroll.

**Architecture:** Bucket público `media` en Supabase Storage (carpeta = `business_id`). Un helper procesa la imagen en `<canvas>` (redimensiona al lado mayor y exporta WebP) y la sube; un componente `ImageUploader` reutilizable reemplaza los inputs de URL en `ProductForm` (200px) y `BusinessSettings` (logo 400px).

**Tech Stack:** React + Vite + TS, Supabase Storage, Canvas API, Vitest.

## Global Constraints

- Prosa español; código inglés. pnpm. Tests `pnpm test`. Build `pnpm build`.
- Commits: `Cromilakis <ipcromilakis@gmail.com>`; sin co-author ni atribución.
- App usa Supabase **remoto**; migración con `supabase db push`.
- Producto máx **200px**, logo máx **400px** (lado mayor); formato **WebP** ~0.8.

---

### Task 1: Migración del bucket `media`

**Files:** Create `supabase/migrations/20260708130000_media_bucket.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- Migración: bucket público 'media' para imágenes de producto y logo del negocio
-- Lectura pública (getPublicUrl); escritura por negocio (carpeta = business_id).
-- ============================================================================
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do nothing;

create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = public.current_business_id()::text);
create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.current_business_id()::text);
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.current_business_id()::text);
```

- [ ] **Step 2: Aplicar local y remoto**

Run: `npx supabase migration up --local`
Run: `echo "y" | npx supabase db push` → verificar `remote` con `npx supabase migration list --linked`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260708130000_media_bucket.sql
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(media): bucket publico media para imagenes (RLS por negocio)"
```

---

### Task 2: Helpers de imagen y subida

**Files:** Create `src/lib/image.ts`, `src/lib/image.test.ts`

**Interfaces:**
- `scaleDimensions(w: number, h: number, max: number): { w: number; h: number }` — escala al lado mayor `max` sin ampliar.
- `processImage(file: File, max: number): Promise<Blob>` — WebP redimensionado (canvas).
- `uploadProductImage(businessId: string, blob: Blob): Promise<string>` y `uploadLogoImage(businessId: string, blob: Blob): Promise<string>` — suben a `media` y devuelven la URL pública.

- [ ] **Step 1: Test de `scaleDimensions`**

`src/lib/image.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scaleDimensions } from "./image";

describe("scaleDimensions", () => {
  it("escala al lado mayor manteniendo proporción", () => {
    expect(scaleDimensions(4000, 3000, 200)).toEqual({ w: 200, h: 150 });
    expect(scaleDimensions(1000, 2000, 400)).toEqual({ w: 200, h: 400 });
  });
  it("no amplía imágenes más chicas que el máximo", () => {
    expect(scaleDimensions(150, 100, 200)).toEqual({ w: 150, h: 100 });
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm test -- src/lib/image.test.ts` → FAIL.

- [ ] **Step 3: Implementar `src/lib/image.ts`**

```ts
import { supabase } from "@/lib/supabase";

/** Escala (w,h) para que el lado mayor sea `max`, sin ampliar si ya es menor. */
export function scaleDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Redimensiona y comprime una imagen a WebP usando canvas. */
export function processImage(file: File, max: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { w, h } = scaleDimensions(img.naturalWidth, img.naturalHeight, max);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("No se pudo procesar la imagen.")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("No se pudo convertir la imagen."));
        },
        "image/webp",
        0.8,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Archivo de imagen inválido.")); };
    img.src = url;
  });
}

async function uploadTo(path: string, blob: Blob): Promise<string> {
  const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw error;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

export async function uploadProductImage(businessId: string, blob: Blob): Promise<string> {
  return uploadTo(`${businessId}/products/${crypto.randomUUID()}.webp`, blob);
}

export async function uploadLogoImage(businessId: string, blob: Blob): Promise<string> {
  return uploadTo(`${businessId}/logo-${crypto.randomUUID()}.webp`, blob);
}
```

- [ ] **Step 4: Verlo pasar** — `pnpm test -- src/lib/image.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image.ts src/lib/image.test.ts
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(media): helpers de imagen (scaleDimensions, processImage, upload a media)"
```

---

### Task 3: Componente `ImageUploader`

**Files:** Create `src/components/ImageUploader.tsx`

**Interfaces:**
- Props: `value: string | null; onChange: (url: string | null) => void; onUpload: (blob: Blob) => Promise<string>; maxSize: number; label?: string;`
- Procesa con `processImage(file, maxSize)`, sube con `onUpload`, llama `onChange(url)`. Preview + "Quitar".

- [ ] **Step 1: Implementar**

```tsx
import { useRef, useState } from "react";
import { toast } from "sonner";
import { processImage } from "@/lib/image";
import { errMsg } from "@/lib/errors";

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  onUpload: (blob: Blob) => Promise<string>;
  maxSize: number;
  label?: string;
}

export function ImageUploader({ value, onChange, onUpload, maxSize, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("El archivo debe ser una imagen."); return; }
    setBusy(true);
    try {
      const blob = await processImage(file, maxSize);
      const url = await onUpload(blob);
      onChange(url);
    } catch (e) {
      toast.error(`No se pudo subir la imagen: ${errMsg(e)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E1E5EE] bg-[#F6F7FB]">
        {value ? <img src={value} alt={label ?? "imagen"} className="size-full object-cover" /> : <span className="text-[11px] text-[#9aa8bd]">Sin imagen</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-[10px] border border-[#A7E3C0] bg-[#E6F7EE] px-3.5 py-2 text-[13px] font-bold text-[#0a6e36] disabled:opacity-60"
        >
          {busy ? "Subiendo…" : value ? "Cambiar imagen" : "Subir imagen"}
        </button>
        {value && !busy && (
          <button type="button" onClick={() => onChange(null)} className="text-left text-[12px] font-bold text-[#7C95A8] hover:text-[#D02E2E]">
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build** — `pnpm build` → sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/ImageUploader.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(ui): componente ImageUploader (procesa y sube imagenes)"
```

---

### Task 4: `ProductForm` con uploader y modal más amplio

**Files:** Modify `src/modules/stock/ProductForm.tsx`

- [ ] **Step 1: Reemplazar el input de imagen por el uploader**

- Import: `import { ImageUploader } from "@/components/ImageUploader"; import { uploadProductImage } from "@/lib/image";`
- Reemplazar el bloque del `<label>Imagen (URL, opcional)</label>` + input por:

```tsx
          <div>
            <label style={labelStyle}>Imagen del producto (opcional)</label>
            <ImageUploader
              value={imgUrl || null}
              onChange={(url) => setImgUrl(url ?? "")}
              onUpload={(blob) => uploadProductImage(businessId, blob)}
              maxSize={200}
              label="producto"
            />
          </div>
```

- [ ] **Step 2: Ampliar el modal y quitar el scroll**

- En el contenedor del modal, cambiar `width: 440` por `width: 620`.
- En el `div` de campos (`padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflow: "auto"`) quitar `maxHeight` y `overflow` (dejar `overflow: "visible"`), y cambiar a grid de 2 columnas: `display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14`. Los campos que deban ocupar todo el ancho (Nombre, checkbox de crítico, imagen) llevan `style={{ gridColumn: "1 / -1" }}` en su `<div>` contenedor.

- [ ] **Step 3: Verificar build** — `pnpm build`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/stock/ProductForm.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(stock): subir imagen de producto (uploader) y popup mas amplio sin scroll"
```

---

### Task 5: `BusinessSettings` con uploader de logo

**Files:** Modify `src/modules/admin/BusinessSettings.tsx`

- [ ] **Step 1: Reemplazar el campo `logo_url` por el uploader**

- Import: `import { ImageUploader } from "@/components/ImageUploader"; import { uploadLogoImage } from "@/lib/image";`
- Quitar `logo_url` de la lista `FIELDS` (para que no se renderice como input de texto).
- Tras el grid de campos, añadir un bloque con el uploader (usa el estado `form.logo_url` y `businessId`):

```tsx
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-[#5a6b7e]">Logo del negocio</span>
            <ImageUploader
              value={form.logo_url || null}
              onChange={(url) => setForm((s) => ({ ...s, logo_url: url ?? "" }))}
              onUpload={(blob) => uploadLogoImage(businessId!, blob)}
              maxSize={400}
              label="logo"
            />
          </div>
```

- [ ] **Step 2: Verificar build** — `pnpm build`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/BusinessSettings.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" git commit -m "feat(admin): subir logo del negocio como archivo (uploader)"
```

---

## Self-review

- Bucket público + RLS por negocio → Task 1. Procesamiento WebP + límites → Task 2. Uploader reutilizable → Task 3. Producto (200) + modal amplio → Task 4. Logo (400) → Task 5.
- `processImage` usa canvas (no testeable en jsdom); se testea `scaleDimensions` (puro).
