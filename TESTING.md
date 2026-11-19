# GDF'27 Content Studio / UCMS — test results

## Full system audit & repair — 2026-11-19 (second pass)

Scope: complete audit + fix pass over the whole project (dashboard lifecycle,
routing, rendering, Builder Studio races, CMS integration, database checks).
Every result below was executed in this session; nothing is claimed without
evidence. Full issue list and fixes: **AUDIT-REPORT.md**.

### Static checks (executed, all passing — `node scripts/ucms-qa.js .`)

| Check | Result |
|---|---|
| JavaScript syntax — all 30 project .js files (`node --check`) | PASS |
| i18n integrity — every `t()` / `data-t` key resolves in EN (incl. 30 new diagnostics/error keys) | PASS |
| i18n ar/tr parity for `ucms.*` / `err.*` keys | PASS |
| Dynamic key prefixes (4) have matching keys | PASS |
| Page-id integrity — 31 pages registered, all `A.go()` targets valid, no duplicates | PASS |
| Local asset references — 22 HTML files, base-href aware | PASS |
| Secret scan — publishable keys only | PASS |

`scripts/ucms-qa.js` (referenced by the previous round but missing from the
archive) was recreated and ships with the project; it is a dev tool, not a
runtime dependency.

### Browser smoke tests (headless Chromium, local static server :8931)

| Test | Result |
|---|---|
| `admin.html` fresh load — login view, 0 console/page errors | PASS |
| `admin/index.html` fresh load (base-href entry, breadcrumbs element) — 0 errors | PASS |
| Failed login against live Supabase auth — localised error, stays on login | PASS |
| Public routes: `/`, `about/`, `applications/`, `committees/`, `faq/`, `team/`, `president/`, `verify/`, `certificate/` — 0 errors each | PASS |
| Live CMS integration — `data-cms-ready="1"`, sponsor grid from DB, texts applied | PASS |
| Language switch EN→AR (rtl)→TR + persistence across reload | PASS |
| Mobile 375 px home — no horizontal overflow, hamburger present | PASS |

### Live Supabase probes (publishable key only, via curl)

| Probe | Result |
|---|---|
| anon read `site_texts` / `committees` | PASS (200, seeded rows) |
| anon read `admin_users` | PASS (200 + `[]` — own-row RLS hides staff) |
| anon write `site_texts` | PASS (401, RLS violation — writes blocked) |
| certificate-project `verify_certificate()` RPC | PASS (200) |
| migration-state probe | v4 tables present; **v5 + builder v1…v9 NOT applied on the live project** (PGRST205) — run them per AUDIT-REPORT.md §C; the new Database diagnostics panel now surfaces this as "Migration Required" |

### New in this round

- **Database diagnostics** on the Website Health page: connection, 30 required
  tables, critical columns, 6 RPC functions (side-effect-free probes), storage
  bucket, RLS behaviour, per-migration status — statuses Healthy / Missing /
  Permission Error / Migration Required / Connection Failed (EN/AR/TR).
- Centralised error classification (`A.errInfo`) with localised categories.
- Page lifecycle (`A.addCleanup`) + render/save/load sequence tokens; browser
  back/forward now navigates the dashboard (popstate).
- Visual editor: single GrapesJS instance (destroy on re-init and navigation),
  single-flight saves with monotonic ordering, stale page loads discarded.

### Still blocked (needs credentials / external access)

- Authenticated walkthrough of all dashboard pages, editor save/publish,
  revision restore, backups — requires an admin account (and the pending
  migrations applied first).
- Firefox / Safari and physical devices.


## UCMS transformation — 2026-11-19

Scope of this round: architecture refactor, security hardening, UCMS surfaces
(dashboard, health, audit, media usage, users, backups, notifications, search,
SEO, templates, components), migration v5. Results below are only what was
actually executed in this session — nothing is claimed without evidence.

### Static checks (executed, all passing)

| Check | Method | Result |
|---|---|---|
| JavaScript syntax — every project .js file | `node --check` (per file) | PASS (vendor minified files excluded from check but shipped pinned) |
| i18n key integrity | `scripts/ucms-qa.js`: every `t("…")` / `data-t` key used by the admin modules resolved against `ADMIN_I18N` (en/ar/tr) | PASS — 484 keys in EN; all 193 new `ucms.*` keys present in AR and TR |
| Dynamic key prefixes | same script: every `t("prefix." + x)` has matching keys | PASS |
| Page-id integrity | every `A.go("…")` target is a registered page; no duplicate registrations | PASS — 31 pages registered |
| CDN dependency pinning | scan of all 22 HTML files | PASS — `@supabase/supabase-js@2.49.4`, `grapesjs@0.21.13`, `codemirror@5.65.16`, `jszip@3.10.1` |
| Local asset references | base-href-aware scan of every script/link href (HTML comments excluded) | PASS |
| Secret scan | block/line-comment-stripped source scan for service_role/secret assignments | PASS |
| v5 SQL sanity | object names, policy/function grants reviewed line-by-line against RLS matrix | PASS (static) |

