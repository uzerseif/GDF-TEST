/* =====================================================================
   GDF'27 UCMS — shared core for the new administrative surfaces.
   Depends on admin.js (window.CMSA = A) and the v5 migration tables.
   Provides: audit logging, notifications (bell + page), global search
   (Ctrl/⌘+K), website health checks, role capabilities, date helpers.
   ===================================================================== */
(function () {
  "use strict";
  var A = window.CMSA, h = A.h, t = A.t, db = A.db, $ = A.$, $$ = A.$$;

  /* ---------------- role capabilities (set on sign-in) ---------------- */
  A.can = A.can || {};
  A.applyCapabilities = function () {
    var r = A.role;
    A.can.publish = r === "publisher" || r === "admin" || r === "super_admin";
    A.can.design = r === "admin" || r === "super_admin";
    A.can.users = r === "admin" || r === "super_admin";
    A.can.backups = r === "admin" || r === "super_admin";
    A.can.settings = r === "admin" || r === "super_admin";
    A.can.audit = true; /* every staff member may read; RLS enforces the rest */
  };

  /* ---------------- audit logging (never breaks a save) ---------------- */
  A.log = function (action, resourceType, resourceId, resourceLabel, metadata, outcome) {
    return db.rpc("log_admin_action", {
      p_action: action,
      p_resource_type: resourceType || null,
      p_resource_id: resourceId == null ? null : String(resourceId),
      p_resource_label: resourceLabel == null ? null : String(resourceLabel).slice(0, 200),
      p_metadata: metadata || {},
      p_outcome: outcome || "success"
    }).then(function (r) {
      if (r.error) console.warn("audit:", r.error.message);
      return r;
    }).catch(function (e) { console.warn("audit:", e && e.message); });
  };

  /* ---------------- notifications ---------------- */
  A.notify = function (severity, titleKeyOrText, body, link) {
    var title = t(titleKeyOrText) === titleKeyOrText ? titleKeyOrText : t(titleKeyOrText);
    return db.rpc("notify_staff", {
      p_severity: severity || "info",
      p_title: String(title || "").slice(0, 200),
      p_body: body == null ? null : String(body).slice(0, 2000),
      p_link: link == null ? null : String(link).slice(0, 500)
    }).catch(function (e) { console.warn("notify:", e && e.message); });
  };

  var bellBtn = null, bellDot = null;
  function renderBell() {
    var host = $(".top-actions");
    if (!host || bellBtn) return;
    bellBtn = h("button", { type: "button", class: "icon-btn bell", id: "notifBell",
      "aria-label": t("ucms.nav.notifications"), title: t("ucms.nav.notifications") }, "🔔");
    bellDot = h("span", { class: "bell-dot", hidden: true });
    bellBtn.appendChild(bellDot);
    host.insertBefore(bellBtn, host.firstChild);
    bellBtn.addEventListener("click", function (e) { e.stopPropagation(); openBellPanel(); });
    document.addEventListener("click", function (e) {
      if (bellPanel && !bellPanel.contains(e.target)) closeBellPanel();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && bellPanel) closeBellPanel();
    });
  }
  var bellPanel = null;
  function closeBellPanel() { if (bellPanel) { bellPanel.remove(); bellPanel = null; } }
  function refreshBellCount() {
    if (!A.user) return;
    db.from("cms_notifications").select("id", { count: "exact", head: true }).eq("is_read", false)
      .then(function (r) {
        var n = r.error ? 0 : (r.count || 0);
        if (bellDot) { bellDot.hidden = n === 0; bellDot.textContent = n > 99 ? "99+" : String(n); }
      });
  }
  function markRead(n) {
    return db.from("cms_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", n.id)
      .then(function () { refreshBellCount(); });
  }
  function openBellPanel() {
    closeBellPanel();
    bellPanel = h("div", { class: "bell-panel", role: "dialog", "aria-label": t("ucms.nav.notifications") });
    var list = h("div", { class: "bell-list" });
    bellPanel.appendChild(h("div", { class: "bell-head" },
      h("strong", null, t("ucms.nav.notifications")),
      h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () {
        db.from("cms_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("is_read", false)
          .then(function (r) { if (r.error) return A.fail(r.error); refreshBellCount(); closeBellPanel(); });
      } } }, t("ucms.notif.markAll"))));
    bellPanel.appendChild(list);
    document.querySelector(".topbar").appendChild(bellPanel);
    list.appendChild(h("div", { class: "empty" }, h("span", { class: "spinner sm" })));
    db.from("cms_notifications").select("*").order("created_at", { ascending: false }).limit(12)
      .then(function (r) {
        list.innerHTML = "";
        if (r.error) { list.appendChild(h("div", { class: "empty" }, r.error.message)); return; }
        (r.data || []).forEach(function (n) {
          list.appendChild(h("button", { type: "button", class: "bell-item" + (n.is_read ? "" : " unread"),
            on: { click: function () { markRead(n); closeBellPanel(); if (n.link) A.go(n.link); else A.go("notifications"); } } },
            h("span", { class: "sev sev-" + n.severity, "aria-hidden": "true" }),
            h("span", { class: "bi" }, h("b", null, n.title), n.body ? h("small", null, n.body) : null,
              h("small", { class: "muted" }, A.fmtDateTime(n.created_at)))));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("ucms.notif.empty")));
      });
  }

  /* ---------------- global search (Ctrl/⌘+K) ---------------- */
  var searchDlg = null, searchSeq = 0;
  function openSearch() {
    if (searchDlg) { var inp = $("#ucmsSearchInput"); if (inp) inp.focus(); return; }
    var input = h("input", { type: "search", id: "ucmsSearchInput", placeholder: t("ucms.search.placeholder"),
      "aria-label": t("ucms.search.title") });
    var results = h("div", { class: "search-results" });
    var box = h("div", { class: "search-box", role: "dialog", "aria-modal": "true", "aria-label": t("ucms.search.title") },
      h("div", { class: "search-bar" }, input, h("kbd", null, t("ucms.search.hint")),
        h("button", { type: "button", class: "icon-btn", "aria-label": t("btn.close"), on: { click: closeSearch } }, "✕")),
      results);
    var bd = h("div", { class: "modal-backdrop search-backdrop" }, box);
    document.body.appendChild(bd);
    searchDlg = bd;
    bd.addEventListener("mousedown", function (e) { if (e.target === bd) closeSearch(); });
    document.addEventListener("keydown", escClose);
    setTimeout(function () { input.focus(); }, 30);
    function escClose(e) { if (e.key === "Escape") closeSearch(); }
    function closeSearch() { bd.remove(); searchDlg = null; document.removeEventListener("keydown", escClose); }

    var timer = null;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; return; }
      timer = setTimeout(function () { runSearch(q, ++searchSeq, results); }, 220);
    });
  }
  function resultGroup(title, items) {
    if (!items.length) return null;
    return h("div", { class: "sr-group" }, h("div", { class: "sr-title" }, title),
      items.map(function (it) {
        return h("button", { type: "button", class: "sr-item", on: { click: function () { closeSearchDialog(); A.go(it.page); } } },
          h("span", { class: "sr-ico", "aria-hidden": "true" }, it.icon || "•"),
          h("span", { class: "sr-main" }, h("b", null, it.title), it.sub ? h("small", null, it.sub) : null));
      }));
    function closeSearchDialog() { var b = document.querySelector(".search-backdrop"); if (b) b.remove(); searchDlg = null; }
  }
  function runSearch(q, seq, results) {
    var like = "%" + q.replace(/[%_,]/g, "") + "%";
    /* value->>xx.ilike is valid PostgREST jsonb-arrow syntax; the former
       value::text.ilike cast was rejected by PostgREST and silently emptied
       the text results. Errors are surfaced instead of swallowed. */
    var jobs = [
      db.from("builder_project_pages").select("id,slug,title,project_id,is_published").or("slug.ilike." + like + ",title->>en.ilike." + like).limit(5),
      db.from("site_texts").select("key,value").or("key.ilike." + like + ",value->>en.ilike." + like + ",value->>ar.ilike." + like + ",value->>tr.ilike." + like).limit(6),
      db.from("team_members").select("id,name,role").filter("name->>en", "ilike", like).limit(4),
      db.from("sponsors").select("id,name").ilike("name", like).limit(4),
      db.from("committees").select("id,slug,name").filter("name->>en", "ilike", like).limit(4),
      db.from("faqs").select("id,question").filter("question->>en", "ilike", like).limit(4),
      db.from("applications").select("id,title").filter("title->>en", "ilike", like).limit(4),
      db.from("builder_project_assets").select("id,name,asset_url").ilike("name", like).limit(5)
    ];
    Promise.all(jobs.map(function (j) {
      return j.then(function (r) {
        if (r.error) { console.warn("search:", r.error.message); return { ok: false, data: [] }; }
        return { ok: true, data: r.data || [] };
      }, function () { return { ok: false, data: [] }; });
    }))
      .then(function (all) {
        if (seq !== searchSeq) return;
        results.innerHTML = "";
        var texts = all[1].data.map(function (x) {
          var v = x.value || {};
          return { icon: "Aa", title: x.key, sub: v.en || v.ar || v.tr || "", page: "texts" };
        });
        var content = [].concat(
          all[2].data.map(function (x) { return { icon: "♙", title: A.tx(x.name), sub: A.tx(x.role), page: "team" }; }),
          all[3].data.map(function (x) { return { icon: "✧", title: x.name, page: "sponsors" }; }),
          all[4].data.map(function (x) { return { icon: "▤", title: A.tx(x.name), sub: x.slug, page: "committees" }; }),
          all[5].data.map(function (x) { return { icon: "?", title: A.tx(x.question), page: "faqs" }; }),
          all[6].data.map(function (x) { return { icon: "↗", title: A.tx(x.title), page: "applications" }; }),
          all[7].data.map(function (x) { return { icon: "▣", title: x.name, sub: "media", page: "media" }; })
        );
        var pages = all[0].data.map(function (x) {
          return { icon: "◇", title: A.tx(x.title) || x.slug, sub: x.slug, page: "pages" };
        });
        var frag = document.createDocumentFragment();
        [resultGroup(t("ucms.search.groupPages"), pages),
         resultGroup(t("ucms.search.groupTexts"), texts),
         resultGroup(t("ucms.search.groupContent"), content)].forEach(function (g) { if (g) frag.appendChild(g); });
        if (!frag.childNodes.length) frag.appendChild(h("div", { class: "empty" }, t("ucms.search.empty")));
        results.appendChild(frag);
      });
  }

  /* ---------------- website health checks ---------------- */
  A.health = function () {
    function check(id, labelKey, fn) {
      return { id: id, label: t(labelKey), status: "unknown", detail: "", run: fn };
    }
    var started = Date.now();
    var checks = [
      check("auth", "ucms.health.auth", function () {
        if (!A.user) return { status: "error", detail: t("top.logout") };
        return { status: "ok", detail: t("ucms.health.authOk") + " · " + t("role." + (A.role || "editor")) };
      }),
      check("db", "ucms.health.db", function () {
        return db.from("site_settings").select("key", { head: true }).limit(1).then(function (r) {
          if (r.error) return { status: "error", detail: r.error.message };
          return { status: "ok", detail: t("ucms.health.dbOk") + " (" + (Date.now() - started) + " ms)" };
        });
      }),
      check("storage", "ucms.health.storage", function () {
        return db.storage.from("site-media").list("", { limit: 1 }).then(function (r) {
          if (r.error) return { status: "error", detail: r.error.message };
          return { status: "ok", detail: t("ucms.health.storageOk") };
        });
      }),
      check("deps", "ucms.health.deps", function () {
        var need = { supabase: window.supabase, grapesjs: window.grapesjs, CodeMirror: window.CodeMirror, JSZip: window.JSZip };
        var missing = Object.keys(need).filter(function (k) { return !need[k]; });
        if (missing.length) return { status: "warn", detail: t("ucms.health.depsMissing") + ": " + missing.join(", ") };
        return { status: "ok", detail: t("ucms.health.depsOk") };
      }),
      check("migrations", "ucms.health.migrations", function () {
        return db.from("builder_projects").select("id", { count: "exact", head: true }).then(function (r) {
          if (r.error) return { status: "warn", detail: t("ucms.health.migrationsMissing") };
          return db.from("audit_logs").select("id", { count: "exact", head: true }).then(function (r2) {
            if (r2.error) return { status: "warn", detail: t("ucms.health.migrationsMissing") + " (v5)" };
            return { status: "ok", detail: t("ucms.health.migrationsOk") };
          });
        });
      }),
      check("publish", "ucms.health.publish", function () {
        return db.from("builder_project_pages").select("is_published", { count: "exact" }).then(function (r) {
          if (r.error) return { status: "unknown", detail: r.error.message };
          var rows = r.data || [], pub = rows.filter(function (x) { return x.is_published; }).length;
          return { status: "ok", detail: pub + " / " + rows.length + " " + t("ucms.health.publishDetail") };
        });
      }),
      check("errors", "ucms.health.errors", function () {
        return db.from("audit_logs").select("id", { count: "exact", head: true })
          .eq("outcome", "error").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString())
          .then(function (r) {
            if (r.error) return { status: "unknown", detail: r.error.message };
            var n = r.count || 0;
            return n ? { status: "warn", detail: n + " " + t("ucms.health.errorsSome") }
                     : { status: "ok", detail: t("ucms.health.errorsOk") };
          });
      }),
      check("certs", "ucms.health.certProject", function () {
        var ok = window.GDF_VERIFY_SUPABASE && window.GDF_VERIFY_SUPABASE.url;
        return Promise.resolve(ok ? { status: "ok", detail: t("ucms.health.certOk") }
                                  : { status: "warn", detail: t("ucms.health.certMissing") });
      })
    ];
    return Promise.all(checks.map(function (c) {
      return Promise.resolve().then(c.run).then(function (res) {
        c.status = (res && res.status) || "unknown";
        c.detail = (res && res.detail) || "";
      }).catch(function (e) { c.status = "error"; c.detail = (e && e.message) || "error"; });
    })).then(function () { return { checks: checks, at: new Date().toISOString() }; });
  };

  /* =====================================================================
     DATABASE HEALTH CHECKER (system diagnostics)
     Verifies connection, required tables/columns, RPC functions, storage
     bucket, RLS behaviour and applied migrations — without destructive
     calls and without exposing secrets. Statuses: ok / missing / permission
     / migration / fail. Side-effect probes raise server-side validation
     errors on purpose (they never insert anything).
     ===================================================================== */
  var NIL_UUID = "00000000-0000-0000-0000-000000000000";
  function isMissingFn(err) {
    return err && /could not find the function|PGRST202|schema cache/i.test(err.message || "");
  }
  function isMissingRelation(err) {
    return err && /does not exist|schema cache|relation/i.test(err.message || "");
  }
  function isPermission(err) {
    return err && /row-level|permission|JWT|401|403/i.test(err.message || "");
  }
  A.dbHealth = function () {
    function item(label, promise) {
      return { label: label, status: "unknown", detail: "", run: function () {
        return Promise.resolve().then(promise).then(function (res) {
          if (res && res.status) { item.status = res.status; item.detail = res.detail || ""; }
          else { item.status = "ok"; item.detail = (res && res.detail) || ""; }
        }).catch(function (e) {
          var err = (e && e.message) ? e : (e && e.raw ? e.raw : e);
          if (isMissingRelation(err)) { item.status = "missing"; item.detail = t("ucms.health.dbMissing"); }
          else if (isPermission(err)) { item.status = "permission"; item.detail = (err && err.message) || ""; }
          else { item.status = "fail"; item.detail = (err && err.message) || "Connection failed"; }
        });
      } };
    }
    var TABLES = [
      ["site_texts", null, "v4"], ["page_sections", null, "v4"], ["team_groups", null, "v4"],
      ["site_settings", null, "v4"], ["committees", null, "base"], ["faqs", null, "base"],
      ["sponsors", null, "base"], ["applications", null, "base"], ["team_members", null, "base"],
      ["team_tabs", null, "base"], ["team_placements", null, "base"],
      ["audit_logs", null, "v5"], ["cms_notifications", null, "v5"], ["cms_backups", null, "v5"],
      ["builder_page_templates", null, "v5"],
      ["builder_projects", null, "b1"], ["builder_project_settings", null, "b1"],
      ["builder_project_pages", null, "b1"], ["builder_project_assets", null, "b1"],
      ["builder_editor_documents", null, "b2"], ["builder_project_components", null, "b2"],
      ["builder_project_revisions", null, "b2"], ["builder_project_navigation", null, "b3"],
      ["builder_project_heroes", null, "b4"], ["builder_project_responsive", null, "b4"],
      ["builder_project_custom_code", null, "b5"], ["builder_project_archives", null, "b5"],
      ["builder_project_releases", null, "b6"], ["builder_project_integrations", null, "b7"],
      ["builder_project_test_runs", null, "b8"]
    ];
    var COLUMNS = [
      ["builder_editor_documents", "id,project_id,page_id,html,css,javascript,assets,status", "b2"],
      ["builder_project_revisions", "id,project_id,page_id,document_id,label,html,css,javascript,assets,created_by", "b2"],
      ["builder_project_pages", "id,project_id,slug,title,page_type,is_home,is_published,sort_order", "b1"],
      ["team_members", "id,name,role,bio,photo_url,social,sort_order,is_published", "v4"],
      ["site_texts", "key,value,is_html", "v4"],
      ["site_settings", "key,value,label", "base"]
    ];
    var RPCS = [
      ["log_admin_action", { p_action: "HEALTHCHECK_INVALID", p_metadata: {} }, "v5"],
      ["notify_staff", { p_severity: "invalid", p_title: "healthcheck" }, "v5"],
      ["create_cms_backup", { p_label: "x".repeat(130) }, "v5"],
      ["publish_builder_document", { p_document_id: NIL_UUID, p_label: "healthcheck" }, "v5"],
      ["restore_builder_revision", { p_revision_id: NIL_UUID }, "b6"],
      ["can_manage_builder_project", { p_project_id: NIL_UUID }, "b1"]
    ];
    var MIGRATION_LABEL = { v4: "CMS v4", v5: "UCMS v5", b1: "Builder v1", b2: "Builder v2", b3: "Builder v3", b4: "Builder v4", b5: "Builder v5", b6: "Builder v6", b7: "Builder v7", b8: "Builder v8", base: "base schema" };
    var groups = [];
    var gConn = { name: t("ucms.health.gConn"), status: "ok", items: [] };
    var gTables = { name: t("ucms.health.gTables"), status: "ok", items: [] };
    var gCols = { name: t("ucms.health.gColumns"), status: "ok", items: [] };
    var gRpc = { name: t("ucms.health.gRpc"), status: "ok", items: [] };
    var gStorage = { name: t("ucms.health.gStorage"), status: "ok", items: [] };
    var gRls = { name: t("ucms.health.gRls"), status: "ok", items: [] };
    var gMig = { name: t("ucms.health.gMigrations"), status: "ok", items: [] };
    groups.push(gConn, gTables, gCols, gRpc, gStorage, gRls, gMig);

    /* 1. connection */
    var conn = item(t("ucms.health.db"), function () {
      return db.from("site_settings").select("key", { head: true, count: "exact" }).limit(1).then(function (r) {
        if (r.error) throw r.error;
        return { status: "ok", detail: t("ucms.health.dbOk") };
      });
    });
    gConn.items.push(conn);

    /* 2. tables + migration status derived from which family is missing */
    var missingByFamily = {};
    TABLES.forEach(function (tf) {
      var it = item(tf[0], function () {
        return db.from(tf[0]).select("id", { head: true, count: "exact" }).limit(1).then(function (r) {
          if (r.error) throw r.error;
          return { status: "ok", detail: MIGRATION_LABEL[tf[2]] };
        });
      });
      it._family = tf[2];
      it._origRun = it.run;
      it.run = function () {
        return it._origRun().then(function () {
          if (it.status !== "ok") missingByFamily[tf[2]] = true;
        });
      };
      gTables.items.push(it);
    });

    /* 3. columns (probe several critical columns in one head count) */
    COLUMNS.forEach(function (cf) {
      var it = item(cf[0] + " · " + cf[1].split(",").length + " cols", function () {
        return db.from(cf[0]).select(cf[1], { head: true, count: "exact" }).limit(1).then(function (r) {
          if (r.error) throw r.error;
          return { status: "ok" };
        });
      });
      gCols.items.push(it);
    });

    /* 4. RPC functions: safe probes that raise server-side validation errors
          (or return a boolean) — they never insert or update anything. */
    RPCS.forEach(function (rf) {
      var it = item(rf[0] + "()", function () { return null; });
      it.run = function () {
        return db.rpc(rf[0], rf[1]).then(function (r) {
          if (r.error) throw r.error;
          it.status = "ok"; it.detail = t("ucms.health.rpcOk");
        }).catch(function (e) {
          var msg = (e && e.message) || "";
          if (isMissingFn(e) || isMissingRelation(e)) { it.status = "missing"; it.detail = t("ucms.health.migrationsMissing"); missingByFamily[rf[2]] = true; }
          else if (/Not authorized|requires the publisher|Only administrators|Invalid|too long|not found/i.test(msg)) { it.status = "ok"; it.detail = t("ucms.health.rpcOk"); }
          else if (isPermission(e)) { it.status = "permission"; it.detail = msg; }
          else { it.status = "fail"; it.detail = msg || "Connection failed"; }
        });
      };
      gRpc.items.push(it);
    });

    /* 5. storage bucket */
    var storageIt = item(t("ucms.health.storage"), function () {
      return db.storage.from("site-media").list("", { limit: 1 }).then(function (r) {
        if (r.error) throw r.error;
        return { status: "ok", detail: t("ucms.health.storageOk") };
      });
    });
    gStorage.items.push(storageIt);

    /* 6. RLS behaviour with the anon role (publishable key, no session):
          public must read CMS content, must NOT read staff rows and must NOT write. */
    function anonFetch(url, opts) {
      opts = opts || {};
      return fetch(url, Object.assign({
        headers: { apikey: (window.GDF_SUPABASE || {}).key || "", "Content-Type": "application/json" }
      }, opts)).then(function (res) { return { status: res.status, ok: res.ok }; });
    }
    var rest = ((window.GDF_SUPABASE || {}).url || "").replace(/\/$/, "");
    gRls.items.push(item(t("ucms.health.rlsPublicRead"), function () {
      return anonFetch(rest + "/rest/v1/site_texts?select=key&limit=1").then(function (res) {
        if (res.status === 200) return { status: "ok" };
        if (res.status === 401 || res.status === 403) return { status: "permission", detail: t("ucms.health.rlsBlocked") };
        throw new Error("HTTP " + res.status);
      });
    }));
    gRls.items.push(item(t("ucms.health.rlsStaffHidden"), function () {
      return anonFetch(rest + "/rest/v1/admin_users?select=user_id&limit=5").then(function (res) {
        if (res.status !== 200) throw new Error("HTTP " + res.status);
        return res.json().then(function (rows) {
          /* own-row RLS: an anonymous caller sees zero rows */
          return (rows || []).length === 0 ? { status: "ok" } : { status: "fail", detail: t("ucms.health.rlsLeak") };
        });
      });
    }));
    gRls.items.push(item(t("ucms.health.rlsNoAnonWrite"), function () {
      return anonFetch(rest + "/rest/v1/site_texts", {
        method: "POST", body: JSON.stringify([{ key: "healthcheck-invalid-key", value: {} }])
      }).then(function (res) {
        if (res.status === 401 || res.status === 403 || res.status === 404) return { status: "ok" };
        throw new Error("HTTP " + res.status);
      });
    }));

    /* 7. certificate service (second Supabase project) */
    var vcfg = window.GDF_VERIFY_SUPABASE || {};
    if (vcfg.url && vcfg.key) {
      gStorage.items.push(item(t("ucms.health.certProject"), function () {
        return fetch(vcfg.url.replace(/\/$/, "") + "/rest/v1/rpc/verify_certificate", {
          method: "POST",
          headers: { apikey: vcfg.key, "Content-Type": "application/json" },
          body: JSON.stringify({ p_certificate_id: "HEALTHCHECK" })
        }).then(function (res) {
          if (res.status === 200) return { status: "ok", detail: t("ucms.health.rpcOk") };
          if (res.status === 404) return { status: "missing", detail: "verify_certificate() RPC" };
          throw new Error("HTTP " + res.status);
        });
      }));
    }

    /* aggregate: the worst item status wins */
    function rollup(g) {
      var bad = { fail: 3, missing: 3, permission: 2, warn: 1 };
      var s = "ok";
      g.items.forEach(function (it) {
        if (bad[it.status] && bad[it.status] > (bad[s] || 0)) s = it.status;
        else if (s === "ok" && it.status !== "ok") s = it.status;
      });
      g.status = s;
    }
    return Promise.all([].concat.apply([], groups.map(function (g) { return g.items.map(function (it) { return it.run(); }); })))
      .then(function () {
        groups.forEach(rollup);
        var migMissing = Object.keys(missingByFamily);
        if (migMissing.length) {
          gMig.status = "migration";
          gMig.items.push({ label: t("ucms.health.migrations"), status: "migration", detail: migMissing.map(function (f) { return MIGRATION_LABEL[f] || f; }).join(", ") });
        } else {
          gMig.status = "ok";
          gMig.items.push({ label: t("ucms.health.migrations"), status: "ok", detail: t("ucms.health.migrationsOk") });
        }
        return { groups: groups, at: new Date().toISOString() };
      });
  };

  /* ---------------- date helpers ---------------- */
  A.fmtDate = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };
  A.fmtDateTime = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit" });
  };

  /* ---------------- boot-time wiring ---------------- */
  var bellInterval = null;
  A.ucmsBootUI = function () {
    renderBell();
    refreshBellCount();
    var host = $(".top-actions");
    if (host && !$("#ucmsSearchBtn")) {
      var btn = h("button", { type: "button", class: "btn btn-ghost", id: "ucmsSearchBtn" },
        "🔍 ", h("span", { class: "hide-sm" }, t("ucms.search.title")));
      btn.addEventListener("click", openSearch);
      host.insertBefore(btn, bellBtn.nextSibling);
    }
    /* one polling interval per session, never one per sign-in */
    if (!bellInterval) bellInterval = setInterval(refreshBellCount, 60000);
  };
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      if (A.user) { e.preventDefault(); openSearch(); }
    }
  });
})();
