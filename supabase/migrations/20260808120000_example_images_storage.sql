-- 例題画像用 Storage バケット（question_images / explanation_images のパス先）

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'example-images',
  'example-images',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- パス先頭は auth.uid()（例: {user_id}/{cert_id}/{example_id}/question.png）
drop policy if exists example_images_select_own on storage.objects;
create policy example_images_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'example-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists example_images_insert_own on storage.objects;
create policy example_images_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'example-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists example_images_update_own on storage.objects;
create policy example_images_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'example-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'example-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists example_images_delete_own on storage.objects;
create policy example_images_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'example-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
