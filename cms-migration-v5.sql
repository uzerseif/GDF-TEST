-- =====================================================================
-- GDF'27 UCMS — MIGRATION V5 (audit, notifications, backups, roles,
-- page templates). Additive and safe to run more than once.
--   * No DROP TABLE, no DELETE of data. Existing rows are preserved.
--   * Requires cms-schema.sql / cms-migration-v4.sql (helpers re-created
--     here idempotently) and builder-migration-v1.sql for templates FK.
-- Run in: Supabase Dashboard > SQL Editor > paste > Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HELPERS (re-created idempotently; extends role model)
-- ---------------------------------------------------------------------
create or replace function public.is_i18n(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select v is not null and jsonb_typeof(v) = 'object'
     and length(trim(coalesce(v ->> 'en', ''))) > 0;
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;

create or replace function public.set_builder_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;

-- admin_users: add the publisher / super_admin roles alongside admin+editor.
-- Existing rows keep their role; 'admin' keeps full rights (backward compatible).
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'editor',
  created_at timestamptz not null default now()
);
do $$ begin
  -- widen the role check if the old 2-role constraint is still present
  begin
    alter table public.admin_users drop constraint if exists admin_users_role_check;
  exception when others then null; end;
  begin
    alter table public.admin_users drop constraint if exists admin_users_role_check1;
  exception when others then null; end;
end $$;
alter table public.admin_users drop constraint if exists admin_users_role_ucms;
alter table public.admin_users
  add constraint admin_users_role_ucms
  check (role in ('super_admin', 'admin', 'editor', 'publisher'));

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

-- admin or super_admin (full administrative rights)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and role in ('admin', 'super_admin')
  );
$$;

-- super_admin only (user management, backups, audit pruning)
create or replace function public.is_super()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and role = 'super_admin'
  );
$$;

-- may publish/unpublish (publisher, admin, super_admin) — NOT editors
create or replace function public.can_publish()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
      and role in ('publisher', 'admin', 'super_admin')
  );
$$;

-- may change design tokens / global settings (admin, super_admin)
create or replace function public.can_manage_design()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
      and role in ('admin', 'super_admin')
  );
$$;

revoke execute on function public.is_staff()  from public, anon;
revoke execute on function public.is_admin()  from public, anon;
revoke execute on function public.is_super()  from public, anon;
revoke execute on function public.can_publish() from public, anon;
revoke execute on function public.can_manage_design() from public, anon;
grant  execute on function public.is_staff()  to authenticated;
grant  execute on function public.is_admin()  to authenticated;
grant  execute on function public.is_super()  to authenticated;
grant  execute on function public.can_publish() to authenticated;
grant  execute on function public.can_manage_design() to authenticated;

