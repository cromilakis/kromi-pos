# Diseño — ② Andamiaje del frontend (Tauri + Vite + React)

**Proyecto:** kromi-pos
**Fecha:** 2026-07-07
**Sub-proyecto:** ② de 3 (ver descomposición en el spec de ①)
**Depende de:** ① Fundación de datos (Supabase) — completo y desplegado.
**Estado:** aprobado en brainstorming; pendiente de plan de implementación.

---

## 1. Contexto

El sub-proyecto ① dejó la base de datos real en Supabase (esquema, RPC atómicas, auth
RUT+PIN, RLS) desplegada en cloud (`immuembrvocwbdpprypk`) y probada en local. El frontend
sigue siendo el **prototipo** en `src/index.html` sobre "dc-runtime" (un runtime de
prototipado), con datos en memoria.

Este sub-proyecto construye el **andamiaje del frontend de producción**: reescribe la base
en Tauri + Vite + React + TypeScript, con la capa de acceso a datos (Supabase + auth),
routing, layout/shell con navegación por rol, y el sistema de diseño. **No** porta los
módulos de negocio (venta, stock, clientes, cierre, etc.) — eso es el sub-proyecto ③. El
objetivo es dejar un shell operable: login real RUT+PIN → sucursal → caja → pantallas
placeholder, probado end-to-end contra datos reales.

## 2. Decisiones fijadas (del brainstorming)

| Tema | Decisión |
|---|---|
| Shell | Tauri 2 (ya existe) |
| Build/UI | **Vite + React 18 + TypeScript** |
| Routing | **React Router** (SPA) |
| Datos | **TanStack Query** sobre **supabase-js** (publishable key) |
| Estado de sesión | Context ligero (negocio/rol/sucursal/caja); Zustand solo si crece |
| Estilos | **Tailwind v4** con tokens en `@theme` |
| Componentes | **shadcn/ui**, tematizados, táctil-friendly (POS) |
| Identidad | **White-label**: base neutral, **acento dinámico** desde `business.accent` |
| Fidelidad | Rediseño moderno sobrio (tipo Attio/Linear), no clon del prototipo |
| Prototipo actual | **Archivar** en `prototype/` (referencia visual + lógica a portar en ③) |
| Fuente | **Satoshi vendoreada** localmente (woff2), sin `@import` de red |
| Alta de personal | Fuera del cliente: requiere **edge function** con secret key → ③ |

## 3. Arquitectura y estructura de archivos

- El prototipo (`src/index.html`, `src/support.js`, `src/vendor/`, `src/uploads/`) se mueve a
  `prototype/` sin modificarlo: es la referencia visual y la fuente de la lógica de negocio
  a portar en ③.
- Proyecto Vite en la raíz: `index.html` (entry) + `src/` (TypeScript/TSX) + `dist/` (salida).
- `src-tauri/tauri.conf.json`:
  - `build.frontendDist` → `../dist`
  - `build.beforeDevCommand` → `pnpm dev` · `build.devUrl` → `http://localhost:5173`
  - `build.beforeBuildCommand` → `pnpm build`
- Estructura `src/` (unidades pequeñas y enfocadas):
  - `src/lib/supabase.ts` — cliente supabase-js.
  - `src/lib/rut.ts` — normalización de RUT + email sintético (paridad con `public.norm_rut`).
  - `src/auth/` — `AuthProvider` (contexto de sesión), `useAuth`, `LoginScreen`.
  - `src/session/` — contexto de negocio/sucursal/caja (`useWorkContext`), selección de
    sucursal, gate de caja (abrir/cerrar).
  - `src/shell/` — `AppLayout` (sidebar + topbar), navegación por rol, guardas de ruta.
  - `src/routes/` — definición de rutas + placeholders de módulos.
  - `src/ui/` — componentes shadcn/ui + wrappers del design system.
  - `src/theme/` — tokens Tailwind `@theme` + inyección de acento dinámico.
  - `src/data/` — hooks TanStack Query de ② (perfil, negocio, sucursales, caja).

## 4. Capa de datos y autenticación

- **Cliente** (`lib/supabase.ts`): `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)`.
  La publishable key es pública → va en `.env` commiteable. La secret key **nunca** llega al
  cliente. `.env` con `VITE_SUPABASE_URL=https://immuembrvocwbdpprypk.supabase.co` y
  `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`.
- **Login RUT+PIN**: `rut.ts` normaliza el RUT (quita puntos/guion, minúscula — misma lógica
  que `public.norm_rut`) → `{normRut}@pos.kromi.local`; luego
  `supabase.auth.signInWithPassword({ email, password: pin })`. Errores mapeados a mensajes
  en español ("RUT o PIN incorrecto", etc.).
- **Perfil de sesión**: tras autenticar, `select` a `app_user` (por `auth.uid()`, filtrado
  por RLS) para obtener `business_id, name, role, active`. Se rechaza el login si
  `active = false` o no hay fila espejo. Se cargan también los datos de `business`
  (nombre, accent, logo) para el branding.
