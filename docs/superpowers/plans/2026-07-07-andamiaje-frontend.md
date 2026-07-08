# Andamiaje del frontend (Tauri + Vite + React) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir la base del frontend de kromi-pos en Tauri + Vite + React + TypeScript, con login RUT+PIN real contra Supabase, sistema de diseño (Tailwind v4 + shadcn/ui, acento configurable), shell con navegación por rol y gate de sucursal+caja, dejando placeholders para los módulos (que se implementan en ③).

**Architecture:** SPA React servida por el shell Tauri existente. Datos vía supabase-js (publishable key) + TanStack Query; escrituras simples por PostgREST (RLS) y operaciones críticas por RPC. Estado de sesión/negocio/sucursal/caja en contextos React. UI con shadcn/ui sobre Tailwind v4, acento inyectado en runtime desde `business.accent`. El prototipo actual se archiva como referencia.

**Tech Stack:** Tauri 2, Vite 6, React 18.3, TypeScript 5, React Router 6, TanStack Query 5, @supabase/supabase-js 2, Tailwind CSS v4, shadcn/ui (new-york, radix), Vitest + Testing Library.

## Global Constraints

- Prosa en español; identificadores/código/rutas en inglés.
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; PROHIBIDO `Co-Authored-By` o atribución a Claude/Anthropic.
- `git add` de archivos específicos por tarea; nunca `git add -A`/`git add .`.
- **Cambios pre-existentes sin commitear** en `src-tauri/src/printing.rs` (NO tocar) y `src-tauri/tauri.conf.json` (se edita en Task 1; preservar los cambios previos del usuario allí — revisar el diff antes de commitear).
- La **publishable key** (`sb_publishable_...`) es pública → va en `.env` commiteable. La **secret key nunca** llega al cliente.
- White-label: base neutral, acento dinámico desde `business.accent` (CSS var `--accent`).
- Regla de spacing Tailwind v4: usar solo tokens de spacing definidos en `@theme` o valores arbitrarios `[Npx]`.
- Auth: RUT normalizado (sin puntos/guion, minúscula) → email sintético `{rut}@pos.kromi.local`; PIN = password. Paridad con `public.norm_rut` de ①.
- Fuente **Satoshi vendoreada** local (woff2); sin `@import`/CDN de red (Tauri offline).
- Idioma de UI: español.

## File Structure

