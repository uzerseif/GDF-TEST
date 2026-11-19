-- =====================================================================
-- PRIVATE WEBSITE BUILDER — CODE, IMPORT AND EXPORT MIGRATION V5
-- Stores project custom code and import/export jobs separately.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v5.sql';
  end if;
end $$;

create table if not exists public.builder_project_custom_code (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  page_id uuid references public.builder_project_pages(id) on delete cascade,
  location text not null default 'page'
    check (location in ('head', 'page', 'footer')),
  html text not null default '',
  css text not null default '',
  javascript text not null default '',
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, page_id, location)
);

create table if not exists public.builder_project_archives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  operation text not null check (operation in ('import', 'export')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  file_name text,
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists builder_archives_project_idx
  on public.builder_project_archives(project_id, created_at desc);

drop trigger if exists trg_builder_project_custom_code_updated on public.builder_project_custom_code;
create trigger trg_builder_project_custom_code_updated
before update on public.builder_project_custom_code
for each row execute function public.set_builder_updated_at();

alter table public.builder_project_custom_code enable row level security;
alter table public.builder_project_archives enable row level security;

drop policy if exists "staff read project custom code" on public.builder_project_custom_code;
drop policy if exists "staff manage project custom code" on public.builder_project_custom_code;
create policy "staff read project custom code" on public.builder_project_custom_code
  for select to authenticated using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project custom code" on public.builder_project_custom_code
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

drop policy if exists "staff read project archives" on public.builder_project_archives;
drop policy if exists "staff manage project archives" on public.builder_project_archives;
create policy "staff read project archives" on public.builder_project_archives
  for select to authenticated using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project archives" on public.builder_project_archives
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_project_custom_code,
  public.builder_project_archives
to authenticated;

create or replace function public.protect_builder_custom_code()
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
    raise exception 'Custom code page must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_builder_custom_code on public.builder_project_custom_code;
create trigger trg_protect_builder_custom_code
before insert or update on public.builder_project_custom_code
for each row execute function public.protect_builder_custom_code();
