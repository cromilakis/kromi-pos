# CLAUDE.md — kromi-pos

## Qué es este proyecto
App de escritorio (Tauri). Resumen breve derivado de `.kromi/init.md`. (Completar al avanzar el wizard.)

## Stack (fijo)
Tauri 2 (shell nativo en Rust, `src-tauri/`) + frontend **React + Vite + TypeScript** en `src/` (SPA, `frontendDist` = `dist/`). Estilos con **Tailwind CSS v4** + **shadcn/ui** (Radix bajo el capó, componentes en `src/components/ui/`). Estado de servidor con **TanStack Query**. Gestor de paquetes: **pnpm**. Datos en **Supabase/Postgres** (esquema en `supabase/migrations/`; lógica crítica en funciones RPC; auth vía Supabase Auth con RUT→email sintético). Online-only por ahora, esquema preparado para sync. Ver `docs/frontend.md` para el detalle de la arquitectura del frontend.

## Estándar de idioma
Prosa en español; técnico (código, identificadores, claves, flags) en inglés.

## Documentos contrato
`.kromi/init.md` (funcional) y `.kromi/design.md` (diseño). La implementación debe ser trazable a estos documentos.

## Comandos
- `pnpm dev` — servidor Vite solo (frontend en el navegador, sin ventana nativa; útil para iterar rápido en UI)
- `pnpm tauri dev` — ventana de desarrollo Tauri (frontend + shell Rust real)
- `pnpm test` — corre los tests del frontend (Vitest)
- `pnpm build` — compila el frontend (`tsc -b && vite build`, genera `dist/`)
- `pnpm tauri build` — empaqueta el instalable (macOS/Windows)
- El frontend vive en `src/` (React + Vite, ver `docs/frontend.md`); el shell Rust en `src-tauri/`.
- `pnpm db:reset` — recrea la base local (migraciones + seed)
- `pnpm test:db` — corre tests de esquema, RPC y RLS
- Base de datos: Supabase local (Docker). Ver `supabase/README.md`.

## Disciplina (reglas)
- Validar entradas en la capa que corresponda; no confiar en datos sin verificar.
- Secretos fuera del cliente y del repo.
- Externalizar textos de UI; no hardcodear strings dispersos.
- Reproducir antes de arreglar; evidencia antes de afirmar éxito.

## Límites de autonomía
Bloqueos que requieren intervención humana: credenciales/secretos, borrado de datos,
cambios destructivos, firma/distribución de instaladores, decisiones legales/privacidad,
conflictos entre `init.md` y `design.md`.
