# GDF'27 — Website + UCMS

The public Gaziantep Diplomacy Forum 2027 website (static HTML, GitHub Pages)
managed by the **UCMS** — a Supabase-backed Unified Content Management System
with a GrapesJS visual editor (Builder Studio).

Start here:

| Document | What it covers |
|---|---|
| [UCMS-GUIDE.md](UCMS-GUIDE.md) | How to use the admin dashboard, page by page |
| [BUILDER-GUIDE.md](BUILDER-GUIDE.md) | Visual editor, blocks, components, templates, publishing |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Frontend module structure and data flow |
| [DATABASE.md](DATABASE.md) | Tables, RLS, storage, roles |
| [MIGRATIONS.md](MIGRATIONS.md) | Every SQL migration and when to run it |
| [SECURITY.md](SECURITY.md) | Threat model, permissions, what is enforced where |
| [TESTING.md](TESTING.md) | Test results (what was really run and what is still pending) |
| [DEPLOYMENT.md](DEPLOYMENT.md) | GitHub Pages deployment and publishing mechanics |
| [REPORT.md](REPORT.md) | The UCMS transformation report: findings, changes, status |
| [CHANGES.md](CHANGES.md) | Full change history |

## Quick start (fresh environment)

1. Supabase → SQL Editor, run in order: `cms-schema.sql`, `cms-admin-upgrade.sql`,
   `seed-gdf.sql` (new/empty project only), `cms-migration-v4.sql`,
   `builder-migration-v1.sql` … `builder-migration-v9.sql`, **`cms-migration-v5.sql`**.
2. Authentication → Users → Add user (tick *Auto confirm*), then:
   `insert into public.admin_users (user_id, role) values ('UID', 'admin');`
3. Turn off public sign-ups. Deploy the whole folder. Open `/admin/`.

The Supabase URL and **publishable** keys are set once in `cms-config.js`.
Never place a service_role or secret key in any frontend file.

## Directory map

```
GDF V4/
├── index.html …            public pages (EN/AR/TR, clean routes via <route>/index.html)
├── admin.html, admin/      UCMS dashboard (entry + admin/index.html with <base href="../">)
│   ├── ucms-core.js        audit log, notifications, search, health, roles
│   ├── pages-shared.js     section editors, table lists (shared helpers)
│   ├── pages-dashboard.js  dashboard, website health
│   ├── pages-website.js    unified Pages, header/home/footer, SEO, global settings
│   ├── pages-content.js    applications, sponsors, about, team, committees, FAQ, texts, translations
│   ├── pages-builder.js    visual editor, global styles, components, templates, project settings
│   ├── pages-system.js     audit logs, media library, users, permissions, backups, notifications
│   └── boot.js             starts the router after all modules register
├── cms-config.js           both Supabase connections (publishable keys only)
├── cms-boot.js             head-of-page cache so visitors never see a design flash
├── cms-public.js           applies CMS content to the public pages + SEO metadata
├── i18n.js, translations.js, cms-defaults.js   public i18n (EN base, AR/TR dictionaries)
├── verify*.js/html, certificate*   certificate verification (separate Supabase project)
├── cms-migration-v4.sql, cms-migration-v5.sql   CMS migrations
├── builder-migration-v1…v9.sql  Builder Studio migrations
└── vendor/                 pinned local libraries (jspdf, html2canvas)
```

CDN dependencies (pinned): `@supabase/supabase-js@2.49.4`, `grapesjs@0.21.13`,
`codemirror@5.65.16`, `jszip@3.10.1`.
