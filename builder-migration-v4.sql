-- =====================================================================
-- PRIVATE WEBSITE BUILDER — ADVANCED EDITING MIGRATION V4
-- Adds hero/background and responsive layout records.
-- Media assets continue to use builder_project_assets.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v4.sql';
  end if;
end $$;

create table if not exists public.builder_project_heroes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  page_id uuid references public.builder_project_pages(id) on delete set null,
  title jsonb not null default '{}'::jsonb check (jsonb_typeof(title) = 'object'),
  subtitle jsonb not null default '{}'::jsonb check (jsonb_typeof(subtitle) = 'object'),
  background_url text,
  background_video_url text,
  background_type text not null default 'image'
    check (background_type in ('image', 'video', 'color')),
  background_color text,
  overlay_color text,
  overlay_opacity integer not null default 50
    check (overlay_opacity between 0 and 100),
  cta_label jsonb check (cta_label is null or jsonb_typeof(cta_label) = 'object'),
  cta_url text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, page_id)
);

create table if not exists public.builder_project_responsive (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  selector text not null check (length(trim(selector)) > 0),
  desktop jsonb not null default '{}'::jsonb check (jsonb_typeof(desktop) = 'object'),
  tablet jsonb not null default '{}'::jsonb check (jsonb_typeof(tablet) = 'object'),
  mobile jsonb not null default '{}'::jsonb check (jsonb_typeof(mobile) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, selector)
);

drop trigger if exists trg_builder_project_heroes_updated on public.builder_project_heroes;
create trigger trg_builder_project_heroes_updated
before update on public.builder_project_heroes
for each row execute function public.set_builder_updated_at();

drop trigger if exists trg_builder_project_responsive_updated on public.builder_project_responsive;
create trigger trg_builder_project_responsive_updated
before update on public.builder_project_responsive
for each row execute function public.set_builder_updated_at();

alter table public.builder_project_heroes enable row level security;
alter table public.builder_project_responsive enable row level security;

drop policy if exists "staff read project heroes" on public.builder_project_heroes;
drop policy if exists "staff manage project heroes" on public.builder_project_heroes;
create policy "staff read project heroes" on public.builder_project_heroes
  for select to authenticated using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project heroes" on public.builder_project_heroes
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

drop policy if exists "staff read project responsive" on public.builder_project_responsive;
drop policy if exists "staff manage project responsive" on public.builder_project_responsive;
create policy "staff read project responsive" on public.builder_project_responsive
  for select to authenticated using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project responsive" on public.builder_project_responsive
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_project_heroes,
  public.builder_project_responsive
to authenticated;
