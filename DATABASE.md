# DATABASE — GDF'27 main Supabase project

All objects live in schema `public`. Migrations are additive and idempotent —
see MIGRATIONS.md for the run order. The certificate service uses a separate
Supabase project (see cms-config.js / verify-common.js).

## 1. Identity & access

| Table | Purpose | Key rules |
|---|---|---|
| `admin_users` | Staff directory: `user_id → auth.users`, `role` | RLS: users read only their own row; admins manage all. Role ∈ `super_admin, admin, publisher, editor` (v5 widened the check). |
| helper `is_staff()` | any row in `admin_users` | security definer, empty search_path — no recursion, no hijack |
| helper `is_admin()` | role in (admin, super_admin) | idem |
| helper `is_super()` | role = super_admin | idem (reserved for future pruning tasks) |
| helper `can_publish()` | role in (publisher, admin, super_admin) | used by `publish_builder_document` |
| helper `can_manage_design()` | role in (admin, super_admin) | reserved; design tokens additionally guarded by `site_settings` admin policy |

## 2. Public content (visitors read published rows; staff manage)

| Table | Purpose |
|---|---|
| `committees` | Committee cards + detail pages (slug unique, i18n jsonb fields) |
| `team_tabs` / `team_groups` / `team_members` / `team_placements` | Team page structure: tabs, units/groups, members, per-tab placements with row numbers |
| `sponsors` | Logo grid; `category` is a free slug (labels live in `page_sections home/sponsors.settings.categories`) |
| `faqs` | FAQ items with optional action link |
| `applications` | Application forms: i18n title/description/button, `form_url` (https check), open/close timestamps, image |
| `news` | Present from the original schema; unused by the current site (kept, not deleted) |

## 3. CMS core

| Table | Purpose | RLS |
|---|---|---|
| `site_texts` | `key` (data-i18n key) → `{en,ar,tr}` overrides; `is_html` flag | public read, staff write |
| `page_sections` | `(page, section_key)` unique rows: `sort_order`, `is_visible`, `settings jsonb` (images, links, colours, lists) | public read, staff write |
| `site_settings` | key/value jsonb: `event.start`, `theme.tokens`, `seo.<page>`, branding | public read, **admin-only** write |

## 4. Builder Studio (multi-project)

| Table | Purpose |
|---|---|
| `builder_projects` | Registered websites; GDF'27 is `is_system` and protected (trigger: cannot delete/rename identity fields) |
| `builder_project_settings` | Per-project key/value (design tokens, header/footer settings) |
| `builder_project_pages` | Page records (slug unique per project, `page_type legacy|visual|custom`, `is_home`, `is_published`) |
| `builder_editor_documents` | One GrapesJS document per `(project, page)`: html/css/javascript/assets + status |
| `builder_project_revisions` | Revision snapshots (label, html/css/js/assets, `created_by`) |
| `builder_project_releases` | Publish snapshots (manifest jsonb, `published_by`) |
| `builder_project_components` | Reusable components (html/css/js, availability flag) |
| `builder_project_navigation` | Header/footer link records per project |
| `builder_project_heroes` | Per-page hero/background settings |
| `builder_project_responsive` | Selector → desktop/tablet/mobile style JSON |
| `builder_project_custom_code` | Head/page/footer code slots (legacy flag; never auto-applied to the live site) |
| `builder_project_assets` | Registered media uploads per project |
| `builder_project_archives` | Import/export history |
| `builder_project_integrations` | Protected legacy integration records (CMS, applications, …) |
| `builder_project_test_runs` | Static-check history |
| `builder_page_templates` | **(v5)** GDF-branded page templates (seeded: content, about, team, committee, FAQ, landing) |

Cross-project integrity (v9 + v5): triggers ensure a document/revision/hero/
release always belongs to the same project (and page) as its parent.

## 5. UCMS system tables (v5)

| Table | Purpose | RLS |
|---|---|---|
| `audit_logs` | Append-only: actor id/email/role, action, resource, metadata, outcome | staff insert (via `log_admin_action`), staff read, **no update/delete policy** → immutable from the dashboard |
| `cms_notifications` | Operational alerts (severity, title, body, link, read state) | staff read/create/update (mark read); admins delete |
| `cms_backups` | Content snapshots (`kind: manual|pre_restore`, manifest jsonb, stats) | **admin-only** read/insert |

### RPCs (v5)

| Function | Purpose | Permission |
|---|---|---|
| `log_admin_action(action, resource_type, resource_id, resource_label, metadata, outcome)` | stamps actor server-side (JWT email), validates shape | staff |
| `notify_staff(severity, title, body, link)` | creates a staff-wide notification | staff |
| `create_cms_backup(label)` | snapshots every content table into one manifest | **admin** |
| `publish_builder_document(document_id, label)` | v5 re-issue: adds `can_publish()` check — editors get a clear error | publisher/admin/super_admin |
| `restore_builder_revision(revision_id)` | creates "Before restore" backup revision, applies the selected revision as draft | project managers (staff for GDF'27) |
| `duplicate_builder_project(source, slug, name)` | full project copy (pages/settings/assets, documents as draft) | project managers |

## 6. Storage

Bucket `site-media` — public, 5 MB limit, **`image/jpeg`, `image/png`,
`image/webp` only** (SVG is deliberately excluded: SVG can carry scripts;
v5 re-asserts the allowlist because an older upgrade script once added
`image/svg+xml`). Anyone can view files by URL; only staff can list, upload,
update or delete (four storage policies keyed on `is_staff()`).

## 7. Indexes & performance notes

- `audit_logs`: created_at desc, (actor_id, created_at desc), (action, created_at desc)
- `cms_notifications`: (is_read, created_at desc)
- `team_placements`: (tab_id, group_no, row_no, sort_order), (member_id), (group_id, sort_order)
- `builder_*`: project_id + ordering indexes per table
- List endpoints paginate in the UI (audit logs: 25 rows per page with "load more";
  media storage walk paginates at the 1000-object list cap).

## 8. Known limitations

- `auth.users.email` is not readable by the anon key; audit logs carry the
  actor email from the JWT claims at write time instead.
- "Last sign-in" for users is **not** exposed to the dashboard (auth service
  column, service-role only) — the Users page says so explicitly.
- Backup manifests include media **URLs**, not media objects — Storage
  contents are not copied (documented in the manifest itself:
  `includes_media_files: false`).