-- ---------------------------------------------------------------------
-- 2. AUDIT LOG — append-only record of administrative operations.
--    No update/delete policy: staff and admins cannot rewrite history.
--    Only the service_role (dashboard) may prune old rows.
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references auth.users (id) on delete set null,
  actor_email    text,
  actor_role     text,
  action         text not null check (action ~ '^[a-z0-9_.:-]{1,80}$'),
  resource_type  text check (resource_type ~ '^[a-z0-9_.-]{1,60}$'),
  resource_id    text,
  resource_label text,
  metadata       jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  outcome        text not null default 'success' check (outcome in ('success', 'error', 'denied')),
  created_at     timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx   on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx  on public.audit_logs (action, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "staff write audit" on public.audit_logs;
drop policy if exists "staff read audit"  on public.audit_logs;
create policy "staff write audit" on public.audit_logs
  for insert to authenticated
  with check ((select public.is_staff()));
create policy "staff read audit" on public.audit_logs
  for select to authenticated
  using ((select public.is_staff()));

-- Central write helper: stamps actor id / email / role server-side.
create or replace function public.log_admin_action(
  p_action        text,
  p_resource_type text default null,
  p_resource_id   text default null,
  p_resource_label text default null,
  p_metadata      jsonb default '{}'::jsonb,
  p_outcome       text default 'success'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_role text; v_email text;
begin
  if not coalesce((select public.is_staff()), false) then
    return null;
  end if;
  if p_action !~ '^[a-z0-9_.:-]{1,80}$'
     or (p_resource_type is not null and p_resource_type !~ '^[a-z0-9_.-]{1,60}$')
     or p_outcome not in ('success', 'error', 'denied')
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) is distinct from 'object'
  then
    raise exception 'Invalid audit log parameters';
  end if;
  select a.role into v_role from public.admin_users a where a.user_id = (select auth.uid());
  -- actor email comes from the JWT claims (never from client input)
  v_email := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');
  insert into public.audit_logs
    (actor_id, actor_email, actor_role, action, resource_type, resource_id,
     resource_label, metadata, outcome)
  values
    ((select auth.uid()), v_email, v_role, p_action, p_resource_type,
     nullif(p_resource_id, ''), nullif(p_resource_label, ''),
     coalesce(p_metadata, '{}'::jsonb), p_outcome)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.log_admin_action(text, text, text, text, jsonb, text)
  from public, anon;
grant execute on function public.log_admin_action(text, text, text, text, jsonb, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 3. NOTIFICATIONS — staff-wide operational alerts.
-- ---------------------------------------------------------------------
create table if not exists public.cms_notifications (
  id         uuid primary key default gen_random_uuid(),
  severity   text not null default 'info' check (severity in ('info', 'warning', 'error', 'success')),
  title      text not null check (length(title) between 1 and 200),
  body       text check (body is null or length(body) <= 2000),
  link       text check (link is null or length(link) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  is_read    boolean not null default false,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cms_notifications_created_idx
  on public.cms_notifications (is_read, created_at desc);

alter table public.cms_notifications enable row level security;

drop policy if exists "staff read notifications"  on public.cms_notifications;
drop policy if exists "staff create notifications" on public.cms_notifications;
drop policy if exists "staff mark notifications"  on public.cms_notifications;
drop policy if exists "admins clean notifications" on public.cms_notifications;
create policy "staff read notifications" on public.cms_notifications
  for select to authenticated using ((select public.is_staff()));
create policy "staff create notifications" on public.cms_notifications
  for insert to authenticated with check ((select public.is_staff()));
-- each staff member may mark items as read
create policy "staff mark notifications" on public.cms_notifications
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
create policy "admins clean notifications" on public.cms_notifications
  for delete to authenticated using ((select public.is_admin()));

create or replace function public.notify_staff(
  p_severity text default 'info',
  p_title    text default '',
  p_body     text default null,
  p_link     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not coalesce((select public.is_staff()), false) then
    return null;
  end if;
  if p_severity not in ('info', 'warning', 'error', 'success')
     or length(coalesce(p_title, '')) not between 1 and 200
  then
    raise exception 'Invalid notification parameters';
  end if;
  insert into public.cms_notifications (severity, title, body, link, created_by)
  values (p_severity, p_title, p_body, p_link, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.notify_staff(text, text, text, text) from public, anon;
grant execute on function public.notify_staff(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. BACKUPS — snapshots of all CMS content as one jsonb manifest.
--    Media (Storage objects) are NOT included; only their URLs inside
--    content records. The manifest records that limitation explicitly.
-- ---------------------------------------------------------------------
create table if not exists public.cms_backups (
  id          uuid primary key default gen_random_uuid(),
  label       text not null check (length(label) between 1 and 120),
  kind        text not null default 'manual' check (kind in ('manual', 'pre_restore', 'scheduled')),
  manifest    jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  stats       jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists cms_backups_created_idx on public.cms_backups (created_at desc);

alter table public.cms_backups enable row level security;

drop policy if exists "admins read backups"   on public.cms_backups;
drop policy if exists "admins create backups" on public.cms_backups;
create policy "admins read backups" on public.cms_backups
  for select to authenticated using ((select public.is_admin()));
create policy "admins create backups" on public.cms_backups
  for insert to authenticated with check ((select public.is_admin()));

-- Creates one full CMS-content snapshot (admin only, server-side).
create or replace function public.create_cms_backup(p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_manifest jsonb;
  v_stats jsonb;
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'Only administrators can create backups';
  end if;
  if length(coalesce(p_label, 'Backup')) > 120 then
    raise exception 'Backup label too long';
  end if;

  select jsonb_build_object(
    'schema_version', 5,
    'includes_media_files', false,
    'site_texts',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.site_texts t),
    'page_sections', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.page_sections s),
    'site_settings', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.site_settings s),
    'committees',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.committees c),
    'faqs',          (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.faqs f),
    'applications',  (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.applications a),
    'sponsors',      (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.sponsors s),
    'team_tabs',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.team_tabs t),
    'team_groups',   (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from public.team_groups g),
    'team_members',  (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.team_members m),
    'team_placements', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.team_placements p),
    'builder_projects', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.builder_projects p),
    'builder_project_pages', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.builder_project_pages p),
    'builder_project_navigation', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.builder_project_navigation n),
    'builder_editor_documents', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.builder_editor_documents d),
    'builder_project_components', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.builder_project_components c),
    'builder_project_custom_code', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.builder_project_custom_code c),
    'builder_project_heroes', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.builder_project_heroes h),
    'builder_project_responsive', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.builder_project_responsive r),
    'backed_up_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) into v_manifest;

  select jsonb_build_object(
    'site_texts',    (select count(*) from public.site_texts),
    'page_sections', (select count(*) from public.page_sections),
    'site_settings', (select count(*) from public.site_settings),
    'committees',    (select count(*) from public.committees),
    'faqs',          (select count(*) from public.faqs),
    'applications',  (select count(*) from public.applications),
    'sponsors',      (select count(*) from public.sponsors),
    'team_tabs',     (select count(*) from public.team_tabs),
    'team_groups',   (select count(*) from public.team_groups),
    'team_members',  (select count(*) from public.team_members),
    'team_placements', (select count(*) from public.team_placements),
    'builder_pages', (select count(*) from public.builder_project_pages),
    'builder_documents', (select count(*) from public.builder_editor_documents)
  ) into v_stats;

  insert into public.cms_backups (label, kind, manifest, stats, created_by)
  values (coalesce(nullif(trim(p_label), ''),
                   'Backup ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI')),
          'manual', v_manifest, v_stats, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_cms_backup(text) from public, anon;
