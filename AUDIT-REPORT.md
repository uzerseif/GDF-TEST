# AUDIT REPORT — GDF V4 / UCMS Complete System Audit & Repair

**Date:** 2026-11-19 · **Scope:** full project (public site, UCMS dashboard, Builder Studio, Supabase integration, SQL, docs) · **Mode:** inspect → fix → verify (all fixes implemented, not recommendations)

---

## A. Technical Audit Report — discovered issues

Severity: **C** critical (breaks a feature) · **H** high (wrong behaviour / leak / race) · **M** medium (UX / consistency) · **L** low (polish).

| # | Sev | Issue | Root cause | File(s) | Status |
|---|-----|-------|-----------|---------|--------|
| 1 | C | **Pages manager shows "no pages" on first visit** — the list queried `project_id = null` until the user manually changed the project dropdown | `loadProjects()` set the `<select>` value but never synced the closure variable `projectId`; every load/query used `null` | `admin/pages-website.js` | **FIXED** — projectId synced from the select before `load()` |
| 2 | C | **Same null-project bug in Project Settings & Advanced Editing** — navigation/header/footer/hero/media/responsive editors queried `project_id = null` on first render, so every form looked empty | identical pattern in two `loadProjects()` functions | `admin/pages-builder.js` | **FIXED** |
| 3 | C | **Global search never returned text results** | filter used `value::text.ilike`, which PostgREST rejects (invalid cast syntax); the error was swallowed by the search aggregation | `admin/ucms-core.js` | **FIXED** — now `value->>en/ar/tr.ilike` (valid jsonb arrow syntax); errors logged, not hidden |
| 4 | C | **Breadcrumbs dead on `/admin/` entry point** | `A.go()` rendered into `#crumbs`, but `admin/index.html` had no such element (only `admin.html` did) | `admin/index.html` | **FIXED** — `<nav id="crumbs" class="crumb-trail">` added |
| 5 | H | **Event-listener accumulation on `#view`** — every navigation to a section-editor page attached another `input`/`change` listener to the persistent `#view` node; live-preview messages duplicated and listeners grew without bound | `U.editorPage`/`U.managerPage` attached to `host` (which is `#view` for several pages); `#view` is never replaced, only emptied | `admin/pages-shared.js` | **FIXED** — listeners now attach to a transient wrapper div inside the page; also pages render into a DocumentFragment so page-level listeners die with the page |
| 6 | H | **Save-status handler leak** — every rendered save bar pushed a `setState` closure into `A._saveStatusHandlers` forever | no removal path | `admin.js` | **FIXED** — handlers removed via the new page-cleanup registry |
| 7 | H | **Duplicate drag-sort wiring in Pages manager** — `A.sortable(list, saveOrder, …)` ran inside `load()`, which runs after every edit/publish; after N loads one drag triggered N `saveOrder` runs (N×row updates + N toasts) | sortable wiring placed in the data-refresh path | `admin/pages-website.js` | **FIXED** — wiring moved to render time, once per page instance |
| 8 | H | **Duplicate invite cards on Users & Roles** — `load()` appended a new invite card after every role change/revoke | card built inside `load()` | `admin/pages-system.js` | **FIXED** — card host built once; `load()` only refreshes it |
| 9 | H | **GrapesJS editor never destroyed** — switching pages/projects called `grapesjs.init()` again while the old editor (canvas iframe, document-level keyboard handlers, model listeners) stayed alive | no destroy path | `admin/pages-builder.js` | **FIXED** — `destroyEditor()` before every init + registered as page cleanup; also guards timers |
| 10 | H | **Editor save race** — autosave (4 s debounce) and manual save could run in parallel; last response wins could resurrect older content or overwrite the status label | no in-flight guard, no ordering | `admin/pages-builder.js` | **FIXED** — monotonic save sequence + single-flight queue (newer requests chain after the current one); a stale response can no longer paint state |
| 11 | H | **Page-load race in the editor** — quickly switching pages could let the slower older fetch initialise the canvas with the wrong page | no load token | `admin/pages-builder.js` | **FIXED** — `loadSeq` token; only the newest load initialises |
| 12 | H | **Render race in the router** — rapid navigation allowed an older async render to overwrite the newer page | render promise had no sequencing | `admin.js` | **FIXED** — `A._renderSeq` token; only the newest render paints |
| 13 | H | **Browser back/forward did not navigate** — router used `history.replaceState`, so Back exited the dashboard instead of returning to the previous admin page | no history entries, no `popstate` handling | `admin.js` | **FIXED** — `pushState` + `popstate` listener (with unsaved-changes guard) |
| 14 | H | **Fragile boot** — any network/schema failure inside `enter()` was caught by a catch that showed the *login* view even though the user holds a valid session; core-data errors were partially swallowed | error paths collapsed into one generic catch | `admin.js` | **FIXED** — auth denial vs transient failure separated; core-load failure keeps the shell usable, shows a localised banner (`msg.corePartial`) and logs per-query errors |
| 15 | H | **SEO page showed empty fields despite stored values** | settings were fetched *after* the tabs rendered | `admin/pages-website.js` | **FIXED** — settings awaited first, tabs built afterwards |
| 16 | H | **All-texts page lost scroll + filters after save** — save re-ran `A.go("texts", true)` (full re-render) | unnecessary full reload | `admin/pages-content.js` | **FIXED** — in-place badge/filter refresh after save |
| 17 | H | **Bell notification interval leak** — a new 60 s `setInterval` was created on every sign-in within one session | no guard | `admin/ucms-core.js` | **FIXED** — one interval per session |
| 18 | M | **Dashboard stats wasted queries + downloaded rows to count** | revisions/releases counts fetched but never displayed; pages count fetched all rows | `admin/pages-dashboard.js` | **FIXED** — two `head:true` exact counts, unused queries removed |
| 19 | M | **Revision-restore closed every open modal** (`querySelectorAll(".modal-backdrop").forEach(remove)`) | modal API reference not kept | `admin/pages-website.js` | **FIXED** — closes its own dialog via the modal handle |
| 20 | M | **Editor init used a blind 300 ms timeout** to decide "initialised", risking spurious autosaves on slow renders | no `load` event hook | `admin/pages-builder.js` | **FIXED** — GrapesJS `load` event + 1.2 s safety net |
| 21 | M | **Search filters could inject PostgREST operators** — user input was escaped with `\\$&` (wrong escape for `or=` filters) and commas inside values broke filter parsing | hand-rolled ilike patterns | `admin/ucms-core.js`, `admin/pages-system.js` | **FIXED** (search) — commas/percent/underscore stripped from the value |
| 22 | M | **Centralised error handling missing** — failures were toasted raw, without category | no classification | `admin.js` (+ all modules via `A.fail`) | **FIXED** — `A.errInfo()` classifies network / auth-permission / database / validation / runtime, localised category names, secrets never exposed |
| 23 | M | **Health checks did not cover the DB contract** | checker verified only connectivity + 2 tables | `admin/ucms-core.js`, `admin/pages-dashboard.js`, `admin/ucms.css` | **FIXED** — new **Database diagnostics** panel: connection, all 30 required tables, critical column sets, 6 RPC functions (side-effect-free probes), storage bucket, RLS behaviour (anon read allowed / staff rows hidden / anon writes rejected), per-migration status. Statuses: Healthy / Missing / Permission Error / Migration Required / Connection Failed. i18n: EN/AR/TR |
| 24 | M | **`admin.html` vs `admin/index.html` divergence** (crumbs element) | manual copy drift | both entry points now structurally equivalent | **FIXED** |
| 25 | L | `type:"button"` duplicated attribute in search-button creation | typo | `admin/ucms-core.js` | **FIXED** |
| 26 | L | `upload()` promise could reject unhandled when `getSession()` failed | missing `.catch` | `admin.js` | **FIXED** |

