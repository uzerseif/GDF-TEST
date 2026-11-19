# DEPLOYMENT — GDF'27 website + UCMS

## 1. What "deployment" means here

There are two distinct publish surfaces. Keeping them separate is honest and
important:

| Surface | Mechanism | Trigger |
|---|---|---|
| CMS content (texts, sections, settings, content tables) | read live by the public pages from Supabase | **Saving in UCMS** — immediately visible after a page refresh |
| Builder visual pages | `builder_editor_documents` + release snapshots in the database | Publish action stores/releases in the database; the **static public files are not redeployed automatically** |
| Static site itself | GitHub Pages from the repository | `git push` (manual or CI) |

## 2. One-time setup (fresh Supabase project)

1. SQL Editor, in order: `cms-schema.sql` → `cms-admin-upgrade.sql` →
   `seed-gdf.sql` (empty project only) → `cms-migration-v4.sql` →
   `builder-migration-v1…v9.sql` → **`cms-migration-v5.sql`**.
   Every file is idempotent except `seed-gdf.sql` (never run twice).
2. Authentication → Users → *Add user* (Auto confirm) → insert into
   `admin_users` (see README.md). First account should be `admin` or
   `super_admin`.
3. Authentication → Sign In / Providers → disable public sign-ups.
4. Set the public origin: replace `https://YOUR-DOMAIN.com` placeholders in
   page metadata, `sitemap.xml`, `robots.txt` (and the `site.domain`
   setting) with the real origin.

## 3. GitHub Pages

1. Push the whole folder (including `images/`, `Videos/`, `assets/`,
   `vendor/`, `admin/`) to the repository.
2. Settings → Pages → deploy from branch, `/ (root)`.
3. Clean routes are static directories (`<route>/index.html`), so no server
   rewrites are needed. `admin/index.html` carries `<base href="../">` for
   project sites served under `/<repo>/`.

| Legacy URL | Clean URL |
|---|---|
| `/admin.html` | `/admin/` |
| `/about-us.html` | `/about/` |
| `/applications.html` | `/applications/` |
| `/committees.html` | `/committees/` |
| `/committee-detail.html?id=…` | `/committee/?id=…` |
| `/certificate.html?id=…` | `/certificate/?id=…` |
| `/faq.html` | `/faq/` |
| `/message-from-president.html` | `/president/` |
| `/our-team.html` | `/team/` |
| `/verify.html` | `/verify/` |

4. All local URLs are relative to the project root — never prefix with `/`
   (that bypasses the repository prefix).

## 4. Getting a Builder page onto the public site (today)

Database publishing stops at the database by design. To make a visual page
public right now:

1. UCMS → Design Studio → Code & Archives → **ZIP export** — the archive
   contains one `index.html` per visual document (self-contained CSS/JS).
2. Review the exported file, place it as `<slug>/index.html` in the
   repository (or wire it into an existing page), and push.
3. The public page then behaves like any static page; the CMS content
   integration hooks (`data-cms` / `cms-public.js`) apply if the page
   includes them.

Never describe a database publish as a completed public deployment — the UI
labels these three states separately on purpose.

## 5. Recommended future integration (closing the gap)

The clean, safe end-state is a small server-side step (GitHub Action or
Supabase Edge Function with the service key held server-side) that:

1. Is triggered by a new `builder_project_releases` row (webhook/trigger).
2. Renders each released document to `<slug>/index.html`.
3. Commits and pushes to the site repository (or deploys via the hosting
   API), then records the deployment outcome in a new
   `builder_project_deployments` table.

That would let the third status ("Public Website Deployed") become a real,
verified state instead of a manual step. This release deliberately does not
fake it.

## 6. Environment & configuration inventory

| Value | Location | Notes |
|---|---|---|
| Main Supabase URL + publishable key | `cms-config.js` (`GDF_SUPABASE`) | public site + UCMS |
| Certificate Supabase URL + publishable key | `cms-config.js` (`GDF_VERIFY_SUPABASE`) | fallback constants inside `verify-common.js` |
| No environment variables | — | static hosting; keys are publishable by design |

## 7. Release checklist

- [ ] `node --check` on all JS (or `scripts/ucms-qa.js` equivalent)
- [ ] `cms-migration-v5.sql` applied on the live project (idempotent)
- [ ] Sign-in works with an `admin` account; an `editor` cannot publish
- [ ] Public EN/AR/TR pages render; header/footer/hero come from the CMS
- [ ] Media upload + usage listing works
- [ ] Backup create + download works
- [ ] Audit log records the actions above
