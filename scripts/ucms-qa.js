#!/usr/bin/env node
/* =====================================================================
   GDF V4 UCMS — static QA (recreated; the original scripts/ucms-qa.js was
   not shipped in the archive). Checks, all offline:
     1. JS syntax of every project .js file (node --check via new Function
        is not equivalent — we spawn node directly).
     2. i18n integrity: every t("key") / data-t="key" used by the admin
        modules exists in ADMIN_I18N (en), and the ucms.* keys exist in
        ar + tr too.
     3. Dynamic key prefixes: t("prefix." + x) patterns have matches.
     4. Page-id integrity: every A.go("literal") target is registered.
     5. Local asset references: every <script src> / <link href> / <img src>
        in the HTML files resolves to a real file (base-href aware).
     6. Secret scan: no service_role / sb_secret_ keys in frontend files.
   Usage: node ucms-qa.js <project-root>
   Exit code 0 = all checks passed; 1 = failures found.
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.argv[2];
if (!ROOT || !fs.existsSync(ROOT)) { console.error("usage: node ucms-qa.js <project-root>"); process.exit(1); }

let failures = 0, checks = 0;
function report(name, ok, detail) {
  checks++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : ""));
  if (!ok) failures++;
}
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name === "Videos" || e.name === "images") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p);

/* ---------- 1. syntax ---------- */
const jsFiles = walk(ROOT).filter((f) => f.endsWith(".js") && !f.includes("vendor"));
let syntaxBad = 0;
for (const f of jsFiles) {
  try { execFileSync("node", ["--check", f], { stdio: "pipe" }); }
  catch (e) { syntaxBad++; console.log("SYNTAX FAIL " + rel(f) + ":\n" + e.stderr.toString().slice(0, 400)); }
}
report("JS syntax (" + jsFiles.length + " files)", syntaxBad === 0, syntaxBad + " bad");

/* ---------- 2/3. i18n integrity ---------- */
const shim = { window: {}, document: { querySelectorAll: () => [], documentElement: { lang: "en", classList: { add() {}, remove() {} } }, addEventListener() {}, head: null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) }, localStorage: { getItem: () => null, setItem() {} }, location: { pathname: "/", search: "", hash: "" }, addEventListener() {}, CustomEvent: function () {} };
shim.window = shim;
try {
  new Function("window", "document", "localStorage", "navigator", "location", "CustomEvent", fs.readFileSync(path.join(ROOT, "admin-i18n.js"), "utf8"))(shim, shim.document, shim.localStorage, {}, shim.location, shim.CustomEvent);
  new Function("window", "document", fs.readFileSync(path.join(ROOT, "admin-ucms-i18n.js"), "utf8"))(shim, shim.document);
} catch (e) {
  report("i18n dictionaries load", false, e.message);
}
const DICT = shim.window.ADMIN_I18N || {};
const enKeys = new Set(Object.keys(DICT.en || {}));

const modFiles = ["admin.js", "admin/ucms-core.js", "admin/pages-shared.js", "admin/pages-dashboard.js",
  "admin/pages-website.js", "admin/pages-content.js", "admin/pages-builder.js", "admin/pages-system.js"]
  .map((f) => path.join(ROOT, f));
let missingKeys = new Set(), dynamicPrefixes = new Set();
const KEY = /\bt\(\s*"([^"]+)"\s*\)/g, KEY_S = /\bt\(\s*'([^']+)'\s*\)/g, DYN = /\bt\(\s*"([a-z0-9_.-]+)\."\s*\+/g, DATA_T = /data-t="([^"]+)"/g;
for (const f of modFiles) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = KEY.exec(src))) if (!enKeys.has(m[1])) missingKeys.add(m[1] + "  (" + rel(f) + ")");
  while ((m = KEY_S.exec(src))) if (!enKeys.has(m[1])) missingKeys.add(m[1] + "  (" + rel(f) + ")");
  while ((m = DATA_T.exec(src))) if (!enKeys.has(m[1])) missingKeys.add(m[1] + "  (" + rel(f) + " data-t)");
  while ((m = DYN.exec(src))) dynamicPrefixes.add(m[1]);
}
report("static i18n keys resolve", missingKeys.size === 0, [...missingKeys].slice(0, 12).join("; "));
let dynOk = true, dynMissing = [];
for (const p of dynamicPrefixes) {
  if (![...enKeys].some((k) => k.startsWith(p + "."))) { dynOk = false; dynMissing.push(p); }
}
report("dynamic key prefixes (" + dynamicPrefixes.size + " prefixes)", dynOk, dynMissing.join("; "));