### Browser smoke tests (executed with headless Chromium via agent-browser)

Server: local static server on 127.0.0.1:8931 serving the project root.

| Test | Result |
|---|---|
| `admin.html` fresh load — no console errors, no page errors, login view rendered, dependency guard intact | PASS |
| `admin/index.html` fresh load (base href entry point) — 0 errors | PASS |
| Public routes fresh load — `index.html`, `about/`, `applications/`, `committees/`, `faq/`, `team/`, `president/`, `verify/`, `admin/` — 0 console errors, 0 page errors each | PASS |
| Failed login against the live Supabase auth service — proper localised error message, stays on login view | PASS (observed with wrong credentials against the real project; no data modified) |
| Full app-shell walkthrough with a mocked REST layer | BLOCKED — injected route mocks cannot supply the CORS headers the browser requires; a faithful mock needs a local Supabase stack (Playwright, as the 84/84 round used). Not executed here. |

### Not executed in this round (same limitation as before)

- CRUD and RLS behaviour against a live project (pages, media, users, roles,
  publish/unpublish, revisions/restore, backups/restore) — requires a live
  Supabase admin account or a local Supabase stack.
- Migration v5 has not been applied to the live project (it is additive and
  idempotent; apply per MIGRATIONS.md, take a backup first).
- Firefox / Safari and real mobile devices.
- The visual editor's canvas behaviour in a real GrapesJS session
  (GrapesJS loaded from CDN in the smoke test; interaction testing needs the
  authenticated app).

### Honesty notes

- The dashboard's "Media files" statistic counts registered Builder assets
  (`builder_project_assets`) for speed; the full storage walk with exact
  counts lives in the Media Library page.
- The SEO fields are applied to public pages by JavaScript after load.
  Crawlers that execute JavaScript see them; static crawlers see the
  original HTML metadata. This is stated in-app and in DEPLOYMENT.md.
- Publishing to the database is not a public deployment — three separate
  statuses are shown, and DEPLOYMENT.md §5 documents the future integration.

---

# Historical results (previous rounds)

## Phase 1 — not yet runtime-tested

The Builder migration and project dashboard were added after the existing 84/84 test report.
They require a live or local Supabase instance with `cms-migration-v4.sql` and
`builder-migration-v1.sql` applied. The migration and project CRUD were not counted in the
existing 84/84 result until runtime testing is completed.

## Phase 2 — not yet runtime-tested

The GrapesJS editor and Builder migration V2 require browser and Supabase testing.
No visual-editor claim is approved until a live Supabase instance, CDN-loaded GrapesJS
canvas, draft save/reload, revisions, components, responsive devices and GDF'27
non-regression behavior have been tested.

## Phase 3 — not yet runtime-tested

The pages, navigation, header/footer and design-token management require live Supabase
testing. Existing GDF'27 CMS behavior must be checked to confirm Builder settings do not
overwrite or publish directly to the public website.

## Phase 4 — not yet runtime-tested

Project media upload, asset deletion, hero/background records and JSON responsive
style records require live Supabase and browser testing. The existing global
`site-media` uploader and public GDF'27 assets must remain regression-tested.

## Phase 5 — not yet runtime-tested

CodeMirror, JSZip, HTML import, ZIP export and archive-history operations require live
browser/CDN and Supabase testing. Imports must not be considered published or applied
to GDF'27 public files until a later publishing phase.

## Phase 6 — not yet runtime-tested

Publish, unpublish, release snapshots, revision restore and backup-before-restore require
live Supabase RPC and RLS testing. Public GDF'27 deployment must remain disabled until
the separate integration and publishing phase is implemented.

## Phase 7 and 8 — not yet runtime-tested

GDF'27 integration records and static QA history are implemented, but live verification is
not complete. The following remain pending:

