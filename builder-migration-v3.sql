-- =====================================================================
-- PRIVATE WEBSITE BUILDER — WEBSITE MANAGEMENT MIGRATION V3
-- Adds project navigation and global header/footer registrations.
-- Builder project settings and design tokens remain JSON-keyed.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v3.sql';
  end if;
end $$;

create table if not exists public.builder_project_navigation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  page_id uuid references public.builder_project_pages(id) on delete set null,
  label jsonb not null check (jsonb_typeof(label) = 'object'),
  href text not null check (length(trim(href)) > 0),
  location text not null default 'header'
    check (location in ('header', 'footer')),
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists builder_navigation_project_idx
  on public.builder_project_navigation(project_id, location, sort_order);

create or replace function public.protect_builder_navigation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.page_id is not null
    and not exists (
      select 1
      from public.builder_project_pages p
      where p.id = new.page_id
        and p.project_id = new.project_id
    )
  then
    raise exception 'Navigation page must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_builder_navigation on public.builder_project_navigation;
create trigger trg_protect_builder_navigation
before insert or update on public.builder_project_navigation
for each row execute function public.protect_builder_navigation();

create or replace function public.protect_builder_system_pages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and exists (
      select 1 from public.builder_projects p
      where p.id = old.project_id and p.is_system
    )
  then
    raise exception 'GDF27 legacy pages cannot be deleted';
  end if;

  if tg_op = 'UPDATE'
    and exists (
      select 1 from public.builder_projects p
      where p.id = old.project_id and p.is_system
    )
    and (
      new.project_id is distinct from old.project_id
      or new.slug is distinct from old.slug
    )
  then
    raise exception 'GDF27 legacy page identity cannot be changed';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_builder_system_pages on public.builder_project_pages;
create trigger trg_protect_builder_system_pages
before update or delete on public.builder_project_pages
for each row execute function public.protect_builder_system_pages();

drop trigger if exists trg_builder_navigation_updated on public.builder_project_navigation;
create trigger trg_builder_navigation_updated
before update on public.builder_project_navigation
for each row execute function public.set_builder_updated_at();

alter table public.builder_project_navigation enable row level security;

drop policy if exists "staff read project navigation" on public.builder_project_navigation;
drop policy if exists "staff manage project navigation" on public.builder_project_navigation;
create policy "staff read project navigation" on public.builder_project_navigation
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project navigation" on public.builder_project_navigation
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_project_navigation
to authenticated;
