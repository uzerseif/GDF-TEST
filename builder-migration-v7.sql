-- =====================================================================
-- PRIVATE WEBSITE BUILDER — GDF'27 INTEGRATION V7
-- Records legacy/custom integrations and protects certificate verification.
-- This migration does not publish or replace public GDF'27 files.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v7.sql';
  end if;
end $$;

create table if not exists public.builder_project_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  integration_key text not null check (integration_key ~ '^[a-z0-9_.-]{1,120}$'),
  source_path text not null,
  integration_type text not null check (integration_type in ('legacy', 'custom', 'cms', 'certificate', 'form')),
  is_protected boolean not null default true,
  notes jsonb not null default '{}'::jsonb check (jsonb_typeof(notes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, integration_key)
);

create index if not exists builder_integrations_project_idx
  on public.builder_project_integrations(project_id, integration_type);

drop trigger if exists trg_builder_project_integrations_updated on public.builder_project_integrations;
create trigger trg_builder_project_integrations_updated
before update on public.builder_project_integrations
for each row execute function public.set_builder_updated_at();

create or replace function public.protect_builder_integrations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.builder_projects p
    where p.id = coalesce(new.project_id, old.project_id)
      and p.is_system
      and coalesce(old.is_protected, false)
  ) and (
    tg_op = 'DELETE'
    or new.project_id is distinct from old.project_id
    or new.integration_key is distinct from old.integration_key
    or new.source_path is distinct from old.source_path
  ) then
    raise exception 'GDF27 protected integration cannot be removed or reidentified';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_builder_integrations on public.builder_project_integrations;
create trigger trg_protect_builder_integrations
before update or delete on public.builder_project_integrations
for each row execute function public.protect_builder_integrations();

alter table public.builder_project_integrations enable row level security;

drop policy if exists "staff read project integrations" on public.builder_project_integrations;
drop policy if exists "staff manage project integrations" on public.builder_project_integrations;
create policy "staff read project integrations" on public.builder_project_integrations
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project integrations" on public.builder_project_integrations
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_project_integrations
to authenticated;

insert into public.builder_project_integrations
  (project_id, integration_key, source_path, integration_type, is_protected, notes)
select p.id, x.integration_key, x.source_path, x.integration_type, true, x.notes
from public.builder_projects p
cross join lateral (
  values
    ('gdf27.cms', 'cms-public.js', 'cms', '{"en":"Existing public CMS integration"}'::jsonb),
    ('gdf27.verify', 'verify/', 'certificate', '{"en":"Certificate verification page and RPC"}'::jsonb),
    ('gdf27.certificate', 'certificate/', 'certificate', '{"en":"Certificate rendering and PDF system"}'::jsonb),
    ('gdf27.applications', 'applications/', 'form', '{"en":"Existing Google Forms application links"}'::jsonb),
    ('gdf27.committees', 'committees/', 'cms', '{"en":"Existing committee CMS records"}'::jsonb),
    ('gdf27.team', 'team/', 'cms', '{"en":"Existing team CMS records"}'::jsonb),
    ('gdf27.faq', 'faq/', 'cms', '{"en":"Existing FAQ CMS records"}'::jsonb),
    ('gdf27.sponsors', 'index.html#sponsors', 'cms', '{"en":"Existing sponsor CMS records"}'::jsonb)
) as x(integration_key, source_path, integration_type, notes)
where p.slug = 'gdf27'
on conflict (project_id, integration_key) do nothing;
