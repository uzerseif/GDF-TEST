# MIGRATIONS — run order & contents

Run every file in the Supabase SQL Editor, top to bottom. All files except
`seed-gdf.sql` are idempotent and safe to re-run.

| # | File | Adds | Notes |
|---|---|---|---|
| a | `cms-schema.sql` | Base CMS: helpers (`is_i18n`, `set_updated_at`), `admin_users` (admin/editor), `is_staff`/`is_admin`, `site_settings`, content tables (committees, team_*, sponsors, faqs, applications, news), triggers, RLS, `site-media` bucket (2 MB at this point), seed settings | Skip if the base CMS is already installed (live project) |
| b | `cms-admin-upgrade.sql` | `team_members.sort_order`, bucket upsert | Historical; harmless to re-run |
| c | `seed-gdf.sql` | GDF'27 content | **New/empty projects only — never re-run** |
| d | `cms-migration-v4.sql` | Full CMS: team_groups + back-fill, applications/sponsors columns, `site_texts`, `page_sections`, bucket → 5 MB + image-only allowlist, RLS for new tables, seed `event.start`/`theme.tokens` | Required for the Content Studio |
| e | `builder-migration-v1.sql` | `builder_projects` (+ settings/pages/assets), `can_manage_builder_project`, project protection trigger, `duplicate_builder_project`, GDF'27 registered as system project | |
| f | `builder-migration-v2.sql` | `builder_editor_documents`, `builder_project_components`, `builder_project_revisions` | |
| g | `builder-migration-v3.sql` | `builder_project_navigation`, system-page protection | |
| h | `builder-migration-v4.sql` | `builder_project_heroes`, `builder_project_responsive` | |
| i | `builder-migration-v5.sql` | `builder_project_custom_code`, `builder_project_archives` | |
| j | `builder-migration-v6.sql` | `builder_project_releases`, `publish_builder_document`, `restore_builder_revision` | |
| k | `builder-migration-v7.sql` | `builder_project_integrations` + protected GDF'27 integration records | |
| l | `builder-migration-v8.sql` | `builder_project_test_runs` | |
| m | `builder-migration-v9.sql` | Cross-project reference triggers (documents, revisions, heroes, releases), `is_system` finalisation | |
| n | **`cms-migration-v5.sql`** | **UCMS**: roles `publisher`/`super_admin` (check widened), `is_super`/`can_publish`/`can_manage_design`, `audit_logs` (append-only RLS) + `log_admin_action`, `cms_notifications` + `notify_staff`, `cms_backups` + `create_cms_backup`, `builder_page_templates` (+ 6 seeded GDF templates), `publish_builder_document` re-issued with `can_publish()` check, storage allowlist re-asserted (no SVG) | **Required for the UCMS** |

## Migration principles

- Additive only: `create table if not exists`, `add column if not exists`,
  `create or replace function`. No `drop table`, no `delete`, no data loss.
- RLS is enabled on every new table with explicit policies; helpers are
  `security definer` with `set search_path = ''`.
- `notify pgrst, 'reload schema'` after schema changes so PostgREST picks up
  new tables immediately.
- The role check is widened (not replaced): existing `admin`/`editor` rows
  keep working unchanged; `admin` retains full rights; `super_admin` is a
  distinct role for future pruning/maintenance tasks.

## Rollback strategy

Migrations are reversible in principle (drop the objects they add) but no
down-migrations ship with the project: restoring requires the backup system
instead (`UCMS → Backups`, `create_cms_backup`). Every restore creates a
pre-restore checkpoint automatically. Take a manual backup before applying a
migration on the live project if you want an extra guarantee.
