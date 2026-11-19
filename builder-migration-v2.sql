-- =====================================================================
-- PRIVATE WEBSITE BUILDER — VISUAL EDITOR MIGRATION V2
-- Adds GrapesJS documents, revisions and component storage.
-- Requires builder-migration-v1.sql and the CMS authorization helpers.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v2.sql';
  end if;
end $$;

create table if not exists public.builder_editor_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  page_id uuid not null references public.builder_project_pages(id) on delete cascade,
  html text not null default '',
  css text not null default '',
  javascript text not null default '',
  assets jsonb not null default '[]'::jsonb check (jsonb_typeof(assets) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, page_id)
);

create table if not exists public.builder_project_components (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  name text not null,
  category text not null default 'Custom',
  html text not null default '',
  css text not null default '',
  javascript text not null default '',
  thumbnail_url text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists builder_components_project_idx
  on public.builder_project_components(project_id, sort_order);

create table if not exists public.builder_project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  page_id uuid not null references public.builder_project_pages(id) on delete cascade,
  document_id uuid references public.builder_editor_documents(id) on delete cascade,
  label text,
  html text not null default '',
  css text not null default '',
  javascript text not null default '',
  assets jsonb not null default '[]'::jsonb check (jsonb_typeof(assets) = 'array'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists builder_revisions_page_idx
  on public.builder_project_revisions(page_id, created_at desc);

drop trigger if exists trg_builder_editor_documents_updated on public.builder_editor_documents;
create trigger trg_builder_editor_documents_updated
before update on public.builder_editor_documents
for each row execute function public.set_builder_updated_at();

drop trigger if exists trg_builder_project_components_updated on public.builder_project_components;
create trigger trg_builder_project_components_updated
before update on public.builder_project_components
for each row execute function public.set_builder_updated_at();

alter table public.builder_editor_documents enable row level security;
alter table public.builder_project_components enable row level security;
alter table public.builder_project_revisions enable row level security;

drop policy if exists "staff read editor documents" on public.builder_editor_documents;
drop policy if exists "staff manage editor documents" on public.builder_editor_documents;
create policy "staff read editor documents" on public.builder_editor_documents
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage editor documents" on public.builder_editor_documents
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

drop policy if exists "staff read project components" on public.builder_project_components;
drop policy if exists "staff manage project components" on public.builder_project_components;
create policy "staff read project components" on public.builder_project_components
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project components" on public.builder_project_components
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

drop policy if exists "staff read project revisions" on public.builder_project_revisions;
drop policy if exists "staff manage project revisions" on public.builder_project_revisions;
create policy "staff read project revisions" on public.builder_project_revisions
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project revisions" on public.builder_project_revisions
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_editor_documents,
  public.builder_project_components,
  public.builder_project_revisions
to authenticated;
