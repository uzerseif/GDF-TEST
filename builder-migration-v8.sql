-- =====================================================================
-- PRIVATE WEBSITE BUILDER — FINALIZATION AND QA V8
-- Records integration test runs without changing public GDF'27 data.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v8.sql';
  end if;
end $$;

create table if not exists public.builder_project_test_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  test_key text not null check (test_key ~ '^[a-z0-9_.-]{1,120}$'),
  status text not null check (status in ('passed', 'failed', 'pending', 'skipped')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  ran_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists builder_test_runs_project_idx
  on public.builder_project_test_runs(project_id, started_at desc);

alter table public.builder_project_test_runs enable row level security;

drop policy if exists "staff read project test runs" on public.builder_project_test_runs;
drop policy if exists "staff manage project test runs" on public.builder_project_test_runs;
create policy "staff read project test runs" on public.builder_project_test_runs
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project test runs" on public.builder_project_test_runs
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_project_test_runs
to authenticated;