- Apply migrations V1 through V8 and verify reruns.
- Run project CRUD, RLS and GDF'27 protection tests.
- Load GrapesJS, CodeMirror and JSZip in Chromium.
- Test draft save/reload, revisions, restore, publish and unpublish.
- Test HTML/ZIP import and ZIP/JSON export.
- Test public EN/AR/TR pages and clean routes.
- Test committee, team, sponsor, FAQ and application loading.
- Test the `verify_certificate(p_certificate_id)` RPC parameter and certificate PDF flow.

## Integrity follow-up

- Applied static fixes for GDF'27 system status, cross-project references, CodeMirror initialization,
  GrapesJS duplicate/delete controls and responsive CSS generation.
- These fixes require migration rerun and browser persistence testing before approval.

## Chromium Builder verification — mock Supabase — 2026-11-19

- Admin login shell loaded and accepted a mocked authorized session.
- Visual editor loaded GrapesJS with blocks, layers, styles and traits.
- Text block drag/drop, duplicate control and delete control were visible and executable.
- Website management, Code and archives, and Advanced editing pages loaded without
  page exceptions or HTTP 400/404 responses.
- Admin navigation remained under `/admin/#<section>`.
- Legacy GDF'27 image URLs in the visual canvas were corrected from `/admin/images/*`
  to project-root URLs.
- These checks used a mock database and do not prove live Supabase RLS or persistence.

## Final available validation — 2026-11-18

### Passed

- JavaScript syntax: all `*.js` files in the workspace passed `node --check`.
- Chromium smoke test: 11 public/admin routes returned HTTP < 400 through the local static server.
- Chromium console: no JavaScript console `error` messages were emitted during the route smoke test.
- Local key assets: `logo.webp`, `style.css`, `applications.css`, `admin.css`, and the four applications card images returned HTTP 200.
- Certificate RPC parameter static check: `verify-common.js` now calls
  `verify_certificate` with `p_certificate_id`, matching `supabase-migration.sql`.
- Secret-key static scan: no `service_role` or secret key assignment was found in frontend files.

### Browser/network failures observed

- Live Supabase REST requests failed or were unavailable from the local test environment.
- The Google Maps embed request failed or was unavailable.
- Google Fonts requests failed or were unavailable.
- CDN-loaded GrapesJS, CodeMirror and JSZip could not be proven functional beyond static loading.

### Not executed

- Login and logout against the live Supabase account.
- Project creation, editing, duplication, archive, restore and deletion against Supabase.
- Direct RLS tests for staff, editor, anonymous and non-staff users.
- GrapesJS element add/edit/delete/reorder/duplicate/style/responsive/persistence tests.
- Website page, navigation, header, footer, typography and media CRUD tests.
- ZIP extraction and exported-page/CSS/JavaScript/internal-link verification.
- Live committee, team, sponsor, FAQ and application data tests.
- Live certificate verification and certificate PDF tests.
- Firefox or Safari testing.
- Mobile-device browser testing.

