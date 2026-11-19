-- =====================================================================
-- PRIVATE WEBSITE BUILDER — INTEGRITY HARDENING V9
-- Closes cross-project foreign references and finalizes GDF'27 system flag.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v9.sql';
  end if;
end $$;

update public.builder_projects
set is_system = true
where slug = 'gdf27';

create or replace function public.protect_builder_document_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.builder_project_pages p
    where p.id = new.page_id
      and p.project_id = new.project_id
  ) then
    raise exception 'Document page must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_builder_document_links on public.builder_editor_documents;
create trigger trg_protect_builder_document_links
before insert or update on public.builder_editor_documents
for each row execute function public.protect_builder_document_links();

create or replace function public.protect_builder_revision_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.builder_project_pages p
    where p.id = new.page_id
      and p.project_id = new.project_id
  ) then
    raise exception 'Revision page must belong to the same project';
  end if;

  if new.document_id is not null
    and not exists (
      select 1
      from public.builder_editor_documents d
      where d.id = new.document_id
        and d.project_id = new.project_id
        and d.page_id = new.page_id
    )
  then
    raise exception 'Revision document must belong to the same project and page';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_builder_revision_links on public.builder_project_revisions;
create trigger trg_protect_builder_revision_links
before insert or update on public.builder_project_revisions
for each row execute function public.protect_builder_revision_links();

create or replace function public.protect_builder_hero_links()
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
    raise exception 'Hero page must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_builder_hero_links on public.builder_project_heroes;
create trigger trg_protect_builder_hero_links
before insert or update on public.builder_project_heroes
for each row execute function public.protect_builder_hero_links();

create or replace function public.protect_builder_release_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision_id is not null
    and not exists (
      select 1
      from public.builder_project_revisions r
      where r.id = new.revision_id
        and r.project_id = new.project_id
    )
  then
    raise exception 'Release revision must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_builder_release_links on public.builder_project_releases;
create trigger trg_protect_builder_release_links
before insert or update on public.builder_project_releases
for each row execute function public.protect_builder_release_links();