/* key parity across languages for ucms.* / err.* / msg.corePartial */
const parityMissing = [];
for (const k of enKeys) {
  if (!/^(ucms|err)\./.test(k) && k !== "msg.corePartial") continue;
  for (const l of ["ar", "tr"]) if (!(DICT[l] || {})[k]) parityMissing.push(l + ":" + k);
}
report("i18n ar/tr parity for ucms.*/err.* keys", parityMissing.length === 0, parityMissing.slice(0, 10).join("; "));

/* ---------- 4. page-id integrity ---------- */
const registered = new Set(), goTargets = new Set(), dupRegs = [];
const REG = /A\.register\(\s*"([^"]+)"/g, GO = /A\.go\(\s*"([^"]+)"/g, seen = new Map();
for (const f of modFiles) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = REG.exec(src))) {
    if (seen.has(m[1])) dupRegs.push(m[1]); else seen.set(m[1], rel(f));
    registered.add(m[1]);
  }
  while ((m = GO.exec(src))) goTargets.add(m[1]);
}
const badGo = [...goTargets].filter((id) => !registered.has(id));
report("A.go targets registered (" + registered.size + " pages)", badGo.length === 0 && dupRegs.length === 0,
  (badGo.join(",") + " " + dupRegs.join(",")).trim());

/* ---------- 5. local asset references ---------- */
const htmlFiles = walk(ROOT).filter((f) => f.endsWith(".html"));
let badRefs = [];
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, ""); /* comments may hold retired markup */
  const base = /<base\s+href="([^"]*)"/i.exec(html);
  const baseDir = base ? path.join(path.dirname(f), base[1]) : path.dirname(f);
  const RE = /(?:src|href)\s*=\s*"([^"#]+?)"/gi;
  let m;
  while ((m = RE.exec(html))) {
    const v = m[1].trim();
    if (!v || /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(v)) continue;
    if (/\{\{|\}$/.test(v)) continue;
    const clean = v.split("?")[0].split("#")[0];
    if (!clean || clean.endsWith("/")) continue; /* clean-route URLs */
    const target = path.resolve(baseDir, clean);
    if (!fs.existsSync(target)) badRefs.push(rel(f) + " -> " + v);
  }
}
report("local asset references (" + htmlFiles.length + " html files)", badRefs.length === 0, badRefs.slice(0, 10).join("; "));

/* ---------- 6. secret scan ---------- */
let secrets = [];
for (const f of walk(ROOT)) {
  if (f.endsWith("scripts/ucms-qa.js") || f.endsWith("\\ucms-qa.js")) continue; /* the scanner itself */
  if (!/\.(js|html|css|sql|md|txt)$/.test(f)) continue;
  const raw = fs.readFileSync(f, "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*--.*$/gm, ""); /* sql line comments */
  /* prose in docs mentions the words; only flag actual key literals */
  if (/sb_secret_[A-Za-z0-9_-]+/.test(src)) secrets.push(rel(f) + " sb_secret_ literal");
  if (/service_role_key\s*[:=]/i.test(src)) secrets.push(rel(f) + " service_role assignment");
  if (/\.(js|html|css)$/.test(f)) {
    if (/service_role/i.test(src)) secrets.push(rel(f) + " mentions service_role in code");
    const supaKey = /supabase[^"']*["']([\w-]{40,})["']/gi;
    let m;
    while ((m = supaKey.exec(src))) if (!/^sb_publishable_/.test(m[1]) && !/^eyJ/.test(m[1])) secrets.push(rel(f) + " suspicious literal key");
  }
}
report("secret scan", secrets.length === 0, secrets.join("; "));

console.log("\n" + (failures ? failures + " CHECK(S) FAILED" : "ALL " + checks + " CHECKS PASSED"));
process.exit(failures ? 1 : 0);