- `prototype/` — el prototipo actual movido aquí (referencia; no se modifica).
- `index.html` — entry de Vite (raíz).
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `components.json` — config.
- `.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (commiteable).
- `src/main.tsx` — bootstrap React (providers: QueryClient, Auth, Router).
- `src/App.tsx` — árbol de rutas.
- `src/index.css` — Tailwind v4 + `@theme` (tokens) + Satoshi @font-face.
- `src/lib/utils.ts` — `cn()` (shadcn).
- `src/lib/supabase.ts` — cliente supabase-js.
- `src/lib/rut.ts` — `normRut`, `rutToEmail`.
- `src/lib/errors.ts` — mapeo de errores auth/datos a español.
- `src/theme/accent.ts` — `applyAccent(hex)` (inyecta `--accent`).
- `src/auth/AuthProvider.tsx` — contexto de sesión + `useAuth`.
- `src/auth/LoginScreen.tsx` — pantalla de login RUT+PIN.
- `src/session/WorkContext.tsx` — contexto negocio/sucursal/caja + `useWork`.
- `src/session/nav.ts` — `navForRole(role)` (navegación por rol).
- `src/session/BranchGate.tsx`, `src/session/CashGate.tsx` — selección de sucursal / abrir-cerrar caja.
- `src/shell/AppLayout.tsx` — sidebar + topbar + `<Outlet/>`.
- `src/shell/RequireAuth.tsx`, `src/shell/RequireRole.tsx` — guardas de ruta.
- `src/routes/placeholders.tsx` — pantallas placeholder de módulos.
- `src/components/ui/*` — componentes shadcn (generados por CLI).
- `src/data/queries.ts` — hooks TanStack Query de ② (perfil, business, branches, caja).
- Tests junto al código: `src/lib/rut.test.ts`, `src/session/nav.test.ts`, `src/auth/session.test.ts`, `src/theme/accent.test.ts`.

**Comando de verificación transversal:** `pnpm typecheck` (= `tsc --noEmit`), `pnpm test` (Vitest), `pnpm build` (Vite), `pnpm tauri dev` (app real).

---

### Task 1: Scaffold Vite+React+TS, integrar con Tauri, archivar prototipo

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`
- Move: `src/index.html`, `src/support.js`, `src/vendor/`, `src/uploads/` → `prototype/`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: proyecto Vite que renderiza en `http://localhost:5173`; Tauri lo carga en dev y build.

- [ ] **Step 1: Archivar el prototipo**

```bash
cd /c/Kromi/kromi-pos
mkdir -p prototype
git mv src/index.html src/support.js prototype/
git mv src/vendor prototype/vendor
git mv src/uploads prototype/uploads
```
(Si `git mv` falla porque algún archivo no está trackeado, usar `mv` normal para esos.)

- [ ] **Step 2: Crear package.json**

Reemplazar `package.json` por (preservando el nombre si existe):
```json
{
  "name": "kromi-pos",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "tauri": "tauri"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@tanstack/react-query": "^5.51.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.1.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Config de Vite, TS y entry**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], globals: true },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext",
    "skipLibCheck": true, "moduleResolution": "bundler",
    "allowImportingTsExtensions": true, "resolveJsonModule": true,
    "isolatedModules": true, "noEmit": true, "jsx": "react-jsx",
    "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".", "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true, "skipLibCheck": true, "module": "ESNext",
    "moduleResolution": "bundler", "allowSyntheticDefaultImports": true, "strict": true
  },
  "include": ["vite.config.ts"]
}
```

`index.html` (raíz):
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kromi POS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
```

`src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 4: CSS base con Tailwind v4 y App mínima**

`src/index.css`:
```css
@import "tailwindcss";
:root { --accent: #1e9e54; }
html, body, #root { height: 100%; margin: 0; }
```

`src/App.tsx`:
```tsx
export default function App() {
  return <div className="p-6 text-lg">Kromi POS — andamiaje</div>;
}
```

`src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 5: Apuntar Tauri al frontend Vite**

En `src-tauri/tauri.conf.json`, reemplazar el objeto `build` por (⚠️ revisar antes el diff: este archivo tiene cambios previos del usuario en otras claves — preservarlos):
```json
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
```

- [ ] **Step 6: Instalar y verificar**

```bash
cd /c/Kromi/kromi-pos && pnpm install
pnpm build
```
Expected: `pnpm install` sin errores; `pnpm build` genera `dist/` sin errores de TS.

Verificación del dev server:
```bash
pnpm dev &  # levanta en :5173
sleep 3 && curl -s http://localhost:5173 | grep -q 'id="root"' && echo "DEV OK"
kill %1
```
Expected: `DEV OK`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts tsconfig.json tsconfig.node.json index.html src/ prototype/ src-tauri/tauri.conf.json
git commit -m "feat(ui): scaffold Vite+React+TS en Tauri; archivar prototipo en prototype/" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 2: Utilidad RUT (TDD)

**Files:**
- Create: `src/lib/rut.ts`, `src/lib/rut.test.ts`

**Interfaces:**
- Produces: `normRut(rut: string): string`; `rutToEmail(rut: string): string` (→ `{normRut}@pos.kromi.local`).

- [ ] **Step 1: Test que falla**

`src/lib/rut.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normRut, rutToEmail } from "./rut";

describe("normRut", () => {
  it("quita puntos y guion y pasa a minúscula", () => {
    expect(normRut("11.111.111-1")).toBe("111111111");
    expect(normRut("19.608.320-0")).toBe("196083200");
    expect(normRut("12.345.678-K")).toBe("12345678k");
  });
  it("tolera espacios", () => {
    expect(normRut(" 11.111.111-1 ")).toBe("111111111");
  });
});

describe("rutToEmail", () => {
  it("construye el email sintético", () => {
    expect(rutToEmail("19.608.320-0")).toBe("196083200@pos.kromi.local");
  });
});
```

- [ ] **Step 2: Correr el test (falla)**

Run: `pnpm test src/lib/rut.test.ts`
Expected: FALLA (módulo `./rut` no existe).

- [ ] **Step 3: Implementar**

`src/lib/rut.ts`:
```ts
/** Normaliza un RUT: sin puntos ni guion, minúscula. Paridad con public.norm_rut. */
export function normRut(rut: string): string {
  return (rut ?? "").trim().replace(/[.\-]/g, "").toLowerCase();
}