- **Acceso**: escrituras simples vía `from(...)` (RLS); operaciones críticas vía `rpc(...)`.
  En ② se usan `abrir_caja` y `cerrar_caja`; el resto de RPC se consumen en ③.
- **Sesión persistente**: supabase-js persiste el JWT (localStorage del WebView); al iniciar
  la app se restaura la sesión si existe.

## 5. Sistema de diseño

- **Tailwind v4** con bloque `@theme` en `src/theme/`. Tokens de color neutrales (superficies,
  texto, bordes), tipografía (Satoshi vendoreada), radios y sombras. Respetar la regla de
  spacing: usar solo tokens de spacing definidos en `@theme` o valores arbitrarios `[Npx]`
  (los no definidos se escalan ×4).
- **Acento dinámico**: una CSS var `--accent` se setea en runtime desde `business.accent`
  (fallback a un verde neutro). Los componentes usan `--accent` para estados primarios.
- **shadcn/ui** como base (Button, Input, Dialog, Select, Card, Toast…), instalados vía CLI y
  tematizados con los tokens. Tamaños **táctil-friendly** (targets grandes) por ser POS.

## 6. Shell, navegación y gate operativo

- `AppLayout`: sidebar (navegación) + topbar (negocio/sucursal activa, usuario, estado de
  caja). Diseño responsive (escritorio y tablet).
- **Guardas**:
  - Ruta protegida: sin sesión → `LoginScreen`.
  - Por rol (`admin`/`cajero`/`kromi`): el cajero ve Inicio, Venta, Stock, Clientes, Cierre;
    el admin además el grupo Administración; `kromi` vería la consola multi-negocio (diferida,
    placeholder). La navegación se deriva del `role` del perfil.
- **Gate operativo (incluido en ②)**:
  1. Tras login, si el negocio tiene >1 sucursal, el usuario **elige sucursal**; si tiene una,
     se selecciona automáticamente.
  2. Estado de **caja**: si no hay sesión de caja abierta en la caja elegida, se ofrece
     **abrir caja** (`rpc('abrir_caja')`); operar (vender) requiere caja abierta. **Cerrar
     caja** (`rpc('cerrar_caja')`) disponible desde el shell.
  3. La sucursal y la sesión de caja activas viven en `useWorkContext` y las consumen los
     módulos de ③.
- **Placeholders**: cada módulo (Inicio, Venta, Stock, Clientes, Cierre, Administración) es
  una pantalla mínima "en construcción" en ②; se implementan en ③.

## 7. Alcance y límites

**Incluye ②:** proyecto Vite+React+TS dentro de Tauri; archivar prototipo; cliente Supabase +
env; login RUT+PIN funcional; perfil/branding de negocio; sistema de diseño (tokens + shadcn +
acento dinámico + Satoshi); shell con navegación por rol; gate de sucursal+caja (abrir/cerrar);
placeholders de módulos; tests de lógica.

**Fuera de ② (→ ③ o aparte):** módulos de negocio (venta, stock, clientes, cierre, historial,
proveedores, categorías, config, respaldo); métricas; consola multi-negocio `kromi`; impresión
(ya existe en Rust, se recablea en ③); **alta de personal** (crear usuarios) que requiere una
edge function con secret key.

## 8. Manejo de errores

- Auth: credenciales inválidas, usuario inactivo, sin conexión → mensajes claros en español;
  el login nunca deja el shell en estado a medias.
- Datos: errores de red/RLS/RPC → toasts con mensaje accionable; TanStack Query maneja
  reintentos y estados de carga/error.
- Sin sesión de caja: la UI de operar se bloquea con un CTA para abrir caja (no permite vender
  sin caja, coherente con el invariante del backend).

## 9. Testing y verificación

- **Vitest** (unit): `rut.ts` (normalización + email sintético con casos reales), guardas de
  rol (qué navegación ve cada rol), mapeo del perfil de sesión, inyección de acento.
- **Verificación manual** end-to-end: `pnpm tauri dev` → login con el admin real (RUT
  19.608.320-0 + PIN) contra Supabase → seleccionar sucursal "Planta con Mati" → abrir caja →
  ver el shell operable → cerrar caja. También el caso de credenciales inválidas.
- **E2E (Playwright)**: opcional, diferido.

## 10. Trazabilidad

- Login RUT+PIN → §7.1 del spec de ① (email sintético + Supabase Auth).
- Gate de caja → RPC `abrir_caja`/`cerrar_caja` de ① (§6).
- Acento dinámico/branding → columnas de `business` (`accent`, `logo_url`, `name`) de ① (§5.2).
- Guardas por rol → `app_user.role` + helpers RLS de ① (§7.2).
- El look/estructura de cada módulo se define al portarlo en ③, tomando el prototipo archivado
  en `prototype/` como referencia funcional.
