# ARCHITECTURE — GDF'27 website + UCMS

## 1. Three cooperating layers

```
┌────────────────────────────────────────────────────────────────────┐
│  Public website (static HTML on GitHub Pages)                      │
│  index.html, about/, applications/, … + cms-boot.js + cms-public.js│
└──────────────┬─────────────────────────────────────────────────────┘
               │ REST (anon/publishable key, RLS-enforced)
┌──────────────▼─────────────────────────────────────────────────────┐
│  Supabase project A (main CMS)                                     │
│  site_texts · page_sections · site_settings · content tables       │
│  builder_* (projects, pages, documents, revisions, releases…)      │
│  audit_logs · cms_notifications · cms_backups · templates          │
│  Storage bucket: site-media                                        │
└──────────────┬─────────────────────────────────────────────────────┘
               │ REST (anon/publishable key, RLS-enforced)
┌──────────────▼─────────────────────────────────────────────────────┐
│  Supabase project B (certificate service)                          │
│  certificates · verify_certificate() RPC                           │
└────────────────────────────────────────────────────────────────────┘
```

Two Supabase projects exist **by history, not by design**: the certificate
verification service was built first against its own project, and the main
CMS was added later. Both connections are centralised in `cms-config.js`
(`GDF_SUPABASE`, `GDF_VERIFY_SUPABASE`); merging the projects is possible but
requires a data migration of the `certificates` table — see REPORT.md,
"Recommended next steps".

## 2. Public-site data flow

1. `cms-boot.js` runs synchronously in `<head>` and applies design tokens,
   hidden sections and cached texts from `localStorage` (`gdf-cms-cache-v1`)
   so visitors never see a flash of the old design.
2. `i18n.js` sets the language (EN/AR/TR), direction and font before paint.
3. `cms-public.js` loads `site_texts`, `page_sections`, `site_settings` and
   the relevant content tables with the publishable key, applies them to
   `[data-cms]` hooks, refreshes the cache, and (new) applies per-page SEO
   metadata from `site_settings` keys `seo.<page>` (progressive enhancement:
   crawlers without JavaScript keep seeing the original HTML meta tags).
4. Every value falls back to the original HTML text if the CMS is empty or
   unreachable — the static site always works on its own.

## 3. UCMS module structure

The former 2,100-line `admin-pages.js` monolith was split into a load-ordered
module set (all plain scripts, no bundler — matching the project's
no-build-step architecture):

| File | Responsibility |
|---|---|
| `admin.js` | Core: Supabase client (guarded), auth, UI kit (`h`, fields, modals, toasts, uploader, drag-order), dirty tracking, save bars with save-state, navigation (collapsible categories + filter + breadcrumbs), router (`A.go`) |
| `admin/ucms-core.js` | Cross-cutting services: audit logging (`A.log`), notifications (`A.notify` + bell), global search (Ctrl/⌘+K), website health checks (`A.health`), role capabilities (`A.can`) |
| `admin/pages-shared.js` | `sectionEditor`, `editorPage`, `sectionsManager`, `tableList` — the proven content-editing primitives, now with audit hooks |
| `admin/pages-dashboard.js` | Dashboard (real statistics, activity, health summary, projects strip) and Website Health page |
| `admin/pages-website.js` | Unified **Pages** manager, Header, Homepage, President, Footer, **SEO**, **Global Website Settings** |
| `admin/pages-content.js` | Applications, Sponsors, About, Team, Committees, FAQs, Website Texts, **Translations** (coverage) |
| `admin/pages-builder.js` | Visual Editor (GrapesJS), Global Styles, **Reusable Components**, **Page Templates**, Hero & Responsive, Project Settings, Code & Archives, Static Checks |
| `admin/pages-system.js` | **Audit Logs**, **Media Library** (reference-safe), **Users & Roles**, **Permissions**, **Backups & Restore**, **Notifications** |
| `admin/boot.js` | Calls `A.start()` after every module has registered |

Registration order within each sidebar group follows load order; the router
is hash-based (`#page-id`), works on both entry points (`admin.html` and
`admin/index.html` with `<base href="../">` for GitHub Pages clean routes).

### Navigation groups

Overview (Dashboard, Website Health) · Website Management (Pages, Header,
Homepage, President, Footer, SEO, Global Website Settings) · Content
(About, President, Team, Sponsors, Committees, Applications, FAQs, Website
Texts, Translations) · Design Studio (Visual Editor, Global Styles,
Components, Templates, Hero & Responsive, Project Settings, Code & Archives)
· Media (Media Library) · System (Audit Logs, Users & Roles, Permissions,
Backups & Restore, Notifications, Static Checks).

## 4. State and saving model

- **Dirty tracking**: every input inside `#view` marks the page dirty
  (badge + beforeunload guard). Navigation away asks for confirmation.
- **Save bars** show explicit states: *Saving… → Saved HH:MM / Save failed*
  plus an offline override (`online`/`offline` events).
- **Visual editor autosave**: debounced 4 s after canvas changes, writes the
  draft document only (no revision row, never publishes), shows
  *Autosaved HH:MM*, and skips identical payloads.
- **Revisions** are created explicitly (Save revision button), automatically
  on publish (inside `publish_builder_document`), and automatically as a
  "Before restore" backup inside `restore_builder_revision`.
- **Live preview**: unsaved edits are posted to a same-origin iframe of the
  real public page (`cms-preview=1`); visual-editor document previews run in
  a **fully sandboxed iframe** (`sandbox=""`, srcdoc, no scripts) so untrusted
  HTML can never touch dashboard state.

## 5. Publishing mechanics (honest model)

Builder publishing (`publish_builder_document` RPC) is a **database
operation**: it snapshots the document, creates a revision + release row and
flips `is_published`. The live GDF'27 public pages are static files on
GitHub Pages — they are **not** redeployed by database publishing. The UI
says exactly that (three statuses: *draft saved / published to database /
public deployment* with the deploy note). See DEPLOYMENT.md for the static
deployment path and how to close the gap later.

## 6. Roles

`admin_users.role` ∈ `super_admin | admin | publisher | editor`.
Capabilities are enforced by RLS policies and RPC checks server-side
(`is_staff`, `is_admin`, `is_super`, `can_publish`, `can_manage_design`);
the UI only mirrors them (`A.can`). See SECURITY.md for the matrix.