/** Email sintético interno usado como credencial en Supabase Auth. */
export function rutToEmail(rut: string): string {
  return `${normRut(rut)}@pos.kromi.local`;
}
```

- [ ] **Step 4: Correr el test (pasa)**

Run: `pnpm test src/lib/rut.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rut.ts src/lib/rut.test.ts
git commit -m "feat(ui): normalización de RUT y email sintético (TDD)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 3: Cliente Supabase + env + mapeo de errores

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/errors.ts`, `.env`, `.env.example`

**Interfaces:**
- Consumes: `import.meta.env.VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Produces: `supabase` (SupabaseClient); `authErrorEs(error): string`.

- [ ] **Step 1: Definir env**

`.env` (la publishable es pública; obtenerla del dashboard → Settings → API Keys → Publishable):
```
VITE_SUPABASE_URL=https://immuembrvocwbdpprypk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```
`.env.example`:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```
> Nota de ejecución: el valor real de la publishable key lo provee el usuario (no es secreto, pero hay que copiarlo del dashboard). Si aún no está, dejar el placeholder y pedírselo antes de la verificación de login (Task 5).

- [ ] **Step 2: Cliente Supabase**

`src/lib/supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY");

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

- [ ] **Step 3: Mapeo de errores a español**

`src/lib/errors.ts`:
```ts
/** Traduce errores comunes de Supabase Auth a mensajes accionables en español. */
export function authErrorEs(error: { message?: string } | null | undefined): string {
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "RUT o PIN incorrecto.";
  if (m.includes("email not confirmed")) return "La cuenta no está confirmada.";
  if (m.includes("network") || m.includes("failed to fetch")) return "Sin conexión con el servidor.";
  return "No se pudo iniciar sesión. Intenta nuevamente.";
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/lib/errors.ts .env .env.example
git commit -m "feat(ui): cliente Supabase (publishable key) y mapeo de errores auth" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 4: Sistema de diseño — tokens, Satoshi, acento dinámico, shadcn base

**Files:**
- Create: `src/theme/accent.ts`, `src/theme/accent.test.ts`, `public/fonts/` (woff2 Satoshi), `src/lib/utils.ts` (por shadcn)
- Modify: `src/index.css` (tokens `@theme`, @font-face), `components.json` (por shadcn init)
- Add (CLI): componentes shadcn

**Interfaces:**
- Produces: `applyAccent(hex: string): void`; componentes en `src/components/ui/*`; `cn()` en `src/lib/utils.ts`.

- [ ] **Step 1: Inicializar shadcn (non-interactive) y agregar componentes**

```bash
cd /c/Kromi/kromi-pos
npx shadcn@latest init -d --base radix
npx shadcn@latest add button input label card dialog alert-dialog select sheet dropdown-menu sonner skeleton badge separator
```
Expected: crea `components.json`, `src/lib/utils.ts`, y `src/components/ui/*`. Instala radix-ui, cva, clsx, tailwind-merge, lucide-react.

> Gotcha Tailwind v4: si `shadcn init` introduce `--font-sans: var(--font-sans)` (auto-referencia) en `@theme inline`, reemplazar por nombres literales (Step 3).

- [ ] **Step 2: Vendorear la fuente Satoshi**

Colocar los `.woff2` de Satoshi (pesos 400/500/700/900) en `public/fonts/`. Si no están disponibles localmente, es un **bloqueo de assets**: pedir los archivos al usuario (o usar `system-ui` como fallback temporal y anotarlo). No usar `@import` de red.

- [ ] **Step 3: Tokens `@theme` + @font-face + acento**

En `src/index.css`, tras `@import "tailwindcss";` y lo que agregó shadcn, asegurar (o ajustar) los @font-face y el mapeo del acento:
```css
@font-face { font-family: "Satoshi"; src: url("/fonts/Satoshi-Variable.woff2") format("woff2"); font-weight: 300 900; font-display: swap; }

:root { --accent: #1e9e54; }

@theme inline {
  --font-sans: "Satoshi", ui-sans-serif, system-ui, sans-serif;
  --color-primary: var(--accent);
}
```
> `--color-primary` mapeado al acento hace que los componentes shadcn primarios usen el color del negocio. El `var(--accent)` en `:root` sí se resuelve en runtime porque `--color-primary` lo referencia (no es auto-referencia).

- [ ] **Step 4: Test de `applyAccent` (TDD)**

`src/theme/accent.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyAccent } from "./accent";

describe("applyAccent", () => {
  beforeEach(() => document.documentElement.removeAttribute("style"));
  it("setea --accent en :root", () => {
    applyAccent("#123456");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#123456");
  });
  it("ignora valores vacíos (mantiene el actual)", () => {
    applyAccent("#abcdef");
    applyAccent("");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#abcdef");
  });
});
```
Run: `pnpm test src/theme/accent.test.ts` → FALLA (no existe).

- [ ] **Step 5: Implementar `applyAccent`**

`src/theme/accent.ts`:
```ts
/** Inyecta el color de acento del negocio como CSS var --accent en :root. */
export function applyAccent(hex: string | null | undefined): void {
  if (!hex) return;
  document.documentElement.style.setProperty("--accent", hex);
}
```
Run: `pnpm test src/theme/accent.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add components.json src/index.css src/lib/utils.ts src/components/ui src/theme public/fonts package.json pnpm-lock.yaml
git commit -m "feat(ui): sistema de diseño (Tailwind v4 tokens, Satoshi, shadcn, acento dinámico)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 5: AuthProvider + LoginScreen + carga de perfil

