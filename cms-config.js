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
  url: "https://jsmhvlvifkzsuydqctfu.supabase.co",
  key: "sb_publishable_Koy30Joiyf8CntvTP-pfOg_RB-evRbP"
};
window.GDF_VERIFY_SUPABASE = {
  url: "https://tuibokbihauzhwhnbulx.supabase.co",
  key: "sb_publishable_iXJ7b-TGcV0HqhcbLihKzw_cI10anai"
};
