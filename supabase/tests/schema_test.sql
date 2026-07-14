-- ============================================================================
-- Test de esquema (Task 2 + Task 3): existencia de tablas maestras/operativas
-- y constraints críticas. Corre en transacción con ROLLBACK.
--   docker exec -i supabase_db_kromi-pos psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/schema_test.sql
-- ============================================================================
begin;

-- Tablas maestras (Task 2)
do $$
declare t text;
begin
  foreach t in array array[
    'business','branch','register','app_user','category','product',
    'supplier','customer','inventory','module_state','module_notice'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'FALTA tabla public.%', t;
    end if;
  end loop;
end $$;

-- Funciones auxiliares
do $$ begin
  if to_regprocedure('public.norm_rut(text)') is null then
    raise exception 'FALTA funcion public.norm_rut(text)';
  end if;
end $$;

-- norm_rut normaliza (sin puntos/guion, minúscula)
do $$ begin
  if public.norm_rut('11.111.111-1') <> '111111111' then
    raise exception 'norm_rut incorrecto: %', public.norm_rut('11.111.111-1');
  end if;
  if public.norm_rut('12.345.678-K') <> '12345678k' then
    raise exception 'norm_rut no minuscula K: %', public.norm_rut('12.345.678-K');
  end if;
end $$;

-- inventory: PK compuesta y CHECK stock >= 0
do $$ begin
  begin
    insert into public.business (id, name, rut) values
      ('11111111-1111-1111-1111-111111111111','T','1-9');
    insert into public.branch (id, business_id, name) values
      ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','T');
    insert into public.category (id, business_id, key, label) values
      ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','x','X');
    insert into public.product (id, business_id, name, category_id, price) values
      ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','P','33333333-3333-3333-3333-333333333333',1000);
    -- stock negativo debe fallar
    begin
      insert into public.inventory (product_id, branch_id, stock) values
        ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',-1);
      raise exception 'FALLO: inventory acepto stock negativo';
    exception when check_violation then null;
    end;
  end;
end $$;

-- Tablas operativas (Task 3)
do $$
declare t text;
begin
  foreach t in array array[
    'cash_session','sale','sale_line','quote','quote_line',
    'credit_note','credit_note_line','folio_counter'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'FALTA tabla public.%', t;
    end if;
  end loop;
end $$;

-- credit_note gana columnas DTE (Task 1)
do $$
declare cols text[] := array['dte_status', 'dte_folio', 'dte_timbre', 'dte_track_id', 'emitted_at', 'cod_ref'];
       c text;
begin
  foreach c in array cols loop
    if not exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='credit_note' and column_name=c
    ) then
      raise exception 'FALTA columna public.credit_note.%', c;
    end if;
  end loop;
end $$;

-- Folio único por sucursal en sale
do $$
declare b uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into public.sale (business_id, branch_id, folio, method, total, neto, iva, recv, change, cashier_id)
    values ('11111111-1111-1111-1111-111111111111', b, 1, 'efectivo', 1000, 840, 160, 1000, 0, null);
  begin
    insert into public.sale (business_id, branch_id, folio, method, total, neto, iva, recv, change, cashier_id)
      values ('11111111-1111-1111-1111-111111111111', b, 1, 'efectivo', 1000, 840, 160, 1000, 0, null);
    raise exception 'FALLO: folio duplicado aceptado en la misma sucursal';
  exception when unique_violation then null;
  end;
end $$;

rollback;
\echo 'schema_test OK'
