-- =====================================================================
-- PRIVATE WEBSITE BUILDER — DRAFTS, PUBLISHING AND BACKUPS V6
-- Adds release snapshots and atomic publish/restore operations.
-- Publishing here controls Builder state only; public GDF'27 deployment is
-- intentionally handled by a later integration phase.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.can_manage_builder_project(uuid)') is null
    or to_regprocedure('public.set_builder_updated_at()') is null
  then
    raise exception 'Run builder-migration-v1.sql before builder-migration-v6.sql';
  end if;
end $$;

create table if not exists public.builder_project_releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.builder_projects(id) on delete cascade,
  revision_id uuid references public.builder_project_revisions(id) on delete set null,
  label text not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists builder_releases_project_idx
  on public.builder_project_releases(project_id, created_at desc);

alter table public.builder_project_releases enable row level security;

drop policy if exists "staff read project releases" on public.builder_project_releases;
drop policy if exists "staff manage project releases" on public.builder_project_releases;
create policy "staff read project releases" on public.builder_project_releases
  for select to authenticated
  using ((select public.can_manage_builder_project(project_id)));
create policy "staff manage project releases" on public.builder_project_releases
  for all to authenticated
  using ((select public.can_manage_builder_project(project_id)))
  with check ((select public.can_manage_builder_project(project_id)));

grant select, insert, update, delete on
  public.builder_project_releases
to authenticated;

create or replace function public.publish_builder_document(
  p_document_id uuid,
  p_label text default 'Published release'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.builder_editor_documents%rowtype;
  v_revision_id uuid;
  v_release_id uuid;
  v_manifest jsonb;
begin
  select * into v_document
  from public.builder_editor_documents
  where id = p_document_id;

  if not found then
    raise exception 'Document not found';
  end if;

  if not (select public.can_manage_builder_project(v_document.project_id)) then
    raise exception 'Not authorized to publish this document';
  end if;

  insert into public.builder_project_revisions (
    project_id, page_id, document_id, label, html, css, javascript, assets, created_by
  )
  values (
    v_document.project_id, v_document.page_id, v_document.id,
    coalesce(nullif(trim(p_label), ''), 'Published release'),
    v_document.html, v_document.css, v_document.javascript, v_document.assets,
    (select auth.uid())
  )
  returning id into v_revision_id;

  v_manifest := jsonb_build_object(
    'document_id', v_document.id,
    'page_id', v_document.page_id,
    'html', v_document.html,
    'css', v_document.css,
    'javascript', v_document.javascript,
    'assets', v_document.assets,
    'published_at', now()
  );

  update public.builder_editor_documents
  set status = 'published', updated_at = now()
  where id = v_document.id;

  update public.builder_project_pages
  set is_published = true, updated_at = now()
  where id = v_document.page_id
    and project_id = v_document.project_id;

  insert into public.builder_project_releases (
    project_id, revision_id, label, manifest, published_by
  )
  values (
    v_document.project_id, v_revision_id,
    coalesce(nullif(trim(p_label), ''), 'Published release'),
    v_manifest, (select auth.uid())
  )
  returning id into v_release_id;

  return v_release_id;
end;
$$;

revoke execute on function public.publish_builder_document(uuid, text) from public, anon;
grant execute on function public.publish_builder_document(uuid, text) to authenticated;

create or replace function public.restore_builder_revision(
  p_revision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.builder_project_revisions%rowtype;
  v_document_id uuid;
  v_backup_id uuid;
begin
  select * into v_revision
  from public.builder_project_revisions
  where id = p_revision_id;

  if not found then
    raise exception 'Revision not found';
  end if;

  if not (select public.can_manage_builder_project(v_revision.project_id)) then
    raise exception 'Not authorized to restore this revision';
  end if;

  select id into v_document_id
  from public.builder_editor_documents
  where project_id = v_revision.project_id
    and page_id = v_revision.page_id;

  if v_document_id is null then
    insert into public.builder_editor_documents (
      project_id, page_id, html, css, javascript, assets, status
    )
    values (
      v_revision.project_id, v_revision.page_id,
      v_revision.html, v_revision.css, v_revision.javascript,
      v_revision.assets, 'draft'
    )
    returning id into v_document_id;
  else
    insert into public.builder_project_revisions (
      project_id, page_id, document_id, label, html, css, javascript, assets, created_by
    )
    select project_id, page_id, id, 'Before restore',
           html, css, javascript, assets, (select auth.uid())
    from public.builder_editor_documents
    where id = v_document_id
    returning id into v_backup_id;

    update public.builder_editor_documents
    set html = v_revision.html,
        css = v_revision.css,
        javascript = v_revision.javascript,
        assets = v_revision.assets,
        status = 'draft',
        updated_at = now()
    where id = v_document_id;
  end if;

  return v_document_id;
end;
$$;

revoke execute on function public.restore_builder_revision(uuid) from public, anon;
grant execute on function public.restore_builder_revision(uuid) to authenticated;
