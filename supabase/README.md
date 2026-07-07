# Base de datos — kromi-pos

Fundación de datos y lógica (sub-proyecto ①). Diseño:
`docs/superpowers/specs/2026-07-07-fundacion-datos-supabase-design.md`.

## Desarrollo local
- `supabase start` — levanta Postgres/Auth locales (requiere Docker).
- `pnpm db:reset` — aplica migraciones + `seed.sql`.
- `pnpm test:db` — esquema + RPC + RLS.

Admin demo local: RUT `11.111.111-1`, PIN `123456`.

## Estructura
- `migrations/…_catalog.sql` — maestros, tenancy, inventario, módulos.
- `migrations/…_operations.sql` — caja, ventas, cotizaciones, notas de crédito, folios.
- `migrations/…_functions.sql` — RPC (cobrar_venta, abrir/cerrar caja, NC, cotización).
- `migrations/…_auth.sql` — espejo auth.users→app_user, helpers de sesión.
- `migrations/…_rls.sql` — políticas RLS + índices.
- `seed.sql` — seed mínimo local.

## Bootstrap de producción (al linkear el proyecto cloud)
1. El usuario crea el proyecto en Supabase y provee las credenciales (bloqueo de autonomía).
2. `supabase link --project-ref <ref>` y `supabase db push`.
3. Crear el negocio/sucursal/caja iniciales (SQL) y el primer admin vía **Admin API**
   (`auth.admin.createUser` con `user_metadata` = business_id/name/rut/role y el PIN como password).
   No usar `seed.sql` en producción.