I ran the tests against a **local Supabase stack** (Supabase CLI 3.1.0 in Docker), set up exactly like your project:
`cms-schema.sql` → `cms-admin-upgrade.sql` → `seed-gdf.sql` → `cms-migration-v4.sql` (run twice to prove it's safe to repeat).
I used Playwright with headless Chromium to drive the real `admin.html` and then checked the real public pages as a visitor.
The accounts were local test accounts (admin, editor, and a signed-in non-staff user). Your live Supabase project was **only read**, never changed.

**Result: 84/84 automated checks passed.**

| # | Check | Result |
|---|---|---|
| 1a | login rejects wrong password | PASS |
| 1b | non-staff account is denied the dashboard | PASS |
| 1c | admin login opens dashboard | PASS |
| 1d | News & Updates removed from admin | PASS |
| 1e | logout returns to login and clears session | PASS |
| 2a | anonymous write to site_texts blocked | PASS |
| 2b | anonymous update of team_members changes nothing | PASS |
| 2c | signed-in non-staff write to page_sections blocked | PASS |
| 2d | editor cannot change admin-only design settings | PASS |
| 2e | editor CAN edit content texts | PASS |
| 2f | anonymous image upload blocked | PASS |
| 2g | non-staff image upload blocked | PASS |
| 3a | hero saves without errors | PASS |
| 3b | hero tagline (EN) on public site | PASS |
| 3c | hero countdown label on public site | PASS |
| 3d | hero button link updated | PASS |
| 3e | countdown target from CMS (event.start) | PASS |
| 3f | hero tagline (AR) + RTL | PASS |
| 3g | hero tagline (TR) | PASS |
| P1 | live preview shows unsaved edits | PASS |
| P2 | unsaved preview edits not published | PASS |
| 4a | upload rejects non-image files | PASS |
| 4b | header saves | PASS |
| 4c | header logo replaced from Supabase Storage | PASS |
| 4d | nav label edited | PASS |
| 4e | nav item hidden | PASS |
| 6a | president message saves | PASS |
| 6b | letter text on homepage | PASS |
| 6c | president photo replaced | PASS |
| 6d | photo position option applied | PASS |
| 6e | message page uses same text/photo/signature | PASS |
| 7a | venue saves | PASS |
| 7b | venue address/email/phone/title on public site | PASS |
| 7c | venue phone link | PASS |
| 8a | sponsor added with uploaded logo | PASS |
| 8b | sponsor edited | PASS |
| 8c | sponsor appears on homepage | PASS |
| 8d | sponsor website link | PASS |
| 8e | sponsor reorder reflected | PASS |
| 9a | application image uploaded + saved | PASS |
| 9b | application card uses uploaded image | PASS |
| 9c | application description shown | PASS |
| 10a | application information saves | PASS |
| 10b | application information on public site | PASS |
| 10c | protocol link updated | PASS |
| 10d | other bullets preserved | PASS |
| 11a | about saves | PASS |
| 11b | about text on public site | PASS |
| 11c | other about content preserved | PASS |
| 11d | about section hide + reorder | PASS |
| 12a | all four team tabs on public site | PASS |
| 12b | each tab shows its members | PASS |
| 12c | profile modal opens | PASS |
| 13a | team member added (Units tab, photo) | PASS |
| 13b | new member visible in Units tab | PASS |
| 14a | team photo uploaded and displayed | PASS |
| 13c | biography shown in profile | PASS |
| 13d | member role in Arabic | PASS |
| 13e | member edited + moved to another tab | PASS |
| 13f | moved member shows in Advisory Board with new role | PASS |
| 13g | member reorder reflected | PASS |
| 12d | tab rename reflected | PASS |
| 13h | member deleted | PASS |
| 17a | footer saves | PASS |
| 17b | footer email/social/copyright on every page | PASS |
| 18a | design settings save (admin) | PASS |
| 18b | global colours applied on public site | PASS |
| 18c | global font applied | PASS |
| 18d | design reset restores original colours | PASS |
| 5a | homepage section reorder + hide | PASS |
| 15a | Turkish text edited in "All texts" appears on site | PASS |
| 15b | English unchanged when only Turkish edited | PASS |
| 16a | admin Arabic interface with RTL | PASS |
| 16b | admin Turkish interface | PASS |
| 16c | public site language independent of admin language | PASS |
| M1 | media library lists uploaded images | PASS |
| M2 | unused image deleted from storage | PASS |
| 19/20 | all public pages load in EN/AR/TR with no JS errors | PASS |
| 22 | no broken images | PASS |
| 23 | no broken internal navigation links | PASS |
| 21a | team_members.sort_order + new columns exist | PASS |
| 21b | table site_texts readable publicly | PASS |
| 21b | table page_sections readable publicly | PASS |
| 21b | table team_groups readable publicly | PASS |

## Other checks
* **Reported bug reproduced and fixed:** I dropped `team_members.sort_order` (inside a transaction that was rolled back). A query then failed with `column "sort_order" does not exist`. After `cms-migration-v4.sql` ran, the column existed and all 17 members kept their data.
* **Migration is safe to repeat:** running it twice in a row gave no errors. The team back-fill created 10 groups and left 0 placements ungrouped.
* **Visual regression:** I compared full-page screenshots of the original and the new site with empty CMS tables, at 1280 px. About, Our Team, Applications and the lower Homepage (sponsors + footer) match pixel for pixel. The only differences in the Homepage hero were the moving video frame, the countdown seconds and the map iframe.
* **Console / images / links:** all 11 public pages load in EN, AR and TR with no JavaScript errors and no broken images. Every internal link resolves.
* **Admin UI:** all 14 dashboard pages open with no console errors in EN, AR (RTL) and TR. Tested at desktop width (1400 px) and mobile width (390 px), with no horizontal overflow.

## Not tested
* I couldn't log in to your **live** Supabase project: there's no admin account in it yet, and the migration hasn't been run there. The same files still need to be run there (see CMS-SETUP.md).
* Tests ran in Chromium only. Safari and Firefox weren't tested.
* Very large real photos: uploads are limited to 5 MB and are not resized or compressed.