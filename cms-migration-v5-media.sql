-- GDF'27 CMS V5: enable safe hero/media video uploads.
-- Run AFTER cms-migration-v4.sql in Supabase SQL Editor.
-- Supported video formats: MP4 and WebM. Maximum object size: 50 MiB.
-- SVG and executable formats remain disallowed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media', 'site-media', true, 52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Reassert staff-only object mutations (safe to run repeatedly).
drop policy if exists "staff list media" on storage.objects;
drop policy if exists "staff upload media" on storage.objects;
drop policy if exists "staff update media" on storage.objects;
drop policy if exists "staff delete media" on storage.objects;

create policy "staff list media" on storage.objects
  for select to authenticated
  using (bucket_id = 'site-media' and (select public.is_staff()));

create policy "staff upload media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-media' and (select public.is_staff()));

create policy "staff update media" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-media' and (select public.is_staff()))
  with check (bucket_id = 'site-media' and (select public.is_staff()));

create policy "staff delete media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-media' and (select public.is_staff()));

notify pgrst, 'reload schema';
