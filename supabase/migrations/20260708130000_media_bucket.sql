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
