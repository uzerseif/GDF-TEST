# GDF'27 — Content Studio upgrade: changed files & database changes

## Builder Studio Phase 1

The foundation now includes a private multi-project dashboard entry point.

- Added `builder-migration-v1.sql` for project, project settings, project pages and project asset records.
- Added GDF'27 as the first registered project.
- Added project create, edit, duplicate, archive/restore and confirmed delete actions.
- GDF'27 is protected from deletion while existing CMS functionality remains the source of truth.
- Future projects are clearly marked until their visual editor is implemented.

## Builder Studio Phase 2

- Added `builder-migration-v2.sql` for editor documents, reusable components and revisions.
- Added a pinned GrapesJS visual editor in the admin dashboard.
- Added desktop, tablet and mobile canvas devices.
- Added blocks, layers, styles, traits, undo and redo.
- Added draft save, revision creation, preview and published-document status.
- Added reusable component storage.
- GDF'27 visual documents remain draft data and do not replace existing public pages until a later publishing phase.

## Builder Studio Phase 3

- Added project pages manager with create, edit, delete, publication and ordering controls.
- Added project header and footer navigation managers.
- Added project header/footer settings: logo, name visibility and colours.
- Added project design-token management for colours, fonts, radius and spacing.
- GDF'27 public content remains served by the existing CMS; Builder management records are isolated.

## Builder Studio Phase 4

- Added project-scoped media upload and asset records.
- Added hero and background management for Builder pages.
- Added desktop, tablet and mobile responsive-style records.
- Added project asset copy and delete controls.
- GrapesJS canvas devices remain available in the visual editor.

## Builder Studio Phase 5

- Added CodeMirror HTML, CSS and JavaScript editors.
- Added project custom-code records with legacy/custom-code protection.
- Added HTML and ZIP import staging.
- Added ZIP/JSON project export.
- Added import/export archive history.

## Builder Studio Phase 6

- Added publish and unpublish controls for Builder documents.
- Added atomic publish snapshots in `builder_project_releases`.
- Added revision history and confirmed restore.
- Restores create a backup revision of the current document first.
- Public GDF'27 content remains independent until a separate deployment integration is approved.

## GDF'27 Integration and Final QA — Phases 7 and 8

- Added a certificate RPC parameter correction in `verify-common.js`.
- Added protected GDF'27 integration records for CMS, applications, committees, team, FAQ, sponsors, verification and certificates.
- Added static GDF'27 public-page checks in the admin dashboard.
- Added persisted Builder test-run history.
- Live Supabase, browser, public-route and certificate tests remain explicitly pending.

## Integrity hardening

- Finalized GDF'27 `is_system` status on rerun.
- Added project/page cross-reference triggers for visual documents, revisions, heroes and releases.
- Fixed CodeMirror initialization timing.
- Added duplicate and delete controls to the GrapesJS toolbar.
- Added responsive JSON-to-media-query rendering in the visual canvas.

## New files
| File | Purpose |
|---|---|
| `cms-migration-v4.sql` | Database migration for the new CMS. Safe to run more than once and adds without deleting (see below). |
| `cms-config.js` | Supabase URL + **publishable** key, shared by the public site and the admin. |
| `cms-boot.js` | Runs in `<head>`. Applies design tokens and hidden sections from the browser cache before the first paint. |
| `cms-defaults.js` | The original English texts of the site (generated from the HTML). The admin uses them to pre-fill forms, as fallbacks, and for "Reset to original". |
| `admin-i18n.js` | Dashboard interface strings in English, Arabic and Turkish. |
| `admin-pages.js` | Dashboard pages: Header, Homepage, President, Applications, About, Team, Footer, Sponsors, Committees, FAQ, All texts, Design, Media. |
| `CMS-SETUP.md` | Setup, deployment and usage guide. |
| `CHANGES.md` | This file. |
| `TESTING.md` | Test results. |

## Rewritten files
| File | Change |
|---|---|
| `admin.html`, `admin.css`, `admin.js` | New premium dark dashboard: sidebar, EN/AR/TR with RTL, toasts, dialogs, unsaved-changes guard, uploader with drag & drop and progress, drag-and-drop ordering, live preview. **News & Updates removed.** |
| `cms-public.js` | Applies every CMS area to the public pages: texts, header, footer, hero, president, venue, sponsors, applications, About, team (tabs built from the DB), section order and visibility, theme. Includes caching and preview mode, and keeps the original content as fallback. |

## Modified files
| File | Change |
|---|---|
| `i18n.js` | Uses CMS text overrides (`window.GDF_CMS_TEXTS`) before the built-in translations, cleans rich text, and adds `GDF_i18n_refresh()`. |
| `script.js` | The countdown target comes from `site_settings.event.start`. The default is still 20 March 2027, 09:00 (UTC+3). |
| `our-team.js` | Picks up tabs and panels again after the CMS rebuilds them (`gdf:team-rendered`). |
| `style.css` | A small appended block of styles for the optional CMS elements: venue photo, signature, section images, unit images, photo-right layout. Existing rules were not changed. |
| All 11 public HTML pages | Load `cms-config.js` + `cms-boot.js`, and also the Supabase SDK + `cms-public.js` on pages that lacked them. They gain `data-cms` / `data-cms-section` hooks and `data-i18n` keys for the brand name and the hero year. No visible content was removed. |
| `index.html` | Closed the `venue` section before `sponsors`. The sponsors section was accidentally nested inside the venue section, which made separate ordering and hiding impossible. |
| `CMS-SETUP.txt` | Now points to `CMS-SETUP.md`. |
| `README.txt` | One line added at the top pointing to the new docs. |

