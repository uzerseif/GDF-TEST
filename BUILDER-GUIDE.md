# BUILDER-GUIDE — Visual Editor & Builder Studio

Builder Studio manages **Builder projects** — self-contained website records
that can eventually support additional independent websites. GDF'27 is the
protected first project (`is_system`): it cannot be deleted, and its identity
fields (slug, owner, cms link) cannot be changed.

## Concepts

| Object | Meaning |
|---|---|
| Project | A website container (`builder_projects`) |
| Page | A URL inside a project (`builder_project_pages`, unique slug, type `legacy`/`visual`/`custom`) |
| Document | The GrapesJS HTML/CSS/JS of one page (`builder_editor_documents`) |
| Revision | A point-in-time snapshot of a document (`builder_project_revisions`) |
| Release | A publish snapshot with manifest (`builder_project_releases`) |
| Component | A reusable saved section (`builder_project_components`) |
| Template | A GDF-branded starting page (`builder_page_templates`) |

The GDF'27 `legacy` pages are the real public pages; their documents are
separate draft data. A `visual` page exists only inside Builder until a
deployment integration exports it (see "Publishing reality" below).

## Editing workflow

1. **Pages** (Website Management) → open a page in the **Visual Editor**, or
   create a new one from a template.
2. Build with blocks — generic blocks plus GDF-branded Hero, Statistics,
   CTA, Cards and Gallery; save any selected element as a reusable component.
3. Layers panel to restructure, Style manager for styling, Traits for
   attributes, device buttons for desktop/tablet/mobile.
4. **Autosave** stores a draft 4 s after your last change (skips identical
   payloads, never publishes, shows *Autosaved HH:MM*).
5. **Save draft** writes the document immediately (status unchanged).
6. **Save revision** snapshots the current state with a label you choose.
7. **Publish** (publisher/admin/super_admin) — confirmation → document saved
   + revision created + release manifest written + page flagged published.
   The RPC refuses editors with a clear error.
8. **Unpublish** — flips the document and page back to draft.
9. **Revisions** — preview any revision in a sandboxed frame and restore it;
   restoring first creates a "Before restore" backup revision of the current
   document, so recovery is always possible.

## Editor security

The preview renders untrusted document HTML in a **fully sandboxed iframe**
(`sandbox=""`, `srcdoc`, no `allow-scripts`, no `allow-same-origin`):
scripts cannot run and the frame cannot read cookies, localStorage or any
dashboard state. The previous release opened editor HTML through a
same-origin `blob:` URL — that hole is closed (see SECURITY.md).

## Publishing reality (three statuses)

| Status | Meaning |
|---|---|
| Draft saved | document stored in the database |
| Published (database) | release snapshot created, page flagged published |
| Public deployment | the live GDF'27 pages are static files on GitHub Pages — **not** automated by database publishing |

The editor and the Pages manager show this note explicitly. To take a visual
page live today: export it (**Code & Archives → ZIP export**) and add the
generated file to the repository, or replicate the content as a static page
(see DEPLOYMENT.md for the recommended future integration).

## Multi-website path

Projects are isolated at the database level (`can_manage_builder_project` +
cross-reference triggers). Creating a second website is safe today: create a
project, add visual pages, build them — nothing can leak into the GDF'27
public tables. What a new site still needs before going live is its own
publishing target (separate Pages deployment or a host-side integration),
which is a deliberate, documented next step rather than hidden magic.
