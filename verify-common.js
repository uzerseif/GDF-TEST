/* =========================================
   GDF'27 — shared helpers for the certificate pages
   (verify.html + certificate.html).
   Only a publishable/anon Supabase key belongs here — never a service_role key.
   ========================================= */
(function () {
  /* Configuration is centralised in cms-config.js (window.GDF_VERIFY_SUPABASE).
     The constants below are only a fallback for pages that load verify-common.js
     without cms-config.js. Only publishable/anon keys may appear here. */
  var cfg = (window.GDF_VERIFY_SUPABASE || {});
  var SUPABASE_URL = cfg.url || 'https://tuibokbihauzhwhnbulx.supabase.co';
  var SUPABASE_ANON_KEY = cfg.key || 'sb_publishable_iXJ7b-TGcV0HqhcbLihKzw_cI10anai';
  var LOCALES = { en: 'en-GB', ar: 'ar-u-nu-latn', tr: 'tr-TR' };
  var client = null;

  function lang() {
    return document.documentElement.lang || 'en';
  }

  /* Text from translations.js (English falls back to the string passed in). {name}-style placeholders are supported. */
  function t(key, fallback, vars) {
    var dict = (window.GDF_TRANSLATIONS && window.GDF_TRANSLATIONS[lang()]) || {};
    var text = (lang() !== 'en' && dict[key]) || fallback;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.replace('{' + name + '}', vars[name]);
      });
    }
    return text;
  }

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) return null;
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error(e);
      client = null;
    }
    return client;
  }

  /* Looks the certificate up through the verify_certificate() database function. Resolves to { cert } or { error }. */
  function lookup(id) {
    var db = getClient();
    if (!db) return Promise.resolve({ error: 'unavail' });
    return db.rpc('verify_certificate', { p_certificate_id: id }).then(function (res) {
      if (res.error) {
        console.error(res.error);
        return { error: 'failed' };
      }
      var cert = Array.isArray(res.data) ? res.data[0] : res.data;
      return cert ? { cert: cert } : { error: 'notfound' };
    }).catch(function (e) {
      console.error(e);
      return { error: 'unexpected' };
    });
  }

  function formatDate(value) {
    if (!value) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(LOCALES[lang()] || LOCALES.en, { day: '2-digit', month: 'long', year: 'numeric' });
  }

  window.GDFVerify = { t: t, normalize: normalize, lookup: lookup, formatDate: formatDate };
})();