**Files:**
- Create: `src/auth/AuthProvider.tsx`, `src/auth/session.ts`, `src/auth/session.test.ts`, `src/auth/LoginScreen.tsx`, `src/data/queries.ts`
- Modify: `src/main.tsx` (envolver con QueryClientProvider + AuthProvider)

**Interfaces:**
- Consumes: `supabase`, `rutToEmail`, `authErrorEs`, `applyAccent`.
- Produces: `useAuth(): { session, profile, business, loading, signIn(rut,pin), signOut() }`; tipo `Profile = { id, business_id, name, role: 'admin'|'cajero'|'kromi', active }`; `mapProfileRow(row): Profile`; `useProfile()`, `useBusiness()` (TanStack Query).

- [ ] **Step 1: Test del mapeo de perfil (TDD)**

`src/auth/session.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapProfileRow } from "./session";

describe("mapProfileRow", () => {
  it("mapea la fila de app_user a Profile", () => {
    const p = mapProfileRow({ id: "u1", business_id: "b1", name: "Matias", role: "admin", active: true });
    expect(p).toEqual({ id: "u1", business_id: "b1", name: "Matias", role: "admin", active: true });
  });
  it("lanza si el usuario está inactivo", () => {
    expect(() => mapProfileRow({ id: "u1", business_id: "b1", name: "X", role: "cajero", active: false }))
      .toThrow(/inactiv/i);
  });
  it("lanza si no hay fila", () => {
    expect(() => mapProfileRow(null)).toThrow(/perfil/i);
  });
});
```
Run: `pnpm test src/auth/session.test.ts` → FALLA.

- [ ] **Step 2: Implementar tipos y mapeo**

`src/auth/session.ts`:
```ts
export type Role = "admin" | "cajero" | "kromi";
export interface Profile { id: string; business_id: string; name: string; role: Role; active: boolean; }
export interface Business { id: string; name: string; accent: string | null; logo_url: string | null; }

export function mapProfileRow(row: any): Profile {
  if (!row) throw new Error("No se encontró el perfil del usuario.");
  if (row.active === false) throw new Error("El usuario está inactivo.");
  return {
    id: row.id, business_id: row.business_id, name: row.name,
    role: row.role as Role, active: !!row.active,
  };
}
```

- [ ] **Step 3: Test pasa**

Run: `pnpm test src/auth/session.test.ts` → PASS.

- [ ] **Step 4: Hooks de datos (perfil y negocio)**

`src/data/queries.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { mapProfileRow, type Business } from "@/auth/session";

export function useProfileQuery(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user").select("id,business_id,name,role,active").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return mapProfileRow(data);
    },
  });
}

export function useBusinessQuery(businessId: string | undefined) {
  return useQuery({
    queryKey: ["business", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<Business> => {
      const { data, error } = await supabase
        .from("business").select("id,name,accent,logo_url").eq("id", businessId!).single();
      if (error) throw error;
      return data as Business;
    },
  });
}
```

- [ ] **Step 5: AuthProvider**

