/* =====================================================================
   GDF'27 UCMS — Overview: dashboard (real data), recent activity,
   website health. Registered group: "overview".
   ===================================================================== */
(function () {
  "use strict";
  var A = window.CMSA, h = A.h, t = A.t, db = A.db, U = A.U;

  function statCard(label, pageId, icon) {
    var b = h("b", null, "…");
    var el = h("button", { type: "button", class: "stat", on: { click: function () { if (pageId) A.go(pageId); } } },
      h("span", { class: "ico", "aria-hidden": "true" }, icon || ""), b, h("span", null, label));
    el.setValue = function (v) { b.textContent = v; };
    el.setValueErr = function () { b.textContent = "—"; };
    return el;
  }
  function count(table) {
    return db.from(table).select("id", { count: "exact", head: true }).then(function (r) {
      return r.error ? null : (r.count || 0);
    });
  }

  /* ================= DASHBOARD ================= */
  A.register("dashboard", { group: "overview", icon: "⌂", title: "nav.dashboard", render: function (view) {
    /* --- quick actions --- */
    var quick = h("div", { class: "quick" });
    [["ucms.dash.qaPage", "pages", "＋"],
     ["ucms.dash.qaHome", "home", "◈"],
     ["ucms.dash.qaMedia", "media", "▣"],
     ["ucms.dash.qaEditor", "visual-editor", "▦"],
     ["ucms.dash.qaPreview", null, "↗"],
     ["ucms.dash.qaUsers", "users", "☰"]].forEach(function (q) {
      quick.appendChild(h("button", { type: "button", on: { click: function () {
        if (q[1]) A.go(q[1]);
        else window.open(new URL("./", document.baseURI).href, "_blank", "noopener");
      } } }, h("span", { class: "ico", "aria-hidden": "true" }, q[2]), h("span", null, t(q[0]))));
    });
    view.appendChild(quick);

    /* --- statistics --- */
    var stats = h("div", { class: "stats" });
    var cards = [
      ["ucms.dash.pages", "pages", "◇", null],
      ["ucms.dash.pagesPublished", "pages", "●", null],
      ["ucms.dash.pagesDraft", "pages", "○", null],
      ["ucms.dash.media", "media", "▣", "asset"],
      ["ucms.dash.members", "team", "♙", "team_members"],
      ["ucms.dash.sponsors", "sponsors", "✧", "sponsors"],
      ["ucms.dash.committees", "committees", "▤", "committees"],
      ["ucms.dash.apps", "applications", "↗", "applications"],
      ["ucms.dash.faqs", "faqs", "?", "faqs"],
      ["ucms.dash.textsEdited", "texts", "Aa", "texts"]
    ].map(function (c) { var el = statCard(t(c[0]), c[1], c[2]); el._kind = c[3]; stats.appendChild(el); return el; });
    view.appendChild(A.card(t("ucms.dash.stats"), stats, { help: t("ucms.dash.sub") }));

    /* --- recent activity + health side by side --- */
    var grid = h("div", { class: "dash-cols" });
    var actList = h("div", { class: "rows" });
    grid.appendChild(A.card(t("ucms.dash.activity"), actList, { help: t("ucms.dash.activityHint") }));
    var healthBox = h("div", { class: "checks" });
    var healthCard = A.card(t("ucms.dash.health"), [healthBox,
      h("div", { class: "card-foot" }, h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { A.go("health"); } } }, t("ucms.nav.health") + " →"))]);
    grid.appendChild(healthCard);
    view.appendChild(grid);

    /* --- projects strip (multi-website support) --- */
    var projRow = h("div", { class: "project-grid project-grid-sm" });
    var projCard = A.card(t("project.projects"), projRow);
    view.appendChild(projCard);

    function renderActivity() {
      return db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(8)
        .then(function (r) {
          actList.innerHTML = "";
          if (r.error) { actList.appendChild(h("div", { class: "empty" }, r.error.message)); return; }
          (r.data || []).forEach(function (e) {
            actList.appendChild(A.row({ id: e.id, draggable: false,
              title: e.resource_label || e.resource_type || e.action,
              sub: t("ucms.activity.actor") + ": " + (e.actor_email || "—") + " · " + A.fmtDateTime(e.created_at),
              badges: e.outcome === "error" ? A.badge(t("ucms.health.error"), "off") : (e.outcome === "denied" ? A.badge(t("ucms.activity.outcome") + ": denied", "gold") : null),
              actions: h("span", { class: "badge" }, e.action) }));
          });
          if (!(r.data || []).length) actList.appendChild(h("div", { class: "empty" }, t("ucms.dash.noActivity")));
        });
    }
    function renderHealth() {
      return A.health().then(function (res) {
        healthBox.innerHTML = "";
        res.checks.forEach(function (c) {
          var cls = c.status === "ok" ? "" : (c.status === "warn" ? " warn" : (c.status === "error" ? " bad" : " unk"));
          healthBox.appendChild(h("div", { class: "check" + cls, title: c.detail || "" }, h("i"), c.label + " · " + t("ucms.health." + (c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : c.status === "error" ? "error" : "unknown"))));
        });
      });
    }
    function renderProjects() {
      return db.from("builder_projects").select("id,slug,name,status,is_system,updated_at").order("updated_at", { ascending: false })
        .then(function (r) {
          projRow.innerHTML = "";
          if (r.error) { projRow.appendChild(h("div", { class: "empty" }, t("project.missing"))); return; }
          (r.data || []).forEach(function (p) {
            var status = p.status === "published" ? t("project.statusPublished") : (p.status === "archived" ? t("project.statusArchived") : t("project.statusDraft"));
            projRow.appendChild(h("div", { class: "project-mini" },
              h("div", null, h("b", null, A.tx(p.name) || p.slug),
                h("span", { class: "badge " + (p.status === "published" ? "ok" : (p.status === "archived" ? "off" : "gold")) }, status)),
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () { A.editorProjectId = p.id; A.go("visual-editor"); } } }, t("project.openEditor"))));
          });
        });
    }
    function renderStats() {
      return Promise.all([
        db.from("builder_project_pages").select("is_published", { count: "exact" }),
        count("builder_project_assets"), count("team_members"), count("sponsors"),
        count("committees"), count("applications"), count("faqs"),
        Promise.resolve(Object.keys(A.data.texts || {}).length),
        count("builder_project_revisions"), count("builder_project_releases")
      ]).then(function (r) {
        var pages = r[0], pub = 0, total = 0;
        if (!pages.error && pages.data) { total = pages.data.length; pub = pages.data.filter(function (x) { return x.is_published; }).length; }
        var values = [total, pub, Math.max(0, total - pub), r[1], r[2], r[3], r[4], r[5], r[6], r[7]];
        cards.forEach(function (c, i) {
          if (i < 3) { c.setValue(values[i] == null ? "—" : values[i]); return; }
          if (i === 9) { c.setValue(values[7] + ""); return; }
          c.setValue(values[i] == null ? "—" : values[i]);
        });
      });
    }
    return Promise.all([renderStats(), renderActivity(), renderHealth(), renderProjects()]).catch(A.fail);
  } });

  /* Recent activity list lives on the "audit" page (System Administration);
     the dashboard card above shows the latest entries. */

  /* ================= WEBSITE HEALTH ================= */
  A.register("health", { group: "overview", icon: "♥", title: "ucms.nav.health", render: function (view) {
    var box = h("div", { class: "checks" });
    var stamp = h("span", { class: "muted small" });
    var rerun = h("button", { type: "button", class: "btn btn-sm", on: { click: function () { run(); } } }, "↻ " + t("ucms.health.rerun"));
    view.appendChild(A.card(t("ucms.health.title"), [h("div", { class: "toolbar", "data-nodirty": "1" }, stamp, rerun), box], { help: t("ucms.health.sub") }));
    function run() {
      box.innerHTML = '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      return A.health().then(function (res) {
        box.innerHTML = "";
        stamp.textContent = t("ucms.health.lastRun") + ": " + A.fmtDateTime(res.at);
        var order = { ok: 0, warn: 1, error: 2, unknown: 3 };
        res.checks.slice().sort(function (a, b) { return order[b.status] - order[a.status]; }).forEach(function (c) {
          var label = t("ucms.health." + (c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : c.status === "error" ? "error" : "unknown"));
          box.appendChild(h("div", { class: "check big " + (c.status === "ok" ? "" : (c.status === "warn" ? " warn" : (c.status === "error" ? " bad" : " unk"))), role: "status" },
            h("i", { "aria-hidden": "true" }),
            h("div", null, h("b", null, c.label, " — ", label), h("div", { class: "muted small" }, c.detail || ""))));
        });
      }).catch(A.fail);
    }
    return run();
  } });
})();