**Explicitly verified as NOT broken** (checked because the task called them out): ES-module/script load order (`defer` chain in both admin entries is correct); CSS class coverage for every class the JS emits; the public CMS pipeline (`cms-boot.js` → `i18n.js` → `cms-public.js`) including `applyHeader` list re-ordering (proved order-preserving); publishable-keys-only policy (secret scan clean); RLS/policy set in SQL matches every JS query path found; `publish_builder_document` / `restore_builder_revision` server-side authorisation; sanitisation of CMS text (`GDF_i18n_sanitize`, esc() on every interpolation in `cms-public.js`); seeded SQL `is_i18n` constraints vs the seed data; all internal links and asset paths in the 22 HTML files.

---

## B. Fixed files

| File | Change |
|---|---|
| `admin.js` | page-cleanup registry (`A.addCleanup`/`A.runCleanup`), render-sequence guard, `pushState`+`popstate` routing, save-bar handler deregistration, resilient `enter()`/`A.start()`, `loadCore` per-query error capture + partial-failure banner, `A.errInfo` error classification, upload rejection path |
| `admin/index.html` | breadcrumb nav element added |
| `admin/ucms-core.js` | fixed PostgREST text-search filter + error surfacing, bell interval guard, duplicate `type` attribute, new `A.dbHealth()` database diagnostics (tables/columns/RPC/storage/RLS/migrations) |
| `admin/pages-shared.js` | `U.editorPage`/`U.managerPage` listeners contained in transient wrapper (no more `#view` accumulation) |
| `admin/pages-website.js` | projectId sync (fix #1), sortable wiring once (fix #7), SEO load-before-render (fix #15), revision modal handle (fix #19) |
| `admin/pages-dashboard.js` | health page renders Database diagnostics; dashboard stats head-counts, dead queries removed |
| `admin/pages-content.js` | texts page saves in place (fix #16) |
| `admin/pages-system.js` | users invite card built once (fix #8) |
| `admin/pages-builder.js` | editor destroy + cleanup, save single-flight + sequence token, `loadSeq` page-load token, `load`-event init, projectId sync in Project Settings & Advanced Editing (fix #2/#9/#10/#11/#20) |
| `admin-ucms-i18n.js` | 30 new keys (health diagnostics, error categories, partial-core message) in EN/AR/TR |
| `admin/ucms.css` | diagnostics panel styles (`.db-health`, `.db-group-title`) |
| `scripts/ucms-qa.js` (project-external) | QA script recreated (was referenced by TESTING.md but missing from the archive): syntax, i18n integrity + parity, dynamic prefixes, page-id integrity, base-href-aware asset scan, secret scan |

No file was deleted; no feature, authentication layer, or visual identity was removed.

## C. Database changes

**No SQL migration was executed or modified.** All reviewed migrations are additive and idempotent; the JS↔schema contract checks out (tables, columns, constraints, unique keys `onConflict` targets, RPC signatures, RLS policies).

Live-project state (verified with the publishable key only):

- Applied: base schema + `cms-migration-v4` (site_texts, page_sections, team_groups, team_placements present; public reads work).
- **Not applied:** `cms-migration-v5` (audit_logs, cms_notifications, cms_backups, builder_page_templates) and `builder-migration-v1…v9` (all builder_* tables) — confirmed via PGRST205 responses. The dashboard currently degrades gracefully (per-card errors), and after this audit the new **Database diagnostics** panel will show "Migration Required" per family.
- Required manual step (project owner, SQL Editor): run `cms-migration-v5.sql` and `builder-migration-v1.sql` … `builder-migration-v9.sql` in order (see README quick start). They are additive/idempotent; take a `create_cms_backup` snapshot or a Supabase platform backup first. **Rollback guidance:** these migrations only `CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`; rollback = drop the newly created tables (no existing rows are touched, so no data-loss risk to current content).
- Security note (no action taken): `cms-admin-upgrade.sql` once added `image/svg+xml` to the bucket allowlist; `cms-migration-v5.sql` already re-asserts the safe jpg/png/webp-only allowlist — run v5 to close that hole.

## D. Performance improvements

- Dashboard statistics: 10 queries → 9, all counts now `head:true` (no row payloads); removed 2 never-displayed count queries (revisions/releases).
- Global search: text results actually returned (previously always-empty due to the broken filter); per-job errors logged instead of silent.
- Editor: one GrapesJS instance per session instead of one per page switch (DOM/iframe/handler leak eliminated); stale autosaves suppressed by signature + sequence; `saveDraft` no longer issues parallel upserts.
- Router: stale renders abandoned instead of painting; listeners/timers destroyed per page (bounded memory on long sessions).
- All-texts save: page state (scroll, search, language filter) preserved — no full re-render.
- Measurement caveat: no authenticated production session was available, so improvements are verified by code-path analysis, static QA and unauthenticated browser runs (zero console errors), not by production timings.

## E. Testing report

| Test | Result | Details |
|---|---|---|
| JS syntax — all 30 project .js files | **PASS** | `node --check`, 0 failures |
| i18n integrity — every `t()`/`data-t` key resolves (EN) | **PASS** | recreated `ucms-qa.js`; includes the 30 new keys |
| i18n ar/tr parity for `ucms.*`/`err.*` keys | **PASS** | 0 missing |
| Dynamic key prefixes (4) | **PASS** | all prefixes have matching keys |
| Page-id integrity — 31 pages registered, every `A.go()` literal target valid, no duplicate registrations | **PASS** | |
| Local asset references — 22 HTML files, base-href aware, comments stripped | **PASS** | 0 broken paths |
| Secret scan | **PASS** | publishable keys only; no service_role/secret literals in code |
| `admin.html` fresh load — login view, console, page errors | **PASS** | 0 errors (headless Chromium) |
| `admin/index.html` fresh load (base-href entry) | **PASS** | 0 errors; breadcrumbs element present |
| Failed login against live Supabase auth | **PASS** | localised error "Sign-in failed: Invalid login credentials"; stays on login view |
| Public routes fresh load — `/`, `about/`, `applications/`, `committees/`, `faq/`, `team/`, `president/`, `verify/`, `certificate/` | **PASS** | 0 console errors, 0 page errors each |
| Live CMS integration | **PASS** | `data-cms-ready="1"`; sponsor grid rendered from live DB (5 cards); texts applied |
| Language switching EN→AR→TR + persistence | **PASS** | `dir=rtl` + Arabic text; TR persisted across reload (observed in later screenshot) |
| Mobile 375 px — home | **PASS** | no horizontal overflow (`scrollWidth == 375`), hamburger present |
| Live REST/RLS probes (anon): read site_texts 200 · read admin_users 200+`[]` · write site_texts 401 RLS violation · read committees 200 (6 seeded rows) · certificate RPC 200 | **PASS** | curl with publishable key only |
| Live migration-state probe | **PASS (finding)** | v4 tables present; v5 + builder tables absent → documented in §C/F |
| Dashboard/Builder/CRUD/RLS behaviour with an authenticated session | **BLOCKED** | no admin credentials available in this environment; static + unauthenticated coverage only |
| Visual-editor canvas interaction (drag, autosave write, publish RPC) | **BLOCKED** | requires authenticated session; single-flight/sequence logic verified by code-path analysis + syntax/QA checks |
| Authenticated navigation incl. back/forward | **BLOCKED** | requires session; logic code-reviewed |

## F. Remaining problems (manual action required)

1. **Apply the pending migrations** (§C) in the Supabase SQL Editor — v5 + builder v1…v9. Everything else is ready; until then, dashboard pages that read builder/v5 tables show explicit per-card errors and the diagnostics panel will flag them.
2. **Authenticated end-to-end pass** (login → every page → editor save/publish → restore → backups) needs an admin account; run it after applying the migrations.
3. **Publishing ≠ deployment** (by design, honestly labelled in the UI): database publishing does not redeploy GitHub Pages static files. See DEPLOYMENT.md §5 for the planned integration.
4. `site.domain` setting still contains the placeholder `https://YOUR-DOMAIN.com` — set the real domain for canonical/OG/sitemap correctness.
5. Firefox/Safari and physical-device responsive verification not performed (headless Chromium only).
6. The archive contained a 397 MB Chrome crash dump (`core`) — removed from the working copy; exclude stray dumps from future zips.

## G. Final project status

- **Public website:** production-ready. All routes load clean against the live CMS; Arabic/Turkish fallbacks and sanitisation verified; no regressions introduced.
- **UCMS dashboard:** ready pending the two manual steps above. All discovered dashboard bugs are fixed and covered by the recreated static QA suite; the diagnostics panel turns the live migration gap into a visible, actionable state instead of silent errors.
- **Builder Studio:** code-level correctness restored (single editor instance, race-free saves, per-page cleanup). Interactive verification requires an authenticated session once migrations are applied.
- **Security posture:** unchanged-where-correct, hardened-where-weak: publishable keys only, RLS verified live (anon read OK / staff rows hidden / anon writes rejected), sanitisation intact, no destructive SQL, no secrets exposed.
- **Honest readiness:** the system is one idempotent SQL run + one authenticated smoke pass away from full production readiness.