`src/auth/AuthProvider.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { rutToEmail } from "@/lib/rut";
import { authErrorEs } from "@/lib/errors";

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  signIn: (rut: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(rut: string, pin: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: rutToEmail(rut), password: pin });
    if (error) throw new Error(authErrorEs(error));
  }
  async function signOut() { await supabase.auth.signOut(); }

  return <Ctx.Provider value={{ session, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}
```

- [ ] **Step 6: LoginScreen (RUT + PIN)**

`src/auth/LoginScreen.tsx`:
```tsx
import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [rut, setRut] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await signIn(rut, pin); }
    catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-full grid place-items-center bg-[#F6F7FB] p-6">
      <Card className="w-full max-w-sm p-6 space-y-4">
        <h1 className="text-xl font-bold">Kromi POS</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="rut">RUT</Label>
            <Input id="rut" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="11.111.111-1" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pin">PIN</Label>
            <Input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••••" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Envolver providers en main.tsx**

`src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 8: Verificar typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; tests verdes.

- [ ] **Step 9: Commit**

```bash
git add src/auth src/data src/main.tsx
git commit -m "feat(ui): auth RUT+PIN contra Supabase, perfil y providers" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 6: Navegación por rol + guardas + shell + placeholders

**Files:**
- Create: `src/session/nav.ts`, `src/session/nav.test.ts`, `src/shell/RequireAuth.tsx`, `src/shell/RequireRole.tsx`, `src/shell/AppLayout.tsx`, `src/routes/placeholders.tsx`
- Modify: `src/App.tsx` (rutas)

**Interfaces:**
- Consumes: `useAuth`, `useProfileQuery`, `useBusinessQuery`, `applyAccent`, `Role`.
- Produces: `navForRole(role): NavItem[]` con `NavItem = { to: string; label: string }`; `AppLayout`; guardas `RequireAuth`, `RequireRole`.

- [ ] **Step 1: Test de navegación por rol (TDD)**

`src/session/nav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { navForRole } from "./nav";

describe("navForRole", () => {
  it("cajero: módulos base, sin Administración", () => {
    const labels = navForRole("cajero").map((n) => n.label);
    expect(labels).toEqual(["Inicio", "Venta", "Stock", "Clientes", "Cierre"]);
  });
  it("admin: incluye Administración", () => {
    const labels = navForRole("admin").map((n) => n.label);
    expect(labels).toContain("Administración");
  });
  it("kromi: incluye Administración (super-admin)", () => {
    expect(navForRole("kromi").map((n) => n.label)).toContain("Administración");
  });
});
```
Run: `pnpm test src/session/nav.test.ts` → FALLA.

- [ ] **Step 2: Implementar navForRole**

`src/session/nav.ts`:
```ts
import type { Role } from "@/auth/session";
export interface NavItem { to: string; label: string; }

const BASE: NavItem[] = [
  { to: "/", label: "Inicio" },
  { to: "/venta", label: "Venta" },
  { to: "/stock", label: "Stock" },
  { to: "/clientes", label: "Clientes" },
  { to: "/cierre", label: "Cierre" },
];
const ADMIN: NavItem = { to: "/admin", label: "Administración" };

export function navForRole(role: Role): NavItem[] {
  return role === "admin" || role === "kromi" ? [...BASE, ADMIN] : BASE;
}
```
Run: `pnpm test src/session/nav.test.ts` → PASS.

- [ ] **Step 3: Guardas de ruta**

`src/shell/RequireAuth.tsx`:
```tsx
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { LoginScreen } from "@/auth/LoginScreen";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="min-h-full grid place-items-center">Cargando…</div>;
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}
```

`src/shell/RequireRole.tsx`:
```tsx
import type { ReactNode } from "react";
import type { Role } from "@/auth/session";

