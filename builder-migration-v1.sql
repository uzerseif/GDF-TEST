-- =====================================================================
-- PRIVATE WEBSITE BUILDER — FOUNDATION MIGRATION V1
-- Adds the project-isolation tables used by Builder Studio Phase 1.
-- This migration is additive and safe to run more than once.
-- Existing GDF'27 CMS tables and rows are not modified.
-- =====================================================================

create table if not exists public.builder_projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  name        jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb check (description is null or jsonb_typeof(description) = 'object'),
  thumbnail_url text,
  owner_id    uuid references auth.users(id) on delete set null,
  is_system   boolean not null default false,
  status      text not null default 'draft'
              check (status in ('draft', 'published', 'archived')),
  is_active   boolean not null default true,
  cms_project text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.builder_project_settings (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9_.-]{1,120}$'),
  value      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key)
);
create index if not exists builder_project_settings_project_idx
  on public.builder_project_settings(project_id, key);

create table if not exists public.builder_project_pages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  slug       text not null,
  constraint builder_project_pages_slug_check
    check (slug = './' or slug ~ '^[a-z0-9/_-]{1,120}$'),
  title      jsonb not null check (jsonb_typeof(title) = 'object'),
  page_type  text not null default 'legacy'
              check (page_type in ('legacy', 'visual', 'custom')),
  is_home    boolean not null default false,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

-- Keep the page slug rule correct on both fresh and partially-created databases.
-- The legacy home page uses './', which must be explicitly allowed.
alter table public.builder_project_pages
  drop constraint if exists builder_project_pages_slug_check;

alter table public.builder_project_pages
  add constraint builder_project_pages_slug_check
  check (slug = './' or slug ~ '^[a-z0-9/_-]{1,120}$');

create index if not exists builder_project_pages_project_idx
  on public.builder_project_pages(project_id, sort_order);

create table if not exists public.builder_project_assets (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  name       text not null,
  asset_url  text not null,
  asset_type text not null default 'image',
  created_at timestamptz not null default now()
);
create index if not exists builder_project_assets_project_idx
  on public.builder_project_assets(project_id, created_at desc);

alter table public.builder_projects add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.builder_projects add column if not exists is_system boolean not null default false;

do $$
begin
  if to_regprocedure('public.is_staff()') is null
    or to_regprocedure('public.is_admin()') is null
  then
    raise exception 'Run cms-schema.sql or cms-migration-v4.sql before builder-migration-v1.sql';
  end if;
end $$;

create or replace function public.set_builder_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'builder_projects',
    'builder_project_settings',
    'builder_project_pages'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.set_builder_updated_at()', t);
  end loop;
end $$;

alter table public.builder_projects enable row level security;
alter table public.builder_project_settings enable row level security;
alter table public.builder_project_pages enable row level security;
alter table public.builder_project_assets enable row level security;

create or replace function public.can_manage_builder_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.builder_projects p
    where p.id = p_project_id
      and (
        (select public.is_admin())
        or p.owner_id = (select auth.uid())
        or (p.is_system and (select public.is_staff()))
      )
  );
$$;

revoke execute on function public.can_manage_builder_project(uuid) from public, anon;
grant execute on function public.can_manage_builder_project(uuid) to authenticated;

create or replace function public.protect_builder_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.is_system
    and (select auth.uid()) is not null
    and not (select public.is_admin())
  then
    raise exception 'Only administrators can create system projects';
  end if;

  if tg_op = 'DELETE' and old.is_system then
    raise exception 'GDF27 system project cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and old.is_system then
    if new.slug is distinct from old.slug
      or new.is_system is distinct from old.is_system
      or new.cms_project is distinct from old.cms_project
      or new.owner_id is distinct from old.owner_id
    then
      raise exception 'GDF27 identity fields cannot be changed';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and new.is_system
    and old.is_system is distinct from new.is_system
    and (select auth.uid()) is not null
    and not (select public.is_admin())
  then
    raise exception 'Only administrators can mark a project as system';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_builder_project on public.builder_projects;
create trigger trg_protect_builder_project
before insert or update or delete on public.builder_projects
for each row execute function public.protect_builder_project();

drop policy if exists "staff read projects" on public.builder_projects;
drop policy if exists "staff manage projects" on public.builder_projects;
create policy "staff read projects" on public.builder_projects
  for select to authenticated
  using (
    (select public.is_admin())
    or owner_id = (select auth.uid())
    or (is_system and (select public.is_staff()))
  );
create policy "staff manage projects" on public.builder_projects
  for all to authenticated
  using (
    (select public.is_admin())
    or owner_id = (select auth.uid())
    or (is_system and (select public.is_staff()))
  )
  with check (
    (select public.is_admin())
    or owner_id = (select auth.uid())
    or (is_system and (select public.is_staff()))
  );

drop policy if exists "staff read project settings" on public.builder_project_settings;
drop policy if exists "staff manage project settings" on public.builder_project_settings;
create policy "staff read project settings" on public.builder_project_settings
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project settings" on public.builder_project_settings
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

drop policy if exists "staff read project pages" on public.builder_project_pages;
drop policy if exists "staff manage project pages" on public.builder_project_pages;
create policy "staff read project pages" on public.builder_project_pages
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project pages" on public.builder_project_pages
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