Unchanged: every image, video, vendor file, certificate and verification file, `translations.js`, page CSS files, and the older SQL files (`cms-schema.sql`, `cms-admin-upgrade.sql`, `seed-gdf.sql`, `supabase-migration.sql`).

## Database changes (`cms-migration-v4.sql`)
Nothing is dropped or deleted, and existing rows are kept.

**Fix for `column team_members.sort_order does not exist`:** the original table was created before this column existed, and `create table if not exists` never adds columns to an existing table. The migration runs `alter table … add column if not exists sort_order integer not null default 0` and adds an index. Your live database already has the column, so this step does nothing there.

| Object | Change |
|---|---|
| `team_members` | + `social jsonb` (Instagram/LinkedIn/X/website/email). Also makes sure `sort_order`, `is_published`, `bio`, `photo_url` and `updated_at` exist. |
| `team_tabs` | + `description jsonb` (EN/AR/TR). Also makes sure `sort_order`, `is_published` and `updated_at` exist. |
| `team_groups` (new) | Groups and units inside a tab: `tab_id → team_tabs`, `title`, `description`, `image_url`, `sort_order`, `is_published`. Filled automatically from the existing `team_placements.group_no/group_title`. |
| `team_placements` | + `group_id → team_groups (on delete set null)`. Existing placements are linked to their back-filled group. |
| `applications` | + `image_url`, + `button_label jsonb`, + `updated_at` |
| `sponsors` | + `tier`, + `updated_at`. The fixed `category in (sponsor, partner, media)` check is replaced by a slug-format check, so categories can be managed from the admin. Existing values still pass. |
| `site_texts` (new) | `key` (the existing `data-i18n` key) → `value {en,ar,tr}`, `is_html`. Overrides any text on the site. |
| `page_sections` (new) | `(page, section_key)` unique, plus `sort_order`, `is_visible`, `settings jsonb` (images, links, colours, layout, lists). |
| `site_settings` | Seeds `event.start` (countdown) and `theme.tokens` (design) only if they are missing (`on conflict do nothing`). |
| Triggers | `updated_at` triggers on the new and changed tables. |
| RLS | `team_groups`: public reads published rows, staff manage. `site_texts` and `page_sections`: public read, staff manage. `site_settings`: public read, **admin**-only write. `admin_users`: each user reads their own row, admins manage. |
| Storage | `site-media` bucket: public, 5 MB, JPG/PNG/WebP only. Only staff can list, upload, update or delete. |
| Helpers | `is_i18n_loose()` added. `is_i18n`, `is_staff`, `is_admin` and `set_updated_at` are re-created idempotently. |

## UCMS transformation — 2026-11-19

Full audit + refactor + security hardening + new administrative surfaces. Details in REPORT.md.

### Architecture
- Split the 2,103-line `admin-pages.js` monolith into `admin/pages-shared.js`,
  `pages-dashboard.js`, `pages-website.js`, `pages-content.js`, `pages-builder.js`,
  `pages-system.js`, `ucms-core.js` and `boot.js`; `admin.js` keeps the proven core
  (guarded Supabase client, save-state save bars, new nav groups, breadcrumbs,
  collapsible + searchable sidebar categories).
- Removed the dead `package-lock.json`.

### Database (cms-migration-v5.sql, additive/idempotent)
- Roles: `publisher` and `super_admin` added next to `admin`/`editor`; `can_publish()`
  guards `publish_builder_document` (editors can no longer publish — server-side).
- New: `audit_logs` (append-only RLS) + `log_admin_action`, `cms_notifications` +
  `notify_staff`, `cms_backups` + `create_cms_backup`, `builder_page_templates`
  (+ 6 seeded GDF-branded templates).
- Storage allowlist re-asserted to JPEG/PNG/WebP (an old upgrade script had allowed SVG).

### Security
- Visual-editor previews moved from same-origin `blob:` URLs to fully sandboxed
  iframes (`sandbox=""`, srcdoc, no scripts) — documents can no longer reach admin
  session storage. Audit: fixed a real credential-exposure hole.
- `@supabase/supabase-js` pinned to 2.49.4 across all 22 HTML pages (was floating `@2`).
- Admin boot shows a clear dependency-error screen if a CDN library fails.
- Every content write, publish, media operation, role change, backup and restore is
  written to the append-only audit log.

### New UCMS surfaces
Dashboard (real stats/activity/health/projects), Website Health page, unified Pages
manager (content + visual editor + publish + revisions per page), SEO manager (per-page
metadata, live search-preview, applied to public pages by cms-public.js), Global Website
Settings editor, Translations coverage page, Reusable Components manager, Page Templates
manager (apply always creates a new page), Users & Roles, Permissions matrix, Audit Logs
(filters + pagination), Media Library (per-file usage from 15 reference sources, Unknown
state on failed checks, rename/replace with reference rewrite, deletion blocked while
referenced), Backups & Restore (safety checkpoint before restore), Notifications (bell +
page), global search (Ctrl/⌘+K).

### Editing workflow
- Visual editor: autosave (4 s debounce, draft-only), explicit revision snapshots,
  publish creates release via RPC, GDF-branded blocks, component save via modal,
  target-page deep links from the Pages manager.
- Save bars show Saving… / Saved HH:MM / Save failed / Offline states everywhere.

### Docs
New README.md, ARCHITECTURE.md, DATABASE.md, UCMS-GUIDE.md, BUILDER-GUIDE.md,
SECURITY.md, DEPLOYMENT.md, MIGRATIONS.md, REPORT.md; TESTING.md and CMS-SETUP.md updated.
