/* GDF'27 CMS — Supabase connections used by the public site and the UCMS.
   Only PUBLISHABLE (anon) keys belong here. Never put a secret / service_role
   key in this file.

   Two Supabase projects are in use:
   - GDF_SUPABASE: the main CMS (texts, sections, settings, content tables,
     Builder Studio, audit logs, backups).
   - GDF_VERIFY_SUPABASE: the certificate service. Its `certificates` table
     and `verify_certificate()` RPC live in a separate project; verify.js and
     certificate.js keep reading this configuration. */
window.GDF_SUPABASE = {
  url: "https://grjyfqdyywjxuncrumkd.supabase.co",
  key: "sb_publishable_TfErEd2_rdGZzJGL6h8f8Q_89u4Xzf0"
};
window.GDF_VERIFY_SUPABASE = {
  url: "https://grjyfqdyywjxuncrumkd.supabase.co",
  key: "sb_publishable_TfErEd2_rdGZzJGL6h8f8Q_89u4Xzf0"
};