grant execute on function public.create_cms_backup(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. PAGE TEMPLATES — GDF-branded starting points for new pages.
--    Applying a template always CREATES a new page; it never overwrites
--    an existing page or its document.
-- ---------------------------------------------------------------------
create table if not exists public.builder_page_templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  name        jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb check (description is null or jsonb_typeof(description) = 'object'),
  html        text not null default '',
  css         text not null default '',
  sort_order  integer not null default 0,
  is_published boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists builder_page_templates_order_idx
  on public.builder_page_templates (sort_order);

drop trigger if exists trg_builder_page_templates_updated on public.builder_page_templates;
create trigger trg_builder_page_templates_updated
before update on public.builder_page_templates
for each row execute function public.set_builder_updated_at();

alter table public.builder_page_templates enable row level security;

drop policy if exists "staff read templates"   on public.builder_page_templates;
drop policy if exists "admins manage templates" on public.builder_page_templates;
create policy "staff read templates" on public.builder_page_templates
  for select to authenticated using ((select public.is_staff()));
create policy "admins manage templates" on public.builder_page_templates
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.builder_page_templates to authenticated;
grant insert, update, delete on public.builder_page_templates to authenticated;

insert into public.builder_page_templates
  (slug, name, description, html, css, sort_order) values
  ('content-page',
   '{"en":"Standard content page","ar":"صفحة محتوى قياسية","tr":"Standart içerik sayfası"}'::jsonb,
   '{"en":"Page title, intro paragraph and two text sections in the GDF identity.",
     "ar":"عنوان صفحة ومقدمة وقسمان نصيان بهوية GDF.",
     "tr":"GDF kimliğiyle sayfa başlığı, giriş paragrafı ve iki metin bölümü."}'::jsonb,
   '<section class="gdf-tpl-hero"><div class="gdf-tpl-wrap"><p class="gdf-tpl-kicker">GDF&#x27;27</p><h1>Page title</h1><p class="gdf-tpl-lead">Short introduction to this page.</p></div></section><section class="gdf-tpl-section"><div class="gdf-tpl-wrap"><h2>Section heading</h2><p>Write the section text here. Keep paragraphs short and use the GDF maroon and gold accents for emphasis.</p></div></section><section class="gdf-tpl-section alt"><div class="gdf-tpl-wrap"><h2>Second section</h2><p>Additional content.</p></div></section>',
   '.gdf-tpl-hero{background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:72px 24px}.gdf-tpl-wrap{max-width:960px;margin:0 auto}.gdf-tpl-kicker{color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px}.gdf-tpl-hero h1{font-family:Georgia,serif;font-size:clamp(30px,5vw,52px);margin:0 0 12px}.gdf-tpl-lead{font-size:18px;opacity:.9;max-width:640px}.gdf-tpl-section{padding:56px 24px}.gdf-tpl-section.alt{background:#f1e8d1}.gdf-tpl-section h2{color:#081a37;font-family:Georgia,serif;font-size:clamp(22px,3vw,32px);margin:0 0 14px}.gdf-tpl-section p{color:#3d3a33;line-height:1.7;max-width:720px}',
   0),
  ('about-page',
   '{"en":"About page","ar":"صفحة من نحن","tr":"Hakkımızda sayfası"}'::jsonb,
   '{"en":"Mission, vision and partner blocks arranged like the GDF About page.",
     "ar":"مهمة ورؤية وشرائح شركاء بتنسيق صفحة من نحن في GDF.",
     "tr":"GDF Hakkımızda sayfası düzeninde misyon, vizyon ve partner blokları."}'::jsonb,
   '<section class="gdf-tpl-hero"><div class="gdf-tpl-wrap"><p class="gdf-tpl-kicker">About</p><h1>About the forum</h1><p class="gdf-tpl-lead">Who we are and why GDF&#x27;27 exists.</p></div></section><section class="gdf-tpl-section"><div class="gdf-tpl-wrap gdf-tpl-cols"><div><h2>Vision</h2><p>Vision text.</p></div><div><h2>Mission</h2><p>Mission text.</p></div></div></section><section class="gdf-tpl-section alt"><div class="gdf-tpl-wrap"><h2>Partners</h2><div class="gdf-tpl-cards"><div class="gdf-tpl-card"><h3>Partner one</h3><p>Short description.</p></div><div class="gdf-tpl-card"><h3>Partner two</h3><p>Short description.</p></div></div></div></section>',
   '.gdf-tpl-hero{background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:72px 24px}.gdf-tpl-wrap{max-width:960px;margin:0 auto}.gdf-tpl-kicker{color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px}.gdf-tpl-hero h1{font-family:Georgia,serif;font-size:clamp(30px,5vw,52px);margin:0 0 12px}.gdf-tpl-lead{font-size:18px;opacity:.9}.gdf-tpl-section{padding:56px 24px}.gdf-tpl-section.alt{background:#f1e8d1}.gdf-tpl-section h2{color:#081a37;font-family:Georgia,serif;margin:0 0 14px}.gdf-tpl-section p{color:#3d3a33;line-height:1.7}.gdf-tpl-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:28px}.gdf-tpl-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}.gdf-tpl-card{background:#fff;border:1px solid #e5d9bd;border-radius:14px;padding:22px}',
   1),
  ('team-page',
   '{"en":"Team page","ar":"صفحة الفريق","tr":"Ekip sayfası"}'::jsonb,
   '{"en":"Hero plus member card grid with photo, name and role.",
     "ar":"قسم علوي وشبكة بطاقات أعضاء بالصورة والاسم والدور.",
     "tr":"Kahraman bölümü ve fotoğraf, isim, rol içeren üye kartları."}'::jsonb,
   '<section class="gdf-tpl-hero"><div class="gdf-tpl-wrap"><p class="gdf-tpl-kicker">Team</p><h1>Meet the team</h1><p class="gdf-tpl-lead">The people behind GDF&#x27;27.</p></div></section><section class="gdf-tpl-section"><div class="gdf-tpl-wrap"><h2>Presidency</h2><div class="gdf-tpl-cards"><div class="gdf-tpl-card gdf-tpl-person"><div class="gdf-tpl-avatar"></div><h3>Full name</h3><p class="gdf-tpl-role">Role</p><p>Short biography.</p></div><div class="gdf-tpl-card gdf-tpl-person"><div class="gdf-tpl-avatar"></div><h3>Full name</h3><p class="gdf-tpl-role">Role</p><p>Short biography.</p></div></div></div></section>',
   '.gdf-tpl-hero{background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:72px 24px}.gdf-tpl-wrap{max-width:960px;margin:0 auto}.gdf-tpl-kicker{color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px}.gdf-tpl-hero h1{font-family:Georgia,serif;font-size:clamp(30px,5vw,52px);margin:0 0 12px}.gdf-tpl-lead{font-size:18px;opacity:.9}.gdf-tpl-section{padding:56px 24px}.gdf-tpl-section h2{color:#081a37;font-family:Georgia,serif;margin:0 0 20px}.gdf-tpl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:20px}.gdf-tpl-card{background:#fff;border:1px solid #e5d9bd;border-radius:14px;padding:22px;text-align:center}.gdf-tpl-avatar{width:84px;height:84px;border-radius:50%;background:#d9c48f;margin:0 auto 14px}.gdf-tpl-card h3{margin:0 0 4px;color:#081a37}.gdf-tpl-role{color:#8a6d1f;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}.gdf-tpl-card p{color:#3d3a33;font-size:14px;line-height:1.6}',
   2),
  ('committee-page',
   '{"en":"Committee page","ar":"صفحة لجنة","tr":"Komite sayfası"}'::jsonb,
   '{"en":"Committee hero, agenda topics and study-guide block.",
     "ar":"قسم علوي للجنة وموضوعات جدول الأعمال ودليل الدراسة.",
     "tr":"Komite kahramanı, gündem konuları ve çalışma rehberi bloğu."}'::jsonb,
   '<section class="gdf-tpl-hero"><div class="gdf-tpl-wrap"><p class="gdf-tpl-kicker">Committee</p><h1>Committee name</h1><p class="gdf-tpl-lead">One-line committee description.</p></div></section><section class="gdf-tpl-section"><div class="gdf-tpl-wrap"><h2>About the committee</h2><p>Describe the committee, its mandate and what delegates will debate.</p><ul><li>Topic 1</li><li>Topic 2</li></ul></div></section><section class="gdf-tpl-section alt"><div class="gdf-tpl-wrap"><h2>Study guide</h2><p>Link the study guide document here.</p><a class="gdf-tpl-btn" href="#">Download</a></div></section>',
   '.gdf-tpl-hero{background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:72px 24px}.gdf-tpl-wrap{max-width:960px;margin:0 auto}.gdf-tpl-kicker{color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px}.gdf-tpl-hero h1{font-family:Georgia,serif;font-size:clamp(30px,5vw,52px);margin:0 0 12px}.gdf-tpl-lead{font-size:18px;opacity:.9}.gdf-tpl-section{padding:56px 24px}.gdf-tpl-section.alt{background:#f1e8d1}.gdf-tpl-section h2{color:#081a37;font-family:Georgia,serif;margin:0 0 14px}.gdf-tpl-section p,.gdf-tpl-section li{color:#3d3a33;line-height:1.7}.gdf-tpl-btn{display:inline-block;background:#c9a44c;color:#081a37;padding:12px 22px;border-radius:999px;font-weight:600;text-decoration:none}',
   3),
  ('faq-page',
   '{"en":"FAQ page","ar":"صفحة الأسئلة","tr":"SSS sayfası"}'::jsonb,
   '{"en":"Question list using native details/summary accordions.",
     "ar":"قائمة أسئلة باستخدام عناصر التفاصيل القابلة للطي.",
     "tr":"Yerli details/summary akordeonlarıyla soru listesi."}'::jsonb,
   '<section class="gdf-tpl-hero"><div class="gdf-tpl-wrap"><p class="gdf-tpl-kicker">FAQ</p><h1>Frequently asked questions</h1></div></section><section class="gdf-tpl-section"><div class="gdf-tpl-wrap"><details class="gdf-tpl-faq"><summary>Question one?</summary><p>Answer one.</p></details><details class="gdf-tpl-faq"><summary>Question two?</summary><p>Answer two.</p></details></div></section>',
   '.gdf-tpl-hero{background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:72px 24px}.gdf-tpl-wrap{max-width:820px;margin:0 auto}.gdf-tpl-kicker{color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px}.gdf-tpl-hero h1{font-family:Georgia,serif;font-size:clamp(28px,4vw,44px);margin:0}.gdf-tpl-section{padding:48px 24px}.gdf-tpl-faq{border:1px solid #e5d9bd;border-radius:12px;background:#fff;margin:0 0 12px;padding:16px 20px}.gdf-tpl-faq summary{cursor:pointer;font-weight:600;color:#081a37}.gdf-tpl-faq p{color:#3d3a33;line-height:1.7;margin:10px 0 0}',
   4),
  ('landing-page',
   '{"en":"Landing page","ar":"صفحة هبوط","tr":"Açılış sayfası"}'::jsonb,
   '{"en":"Hero with call-to-action buttons, statistics row and sponsor strip.",
     "ar":"قسم علوي بأزرار دعوة وصف إحصاءات وشريط رعاة.",
     "tr":"Harekete geçirici düğmeleri, istatistik satırı ve sponsor şeridi olan açılış."}'::jsonb,
   '<section class="gdf-tpl-hero"><div class="gdf-tpl-wrap"><p class="gdf-tpl-kicker">GDF&#x27;27</p><h1>Big campaign headline</h1><p class="gdf-tpl-lead">One sentence that explains the campaign.</p><div class="gdf-tpl-actions"><a class="gdf-tpl-btn" href="#">Primary action</a><a class="gdf-tpl-btn ghost" href="#">Secondary</a></div></div></section><section class="gdf-tpl-section"><div class="gdf-tpl-wrap gdf-tpl-stats"><div><b>300+</b><span>Delegates</span></div><div><b>6</b><span>Committees</span></div><div><b>3</b><span>Days</span></div><div><b>1</b><span>Forum</span></div></div></section><section class="gdf-tpl-section alt"><div class="gdf-tpl-wrap"><h2>Call for action</h2><p>Final persuasive paragraph.</p></div></section>',
   '.gdf-tpl-hero{background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:96px 24px;text-align:center}.gdf-tpl-wrap{max-width:960px;margin:0 auto}.gdf-tpl-kicker{color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px}.gdf-tpl-hero h1{font-family:Georgia,serif;font-size:clamp(32px,6vw,58px);margin:0 0 12px}.gdf-tpl-lead{font-size:18px;opacity:.9}.gdf-tpl-actions{display:flex;gap:14px;justify-content:center;margin-top:26px;flex-wrap:wrap}.gdf-tpl-btn{display:inline-block;background:#c9a44c;color:#081a37;padding:13px 26px;border-radius:999px;font-weight:600;text-decoration:none}.gdf-tpl-btn.ghost{background:transparent;border:1px solid #d9c48f;color:#f5efe0}.gdf-tpl-section{padding:56px 24px}.gdf-tpl-section.alt{background:#f1e8d1}.gdf-tpl-section h2{color:#081a37;font-family:Georgia,serif;margin:0 0 14px}.gdf-tpl-section p{color:#3d3a33;line-height:1.7}.gdf-tpl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:18px;text-align:center}.gdf-tpl-stats b{display:block;font-size:34px;color:#081a37;font-family:Georgia,serif}.gdf-tpl-stats span{color:#8a6d1f;font-size:13px;text-transform:uppercase;letter-spacing:.1em}',
   5)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 6. PUBLISHING PERMISSIONS — publishing and releasing are restricted to
--    publisher / admin / super_admin. Editors keep draft + restore rights.
-- ---------------------------------------------------------------------
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

  if not (select public.can_publish()) then
    raise exception 'Publishing requires the publisher, admin or super_admin role';
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

-- storage: re-assert the safe image-only allowlist (SVG can carry scripts;
-- an older upgrade script once added image/svg+xml).
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 5242880
 where id = 'site-media';

notify pgrst, 'reload schema';
-- =====================================================================
-- DONE. New tables: audit_logs, cms_notifications, cms_backups,
-- builder_page_templates. New roles: publisher, super_admin.
-- =====================================================================