drop policy if exists "staff read project assets" on public.builder_project_assets;
drop policy if exists "staff manage project assets" on public.builder_project_assets;
create policy "staff read project assets" on public.builder_project_assets
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project assets" on public.builder_project_assets
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_projects,
  public.builder_project_settings,
  public.builder_project_pages,
  public.builder_project_assets
to authenticated;

create or replace function public.duplicate_builder_project(
  p_source_id uuid,
  p_new_slug text,
  p_new_name jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_copy_id uuid;
  v_source public.builder_projects%rowtype;
begin
  if p_new_slug !~ '^[a-z0-9-]{1,80}$'
    or jsonb_typeof(p_new_name) is distinct from 'object'
  then
    raise exception 'Invalid project duplicate parameters';
  end if;

  if not (select public.can_manage_builder_project(p_source_id)) then
    raise exception 'Not authorized to duplicate this project';
  end if;

  select * into v_source
  from public.builder_projects
  where id = p_source_id;

  if not found then
    raise exception 'Source project not found';
  end if;

  insert into public.builder_projects (
    slug,
    name,
    description,
    thumbnail_url,
    owner_id,
    is_system,
    status,
    is_active,
    cms_project
  )
  values (
    p_new_slug,
    p_new_name,
    v_source.description,
    v_source.thumbnail_url,
    (select auth.uid()),
    false,
    'draft',
    true,
    null
  )
  returning id into v_copy_id;

  insert into public.builder_project_settings (project_id, key, value)
  select v_copy_id, s.key, s.value
  from public.builder_project_settings s
  where s.project_id = p_source_id;

  insert into public.builder_project_pages (
    project_id, slug, title, page_type, is_home, is_published, sort_order
  )
  select v_copy_id, p.slug, p.title, p.page_type, p.is_home, false, p.sort_order
  from public.builder_project_pages p
  where p.project_id = p_source_id;

  insert into public.builder_project_assets (
    project_id, name, asset_url, asset_type
  )
  select v_copy_id, a.name, a.asset_url, a.asset_type
  from public.builder_project_assets a
  where a.project_id = p_source_id;

  return v_copy_id;
end;
$$;

revoke execute on function public.duplicate_builder_project(uuid, text, jsonb) from public, anon;
grant execute on function public.duplicate_builder_project(uuid, text, jsonb) to authenticated;


insert into public.builder_projects
  (slug, name, description, thumbnail_url, status, is_active, cms_project, is_system)
values (
  'gdf27',
  '{"en":"GDF''27","ar":"GDF''27","tr":"GDF''27"}'::jsonb,
  '{"en":"Gaziantep Diplomacy Forum 2027","ar":"منتدى غازي عنتاب للدبلوماسية 2027","tr":"Gaziantep Diplomasi Forumu 2027"}'::jsonb,
  'images/logo.webp',
  'draft',
  true,
  'gdf27',
  true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  thumbnail_url = excluded.thumbnail_url,
  cms_project = excluded.cms_project,
  is_system = true;



-- Seed the first project and preserve GDF'27 as the existing legacy project.
DO $$
DECLARE
  project uuid;
BEGIN
  SELECT id INTO project
  FROM public.builder_projects
  WHERE slug = 'gdf27';

  IF project IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.builder_project_settings (project_id, key, value)
  VALUES
    (project, 'cms.project', '"gdf27"'::jsonb),
    (project, 'cms.legacy', 'true'::jsonb),
    (project, 'preview.origin', '"./"'::jsonb)
  ON CONFLICT (project_id, key) DO NOTHING;

  INSERT INTO public.builder_project_pages
    (project_id, slug, title, page_type, is_home, is_published, sort_order)
  VALUES
    (project, './', '{"en":"Home","ar":"الرئيسية","tr":"Ana Sayfa"}'::jsonb, 'legacy', true, true, 0),
    (project, 'about/', '{"en":"About Us","ar":"من نحن","tr":"Hakkımızda"}'::jsonb, 'legacy', false, true, 1),
    (project, 'applications/', '{"en":"Applications","ar":"التقديم","tr":"Başvurular"}'::jsonb, 'legacy', false, true, 2),
    (project, 'committees/', '{"en":"Committees","ar":"اللجان","tr":"Komiteler"}'::jsonb, 'legacy', false, true, 3),
    (project, 'faq/', '{"en":"FAQ","ar":"الأسئلة الشائعة","tr":"SSS"}'::jsonb, 'legacy', false, true, 4),
    (project, 'team/', '{"en":"Our Team","ar":"فريقنا","tr":"Ekibimiz"}'::jsonb, 'legacy', false, true, 5),
    (project, 'president/', '{"en":"President''s Message","ar":"رسالة الرئيس","tr":"Başkanın Mesajı"}'::jsonb, 'legacy', false, true, 6),
    (project, 'verify/', '{"en":"Verify Certificate","ar":"التحقق من الشهادة","tr":"Sertifika Doğrulama"}'::jsonb, 'legacy', false, true, 7)
  ON CONFLICT (project_id, slug) DO NOTHING;

END $$;
