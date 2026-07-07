# CLAUDE.md — kromi-pos

## Qué es este proyecto
App de escritorio (Tauri). Resumen breve derivado de `.kromi/init.md`. (Completar al avanzar el wizard.)

## Stack (fijo)
Tauri 2 (shell nativo en Rust) + frontend estático (HTML/CSS/JS autocontenido en `src/`, servido vía `frontendDist`). Gestor de paquetes: **pnpm**. Datos en **Supabase/Postgres** (esquema en `supabase/migrations/`; lógica crítica en funciones RPC). Online-only por ahora, esquema preparado para sync.

## Estándar de idioma
Prosa en español; técnico (código, identificadores, claves, flags) en inglés.

## Documentos contrato
`.kromi/init.md` (funcional) y `.kromi/design.md` (diseño). La implementación debe ser trazable a estos documentos.

## Comandos
- `pnpm tauri dev` (o `pnpm dev`) — ventana de desarrollo
- `pnpm tauri build` (o `pnpm build`) — empaqueta el instalable (macOS/Windows)
- El frontend vive en `src/` (`index.html` autocontenido); el shell Rust en `src-tauri/`.
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
