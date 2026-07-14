-- Config de auto-bloqueo por inactividad: minutos antes de bloquear la sesión.
-- 0 = nunca bloquear (comportamiento por defecto, retrocompatible).
alter table public.business
  add column if not exists lock_timeout_min int not null default 0 check (lock_timeout_min >= 0);
