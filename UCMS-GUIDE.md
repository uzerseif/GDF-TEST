# UCMS-GUIDE — using the admin dashboard

Open `/admin/` (or `/admin.html`) and sign in. The EN / AR / TR pills switch
the dashboard interface language (RTL is applied for Arabic); this is
independent of the public site's language. Press **Ctrl/⌘ + K** for global
search across pages, website texts, content records and media.

## Roles at a glance

| Role | Can do |
|---|---|
| Super Admin | everything |
| Admin | all content, design, publishing, users, backups |
| Publisher | content + media + publishing, no user/design/backup rights |
| Editor | content + media + drafts; publishing is blocked (server-enforced) |

Your role is shown under the sidebar. Buttons you may not use are hidden —
and the same rules are enforced again by the database, so the UI is only a
mirror, never the gate.

## Overview

- **Dashboard** — live statistics (pages published/draft, media assets, team,
  sponsors, committees, applications, FAQs, edited texts, revisions,
  releases), the latest audit-log entries, a website-health summary and the
  project strip. Quick actions: Create Page, Edit Homepage, Upload Media,
  Visual Editor, Preview Website, Manage Users.
- **Website Health** — real checks, each labelled Healthy / Warning / Error /
  Unknown: authentication, database latency, storage bucket, required
  libraries, migrations (CMS + Builder + v5), publishing status, recent
  errors from the audit log, certificate service configuration.

## Website Management

- **Pages** — the unified list for the selected project. Every page shows
  title, URL slug, languages, status (Live legacy / Published / Unpublished),
  last-updated and last-published dates. Actions: Content editor (deep link
  to the matching CMS page), Visual Editor, Preview, Publish / Unpublish,
  Revisions (preview + restore), Edit, Delete, drag to reorder. *New page
  from template* creates a brand-new page plus a draft document from a
  GDF-branded template — existing pages are never overwritten.
- **Header / Footer** — logo, name visibility, navigation items (with
  translations and custom links), contact details, phones, socials,
  per-column visibility. Saves to `site_texts` + `page_sections`.
- **Homepage** — Hero (emblem, background, video toggle, overlay, buttons,
  countdown date), President's message, Venue, and section order/visibility.
- **SEO** — per-page SEO title, meta description, canonical, Open Graph
  title/description/image, robots directive, live search-result preview and
  length warnings. Saved into `site_settings` and applied to the public page
  after load (see DEPLOYMENT.md for the crawler caveat).
- **Global Website Settings** — raw key/value editor for `site_settings`
  (JSON-validated). Administrators only.

## Content Management

Applications (forms + info + cards), Sponsors & Partners (list + categories),
About (5 sections + partners + aims), Team (tabs, groups, members,
placements with drag & drop across tabs), Committees, FAQs, Website Texts
(all ~195 translatable keys with search, page filter, edited filter and
per-language missing hints), **Translations** (coverage percentages for the
built-in dictionaries and CMS overrides, admin interface included).

Every create/edit/delete in these sections is written to the audit log.

## Design Studio

- **Visual Editor** — GrapesJS with blocks (incl. GDF-branded Hero,
  Statistics, CTA, Cards, Gallery), layers, styles, traits, undo/redo,
  desktop/tablet/mobile preview, duplicate/delete controls, revision list,
  explicit revision snapshots, draft save, publish (publisher+), unpublish.
  Autosave runs 4 s after your last change (draft only, never publishes).
  The Preview button renders the document in a sandboxed frame — no scripts,
  no access to dashboard credentials.
- **Global Styles** — the public-site design tokens (maroon/gold palette,
  fonts, sizes, radius, spacing, button style) with live preview and reset.
- **Reusable Components** — manage saved components (preview, edit, delete);
  saving a component from the editor appears here and in the editor blocks.
- **Page Templates** — preview each template and apply it to any project
  (always creates a new page).
- **Hero & Responsive** — per-page hero/background records and the
  selector-based responsive style JSON for Builder pages.
- **Project Settings** — Builder-project navigation, header/footer colours,
  project design tokens (isolated from the live GDF'27 CMS tables).
- **Code & Archives** — custom-code slots (marked legacy, never published to
  the live site), HTML/ZIP import staging, ZIP/JSON export, archive history.

## Media Library

Uploads (drag & drop, progress), search, sort by name/date/size, copy URL,
rename, **replace**, delete. The **Usage** action lists every record that
references the file (table, column, id). Deletion is blocked while
references exist or while a reference check failed (usage shows *Unknown* —
never silently "unused"). *Replace file* uploads a new image, rewrites all
recorded references from the old URL to the new one, then removes the old
object. The bucket accepts JPG/PNG/WebP up to 5 MB (SVG is intentionally
blocked; there is no document hosting).

## System Administration

- **Audit Logs** — append-only records (actor, role, action, resource,
  metadata, outcome, time) with filters for action, user, resource, outcome
  and date range, plus a details modal and pagination.
- **Users & Roles** — list staff accounts, change roles, revoke access,
  and the documented steps + SQL snippet to add a new administrator
  (accounts are created in Supabase Authentication; passwords are never
  stored in the dashboard). You cannot change your own role or revoke
  yourself.
- **Permissions** — the role × capability matrix and where each rule is
  enforced (RLS policy vs RPC check).
- **Backups & Restore** — create a full content snapshot (database records;
  media files are referenced by URL, not copied), download the JSON,
  and restore. Restoring always creates a safety backup of the current
  state first and never deletes rows that are not part of the snapshot.
- **Notifications** — the bell in the top bar shows unread operational
  alerts (failed publishes, backup failures, role changes, QA failures);
  this page lists and dismisses them.
- **Static Checks** — route availability for the 10 public paths and the
  certificate RPC parameter check, recorded as test-run history.

## Saving workflow (every editor)

1. Edit → *Unsaved changes* badge appears; leaving the page asks for
   confirmation.
2. **Save** → bar shows *Saving…* then *Saved HH:MM* (or *Save failed* with
   the reason as a toast). Offline shows *Offline — changes not saved*.
3. Live preview (where available) shows unsaved edits without publishing.
4. Nothing is public until the underlying save succeeds — and for Builder
   pages, "published" means the database release snapshot exists; the static
   public pages deploy separately.
