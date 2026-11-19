# SECURITY — GDF'27 UCMS

## 1. Principles

1. Only **publishable (anon) keys** exist in frontend code. No service_role
   or secret key appears in any file (checked by a static scan).
2. Every write is authorised by **Row Level Security** in the database, not
   by hiding interface elements. The UI mirrors permissions; it never gates
   them.
3. Security-definer helpers use an **empty `search_path`** — no function
   hijacking, no RLS recursion.
4. Untrusted HTML (editor documents, components, custom code, imports) is
   never executed inside the privileged admin context.
5. Secrets never reach the audit log; passwords are never stored outside
   Supabase Authentication.

## 2. Authentication

- Supabase Auth email/password with sessions persisted under the
  `gdf-admin-auth` storage key. Sign-ups are disabled in the Supabase
  dashboard; accounts are created by an administrator.
- On sign-in the dashboard reads `admin_users.role`; a user without a row is
  signed out immediately ("not an authorised CMS user").
- `onAuthStateChange` returns to the login screen on `SIGNED_OUT` (expired or
  revoked sessions land on the login view, not a broken dashboard).

## 3. Roles & enforcement map

| Capability | Editor | Publisher | Admin | Super Admin | Enforced by |
|---|---|---|---|---|---|
| Edit content (texts, sections, lists) | ✓ | ✓ | ✓ | ✓ | RLS `staff manage` on content tables |
| Upload / manage media | ✓ | ✓ | ✓ | ✓ | storage policies keyed on `is_staff()` |
| Design tokens & global settings | — | — | ✓ | ✓ | `site_settings` admin-write policy |
| Publish / unpublish documents | — | ✓ | ✓ | ✓ | `can_publish()` inside `publish_builder_document` RPC (v5) |
| Builder projects, components, templates | ✓ | ✓ | ✓ | ✓ | RLS via `can_manage_builder_project` |
| Manage users & roles | — | — | ✓ | ✓ | `admin_users` "admins manage" policy |
| Backups & restore | — | — | ✓ | ✓ | `create_cms_backup` admin check + RLS |
| Read audit logs | ✓ | ✓ | ✓ | ✓ | RLS staff-select; no update/delete policies |

Adding a role never required touching policies beyond the check constraint:
`is_staff()` is membership-based; the v5 migration widened
`admin_users_role` and added `can_publish()`.

## 4. Audit log integrity

`audit_logs` has **insert** (staff, via `log_admin_action`) and **select**
(staff) policies only. No update or delete policy exists, so no
authenticated role can rewrite or prune history from the API. Actor identity
(actor_id, email from JWT claims, role) is stamped server-side by the
security-definer function — client input cannot forge the actor. Retention
pruning, if ever needed, must run as service_role (documented; not exposed).

## 5. Editor sandboxing (fixed in this release)

The visual editor preview previously opened editor HTML via a **same-origin
`blob:` URL**. Any script embedded in a document or component could then read
`localStorage["gdf-admin-auth"]` — the admin session tokens. Now:

- In-editor and revision previews render in an iframe with `sandbox=""`
  and `srcdoc`: scripts disabled, unique opaque origin, no access to
  storage/cookies/DOM of the dashboard.
- `referrerpolicy="no-referrer"`.
- The Pages manager preview and template previews use the same mechanism.
- Rich text from the CMS on the **public** side is sanitised in `i18n.js`
  (allow-list: br/strong/b/em/i/u/a/p/span; href protocol allow-list) —
  unchanged behaviour, kept as-is.

## 6. Media upload validation

Client: MIME allow-list (jpeg/png/webp), 5 MB cap, slugified file names,
timestamped storage paths (no user-controlled path traversal). Server:
bucket `allowed_mime_types` (image/jpeg, image/png, image/webp — SVG
explicitly excluded) and 5 MB `file_size_limit`; storage writes require
`is_staff()`. Delete/rename/replace operations in the media library check
references first (see UCMS-GUIDE) so usage data cannot be destroyed by a
failed query marking files "unused".

## 7. Input validation

- URLs: protocol allow-lists (https/mailto/tel/#/relative), https-only where
  marked, Google-Maps-embed pattern for the venue iframe.
- JSONB settings are shape-checked server-side (`jsonb_typeof` checks in
  table constraints and RPC parameters).
- Backup restore re-upserts existing rows (overlay), never deletes rows
  outside the snapshot; restore is admin-only and always preceded by an
  automatic safety backup.
- Slugs are pattern-checked (`^[a-z0-9/-]+$` variants) at both the UI and
  the database constraint level.

## 8. Known residual risks (documented, not hidden)

- **Anonymous read of content tables is intended** (the public site needs
  it); unpublished content rows are protected by `is_published` policies,
  while `site_texts`/`page_sections`/`site_settings` are public by design.
- Certificate lookups run through the `verify_certificate` RPC on the second
  Supabase project — its policies live in `supabase-migration.sql` there.
- Browser-side rate limiting of the certificate lookup is not
  production-grade (see README.txt); consider a rate limiter at the edge.
- The dashboard is `noindex,nofollow`, but access control is the auth layer,
  not obscurity.