export function RequireRole({ role, allow, children }: { role: Role | undefined; allow: Role[]; children: ReactNode }) {
  if (!role || !allow.includes(role)) {
    return <div className="p-6 text-muted-foreground">No tienes acceso a esta sección.</div>;
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Placeholders de módulos**

`src/routes/placeholders.tsx`:
```tsx
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2">Módulo en construcción (sub-proyecto ③).</p>
    </div>
  );
}
```

- [ ] **Step 5: AppLayout (sidebar por rol + acento del negocio)**

`src/shell/AppLayout.tsx`:
```tsx
import { NavLink, Outlet } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useProfileQuery, useBusinessQuery } from "@/data/queries";
import { navForRole } from "@/session/nav";
import { applyAccent } from "@/theme/accent";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const { session, signOut } = useAuth();
  const { data: profile } = useProfileQuery(session?.user.id);
  const { data: business } = useBusinessQuery(profile?.business_id);

  useEffect(() => { applyAccent(business?.accent); }, [business?.accent]);

  if (!profile) return <div className="min-h-full grid place-items-center">Cargando perfil…</div>;

  return (
    <div className="min-h-full flex">
      <aside className="w-56 border-r p-4 flex flex-col gap-1">
        <div className="font-bold mb-4">{business?.name ?? "Kromi POS"}</div>
        {navForRole(profile.role).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => `px-3 py-2 rounded-md text-sm ${isActive ? "bg-[var(--accent)] text-white" : "hover:bg-muted"}`}>
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto pt-4 text-sm text-muted-foreground">
          <div>{profile.name}</div>
          <Button variant="ghost" size="sm" onClick={signOut} className="mt-1 px-0">Salir</Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 6: Rutas en App.tsx**

`src/App.tsx`:
```tsx
import { Routes, Route } from "react-router-dom";
import { RequireAuth } from "@/shell/RequireAuth";
import { AppLayout } from "@/shell/AppLayout";
import { Placeholder } from "@/routes/placeholders";

export default function App() {
  return (
    <Routes>
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Placeholder title="Inicio" />} />
        <Route path="venta" element={<Placeholder title="Venta" />} />
        <Route path="stock" element={<Placeholder title="Stock" />} />
        <Route path="clientes" element={<Placeholder title="Clientes" />} />
        <Route path="cierre" element={<Placeholder title="Cierre" />} />
        <Route path="admin" element={<Placeholder title="Administración" />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 7: Verificar**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: sin errores; tests verdes; build OK.

- [ ] **Step 8: Commit**

```bash
git add src/session/nav.ts src/session/nav.test.ts src/shell src/routes src/App.tsx
git commit -m "feat(ui): shell con navegación por rol, guardas y placeholders" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 7: Gate de sucursal + caja (abrir/cerrar vía RPC)

**Files:**
- Create: `src/session/WorkContext.tsx`, `src/session/BranchGate.tsx`, `src/session/CashGate.tsx`, `src/data/work.ts`
- Modify: `src/shell/AppLayout.tsx` (envolver el `<Outlet/>` con los gates + mostrar sucursal/caja en topbar)

**Interfaces:**
- Consumes: `supabase`, `useProfileQuery`.
- Produces: `WorkProvider`, `useWork(): { branch, setBranch, session, openCash, closeCash }`; hooks `useBranches(businessId)`, `useOpenSession(registerId)`.

- [ ] **Step 1: Hooks de sucursales y sesión de caja**

`src/data/work.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Branch { id: string; name: string; }
export interface Register { id: string; name: string; branch_id: string; }
export interface CashSession { id: string; register_id: string; status: string; }

export function useBranches(businessId: string | undefined) {
  return useQuery({
    queryKey: ["branches", businessId], enabled: !!businessId,
    queryFn: async (): Promise<Branch[]> => {
      const { data, error } = await supabase.from("branch").select("id,name").eq("business_id", businessId!).eq("active", true).order("name");
      if (error) throw error; return data ?? [];
    },
  });
}

export function useRegisters(branchId: string | undefined) {
  return useQuery({
    queryKey: ["registers", branchId], enabled: !!branchId,
    queryFn: async (): Promise<Register[]> => {
      const { data, error } = await supabase.from("register").select("id,name,branch_id").eq("branch_id", branchId!).eq("active", true).order("name");
      if (error) throw error; return data ?? [];
    },
  });
}

export function useOpenSession(registerId: string | undefined) {
  return useQuery({
    queryKey: ["open-session", registerId], enabled: !!registerId,
    queryFn: async (): Promise<CashSession | null> => {
      const { data, error } = await supabase.from("cash_session").select("id,register_id,status").eq("register_id", registerId!).eq("status", "open").maybeSingle();
      if (error) throw error; return data ?? null;
    },
  });
}

export async function rpcAbrirCaja(registerId: string, floatAmount: number) {
  const { data, error } = await supabase.rpc("abrir_caja", { p_register: registerId, p_float: floatAmount });
  if (error) throw error; return data;
}
export async function rpcCerrarCaja(sessionId: string, counted: number) {
  const { data, error } = await supabase.rpc("cerrar_caja", { p_session: sessionId, p_counted: counted });
  if (error) throw error; return data;
}
```

- [ ] **Step 2: WorkContext (sucursal + caja activas)**

`src/session/WorkContext.tsx`:
```tsx
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Branch, Register } from "@/data/work";

interface WorkCtx {
  branch: Branch | null; setBranch: (b: Branch | null) => void;
  register: Register | null; setRegister: (r: Register | null) => void;
}
const Ctx = createContext<WorkCtx | null>(null);

export function WorkProvider({ children }: { children: ReactNode }) {
  const [branch, setBranch] = useState<Branch | null>(null);
  const [register, setRegister] = useState<Register | null>(null);
  return <Ctx.Provider value={{ branch, setBranch, register, setRegister }}>{children}</Ctx.Provider>;
}
export function useWork() {
  const c = useContext(Ctx); if (!c) throw new Error("useWork fuera de WorkProvider"); return c;
}
```

- [ ] **Step 3: BranchGate (elegir sucursal; auto si es una)**

`src/session/BranchGate.tsx`:
```tsx
import { useEffect, type ReactNode } from "react";
import { useBranches } from "@/data/work";
import { useWork } from "./WorkContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function BranchGate({ businessId, children }: { businessId: string; children: ReactNode }) {
  const { data: branches } = useBranches(businessId);
  const { branch, setBranch } = useWork();

  useEffect(() => {
    if (!branch && branches && branches.length === 1) setBranch(branches[0]);
  }, [branch, branches, setBranch]);

  if (branch) return <>{children}</>;
  if (!branches) return <div className="min-h-full grid place-items-center">Cargando sucursales…</div>;

  return (
    <div className="min-h-full grid place-items-center p-6">
      <Card className="p-6 space-y-3 w-full max-w-sm">
        <h2 className="font-semibold">Elige una sucursal</h2>
        {branches.map((b) => <Button key={b.id} variant="outline" className="w-full justify-start" onClick={() => setBranch(b)}>{b.name}</Button>)}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: CashGate (abrir caja si no hay sesión abierta)**

`src/session/CashGate.tsx`:
```tsx
import { useState, useEffect, type ReactNode } from "react";
import { useRegisters, useOpenSession, rpcAbrirCaja } from "@/data/work";
import { useWork } from "./WorkContext";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function CashGate({ children }: { children: ReactNode }) {
  const { branch, register, setRegister } = useWork();
  const qc = useQueryClient();
  const { data: registers } = useRegisters(branch?.id);
  const { data: openSession } = useOpenSession(register?.id);
  const [floatAmount, setFloatAmount] = useState("50000");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!register && registers && registers.length) setRegister(registers[0]);
  }, [register, registers, setRegister]);

  if (openSession) return <>{children}</>;
  if (!register) return <div className="min-h-full grid place-items-center">Cargando cajas…</div>;

  async function abrir() {
    setBusy(true);
    try { await rpcAbrirCaja(register!.id, Number(floatAmount) || 0); await qc.invalidateQueries({ queryKey: ["open-session"] }); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-full grid place-items-center p-6">
      <Card className="p-6 space-y-3 w-full max-w-sm">
        <h2 className="font-semibold">Abrir caja — {register.name}</h2>
        <label className="text-sm">Fondo inicial</label>
        <Input value={floatAmount} inputMode="numeric" onChange={(e) => setFloatAmount(e.target.value)} />
        <Button className="w-full" onClick={abrir} disabled={busy}>{busy ? "Abriendo…" : "Abrir caja"}</Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Integrar los gates y el WorkProvider en el shell**

En `src/main.tsx`, envolver `<App/>` con `<WorkProvider>` (dentro de AuthProvider). En `src/shell/AppLayout.tsx`, envolver el contenido principal:
```tsx
// dentro de AppLayout, reemplazar <main>…<Outlet/></main> por:
import { BranchGate } from "@/session/BranchGate";
import { CashGate } from "@/session/CashGate";
// ...
<main className="flex-1 overflow-auto">
  <BranchGate businessId={profile.business_id}>
    <CashGate><Outlet /></CashGate>
  </BranchGate>
</main>
```
Y agregar el import de `WorkProvider` en `main.tsx`:
```tsx
import { WorkProvider } from "@/session/WorkContext";
// <AuthProvider><WorkProvider><BrowserRouter>…</BrowserRouter></WorkProvider></AuthProvider>
```

- [ ] **Step 6: Verificar typecheck/tests/build**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: sin errores; tests verdes; build OK.

- [ ] **Step 7: Commit**

```bash
git add src/session/WorkContext.tsx src/session/BranchGate.tsx src/session/CashGate.tsx src/data/work.ts src/shell/AppLayout.tsx src/main.tsx
git commit -m "feat(ui): gate de sucursal y caja (abrir/cerrar vía RPC)" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

### Task 8: Verificación integral end-to-end + docs

**Files:**
- Modify: `CLAUDE.md` (stack y comandos del frontend), `src/shell/AppLayout.tsx` (topbar: sucursal activa + cerrar caja)
- Create: `docs/frontend.md`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Cerrar caja desde la topbar**

En `AppLayout.tsx`, añadir en la barra un botón "Cerrar caja" que llame `rpcCerrarCaja` con un conteo (prompt simple con `Input` en un `Dialog`; usa la sesión abierta actual). Mostrar la sucursal activa. (Reusar `useOpenSession(register?.id)` y `rpcCerrarCaja`.)

```tsx
// Topbar mínima: nombre sucursal + botón cerrar caja (abre un AlertDialog con el conteo)
```
> Implementar con `AlertDialog` + `Input` para el monto contado; al confirmar, `rpcCerrarCaja(session.id, contado)` y `invalidateQueries(["open-session"])`.

- [ ] **Step 2: Configurar la publishable key real**

Confirmar con el usuario el valor de `VITE_SUPABASE_PUBLISHABLE_KEY` (dashboard → Settings → API Keys → Publishable) y ponerlo en `.env`. Sin esto el login no funciona en vivo.

- [ ] **Step 3: Verificación end-to-end (manual, app real)**

```bash
cd /c/Kromi/kromi-pos && pnpm tauri dev
```
Comprobar en la ventana:
1. Aparece el login. Con credenciales inválidas → mensaje "RUT o PIN incorrecto".
2. Login con el admin real (RUT `19.608.320-0` + su PIN) → entra.
3. Se auto-selecciona la sucursal "Planta con Mati" (única) o se puede elegir.
4. Si no hay caja abierta → pantalla "Abrir caja"; abrir con fondo 50000 → entra al shell.
5. La sidebar muestra los módulos de admin (incluye Administración); el acento refleja `business.accent`.
6. "Cerrar caja" desde la topbar cierra la sesión.
7. "Salir" vuelve al login.

Documentar el resultado (o los ajustes necesarios) en el reporte.

- [ ] **Step 4: Documentar**

En `CLAUDE.md`, actualizar la sección Stack (frontend React+Vite+TS, Tailwind v4+shadcn, Supabase) y Comandos (`pnpm dev`, `pnpm tauri dev`, `pnpm test`, `pnpm build`).
`docs/frontend.md`: estructura de `src/`, flujo de auth RUT+PIN, gates de sucursal/caja, cómo agregar un módulo en ③, y la nota de que el alta de personal requiere edge function con secret key.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/frontend.md src/shell/AppLayout.tsx
git commit -m "feat(ui): cierre de caja en topbar; docs del frontend y verificación e2e" --author="Cromilakis <ipcromilakis@gmail.com>"
```

---

## Notas de handoff a ③

- Cada módulo (Venta, Stock, Clientes, Cierre, Historial, Administración) reemplaza su `Placeholder` por la pantalla real, tomando `prototype/` como referencia visual/funcional y cableando datos vía los hooks TanStack Query (patrón de `src/data/`).
- Operaciones críticas por RPC (`cobrar_venta`, `emitir_nota_credito`, `convertir_cotizacion`); ya existe `abrir_caja`/`cerrar_caja` en `src/data/work.ts`.
- La **impresión** (ESC/POS) ya vive en Rust (`src-tauri`); se recablea desde React vía `@tauri-apps/api` `invoke` en ③.
- El **alta de personal** (crear usuarios) necesita la secret key → **edge function** dedicada (no en el cliente); diseñar como pieza aparte.
