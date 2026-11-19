/* =====================================================================
   GDF'27 UCMS — Website Management (group "website"):
   Pages (unified), Header, Homepage, President, Footer, SEO,
   Global Website Settings. The section editors come from pages-shared.js
   and write to the same site_texts / page_sections tables as before.
   ===================================================================== */
(function () {
  "use strict";
  var A = window.CMSA, h = A.h, t = A.t, db = A.db, U = A.U;

  /* ==================================================================== */
  /* UNIFIED PAGES                                                        */
  /* ==================================================================== */
  var CONTENT_PAGE_OF = { "./": "home", "about/": "about", "applications/": "applications",
    "committees/": "committees", "faq/": "faqs", "team/": "team", "president/": "president" };
  A.register("pages", { group: "website", icon: "◇", title: "ucms.nav.pages", render: function (view) {
    var projectSelect = h("select");
    var projectId = A.editorProjectId || null;
    var projectIsSystem = false;
    var list = h("div", { class: "rows" });
    var note = h("p", { class: "muted small" }, t("ucms.pages.publishNote"));

    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name,status,is_system").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) { projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug)); });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        var sel = (r.data || []).filter(function (p) { return p.id === projectSelect.value; })[0];
        projectIsSystem = !!(sel && sel.is_system);
        return load();
      });
    }
    function lastPublishedMap() {
      return db.from("builder_project_releases").select("manifest,created_at").eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(50).then(function (r) {
          var map = {};
          if (!r.error) (r.data || []).forEach(function (rel) {
            var pid = rel.manifest && rel.manifest.page_id;
            if (pid && !map[pid]) map[pid] = rel.created_at;
          });
          return map;
        });
    }
    function statusBadges(p) {
      var out = [];
      if (p.page_type === "legacy") out.push(A.badge(t("ucms.pages.statusLive"), "ok"));
      out.push(p.is_published ? A.badge(t("ucms.pages.statusPublished"), "ok") : A.badge(t("ucms.pages.statusHidden"), "off"));
      if (p.is_home) out.push(A.badge(t("manage.homePage"), "gold"));
      return out;
    }
    function load() {
      list.innerHTML = '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      return Promise.all([
        db.from("builder_project_pages").select("*").eq("project_id", projectId).order("sort_order"),
        lastPublishedMap()
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        var rows = res[0].data || [], pub = res[1];
        list.innerHTML = "";
        if (!rows.length) { list.appendChild(h("div", { class: "empty" }, t("ucms.pages.noPages"))); return; }
        rows.forEach(function (p) {
          var contentPage = CONTENT_PAGE_OF[p.slug];
          var actions = h("div", { class: "r-actions" });
          if (contentPage && A.pages[contentPage]) {
            actions.appendChild(h("button", { type: "button", class: "btn btn-sm", title: t("ucms.pages.openContent"),
              on: { click: function () { A.editorProjectId = projectId; A.go(contentPage); } } }, t("ucms.pages.openContent")));
          }
          actions.appendChild(h("button", { type: "button", class: "btn btn-sm", title: t("ucms.pages.openVisual"),
            on: { click: function () { A.editorProjectId = projectId; A.editorTargetPageId = p.id; A.go("visual-editor"); } } }, t("ucms.pages.openVisual")));
          if (p.page_type !== "legacy") {
            actions.appendChild(h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { openSandboxPreview(p); } } }, t("ucms.pages.preview")));
          } else {
            actions.appendChild(h("a", { class: "btn btn-sm btn-ghost", target: "_blank", rel: "noopener",
              href: new URL(p.slug === "./" ? "./" : p.slug, document.baseURI).href }, t("ucms.pages.preview")));
          }
          if (A.can.publish && p.page_type !== "legacy") {
            actions.appendChild(p.is_published
              ? h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { unpublishPage(p); } } }, t("ucms.pages.unpublish"))
              : h("button", { type: "button", class: "btn btn-sm btn-gold", on: { click: function () { publishPage(p); } } }, t("ucms.pages.publish")));
          }
          actions.appendChild(h("button", { type: "button", class: "icon-btn", title: t("ucms.pages.revisions"),
            on: { click: function () { showRevisions(p); } } }, "⏱"));
          actions.appendChild(h("button", { type: "button", class: "icon-btn", title: t("btn.edit"),
            on: { click: function () { editPage(p); } } }, "✎"));
          if (!projectIsSystem) {
            actions.appendChild(h("button", { type: "button", class: "icon-btn danger", title: t("btn.delete"),
              on: { click: function () { removePage(p); } } }, "🗑"));
          }
          var langs = p.title ? Object.keys(p.title).filter(function (k) { return p.title[k]; }).map(function (k) { return k.toUpperCase(); }).join(" / ") : "";
          var sub = p.slug + " · " + p.page_type + " · " + t("ucms.pages.colUpdated") + ": " + (p.updated_at ? A.fmtDateTime(p.updated_at) : "—")
            + " · " + t("ucms.pages.colPublished") + ": " + (pub[p.id] ? A.fmtDateTime(pub[p.id]) : t("ucms.pages.never"));
          list.appendChild(A.row({ id: p.id, title: A.tx(p.title) || p.slug, sub: sub, badges: statusBadges(p), actions: actions }));
        });
        A.sortable(list, saveOrder, "ucms-pages-" + projectId);
      }).catch(A.fail);
    }
    function saveOrder() {
      var jobs = A.$$(":scope > .row", list).map(function (row, i) {
        return db.from("builder_project_pages").update({ sort_order: i }).eq("id", row.getAttribute("data-id"));
      });
      Promise.all(jobs).then(function (res) {
        var bad = res.filter(function (x) { return x.error; })[0];
        if (bad) A.fail(bad.error);
        else { A.toast(t("msg.orderSaved"), "ok"); U.audit("pages.reorder", "builder_pages", projectId, projectId, {}); }
      });
    }
    function openSandboxPreview(p) {
      return db.from("builder_editor_documents").select("*").eq("project_id", projectId).eq("page_id", p.id).maybeSingle()
        .then(function (r) {
          var doc = r.data;
          var body = h("iframe", { class: "sandbox-frame", title: t("ucms.pages.preview"),
            sandbox: "",
            srcdoc: doc ? "<!doctype html><html><head><meta charset='utf-8'><style>" + (doc.css || "") + "</style></head><body>" + (doc.html || "") + "</body></html>"
                        : "<p style='font-family:sans-serif;padding:20px'>" + t("msg.empty") + "</p>" });
          A.modal({ title: t("ucms.pages.preview") + " · " + (A.tx(p.title) || p.slug), size: "lg", body: body,
            actions: [{ label: t("btn.close"), cls: "btn-ghost", onClick: function (m) { m.close(); } }] });
        }).catch(A.fail);
    }
    function publishPage(p) {
      A.confirm(t("ucms.pages.confirmPublish"), t("ucms.confirm.publish"), false).then(function (ok) {
        if (!ok) return;
        db.from("builder_editor_documents").select("*").eq("project_id", projectId).eq("page_id", p.id).maybeSingle()
          .then(function (r) {
            if (r.error) throw r.error;
            if (!r.data) { A.toast(t("msg.empty"), "error"); return; }
            return db.rpc("publish_builder_document", { p_document_id: r.data.id, p_label: "Published from Pages" })
              .then(function (rel) {
                if (rel.error) throw rel.error;
                U.audit("publish.publish", "builder_pages", p.id, A.tx(p.title) || p.slug, { release: rel.data });
                A.notify("success", t("ucms.editor.dbPublished"), (A.tx(p.title) || p.slug) + " · " + t("ucms.editor.deployNote"), "pages");
                A.toast(t("ucms.editor.dbPublished"), "ok");
                load();
              });
          }).catch(A.fail);
      });
    }
    function unpublishPage(p) {
      A.confirm(t("publish.confirmUnpublish"), t("ucms.pages.unpublish")).then(function (ok) {
        if (!ok) return;
        Promise.all([
          db.from("builder_editor_documents").update({ status: "draft" }).eq("project_id", projectId).eq("page_id", p.id),
          db.from("builder_project_pages").update({ is_published: false }).eq("id", p.id)
        ]).then(function (res) {
          var bad = res.filter(function (x) { return x.error; })[0];
          if (bad) return A.fail(bad.error);
          U.audit("publish.unpublish", "builder_pages", p.id, A.tx(p.title) || p.slug, {});
          A.toast(t("publish.unpublished"), "ok"); load();
        });
      });
    }
    function showRevisions(p) {
      var box = h("div", { class: "rows" });
      box.appendChild(h("div", { class: "empty" }, h("span", { class: "spinner sm" })));
      A.modal({ title: t("ucms.pages.revisions") + " · " + (A.tx(p.title) || p.slug), body: box, size: "md" });
      db.from("builder_project_revisions").select("*").eq("project_id", projectId).eq("page_id", p.id)
        .order("created_at", { ascending: false }).limit(30).then(function (r) {
          box.innerHTML = "";
          if (r.error) { box.appendChild(h("div", { class: "empty" }, r.error.message)); return; }
          (r.data || []).forEach(function (rev) {
            box.appendChild(A.row({ id: rev.id, title: rev.label || t("publish.revisions"),
              sub: A.fmtDateTime(rev.created_at) + " · " + ((rev.html || "").length + (rev.css || "").length) + " chars",
              actions: h("button", { type: "button", class: "btn btn-sm", on: { click: function () {
                A.confirm(t("publish.confirmRestore"), t("ucms.confirm.restore")).then(function (ok) {
                  if (!ok) return;
                  db.rpc("restore_builder_revision", { p_revision_id: rev.id }).then(function (x) {
                    if (x.error) return A.fail(x.error);
                    U.audit("publish.revision.restore", "builder_revision", rev.id, rev.label || "", { page: p.id });
                    A.toast(t("publish.restored"), "ok");
                    document.querySelector(".modal-backdrop") && document.querySelectorAll(".modal-backdrop").forEach(function (m) { m.remove(); });
                    load();
                  });
                });
              } } }, t("ucms.confirm.restore")) }));
          });
          if (!(r.data || []).length) box.appendChild(h("div", { class: "empty" }, t("ucms.editor.revisionEmpty")));
        }).catch(A.fail);
    }
    function editPage(p) {
      var isNew = !p; p = p || {};
      var title = A.fI18n(t("f.title"), p.title || {}, { required: true });
      var slug = A.fText(t("manage.pageSlug"), p.slug || "", { required: true, pattern: /^[a-z0-9/_-]{1,120}$/ });
      if (projectIsSystem && p.id) slug.input.disabled = true;
      var pageType = A.fSelect(t("manage.pageType"), p.page_type || "legacy", [["legacy", t("editor.legacy")], ["visual", "Visual"], ["custom", "Custom"]]);
      var home = A.fToggle(t("manage.homePage"), !!p.is_home);
      var pub = A.fToggle(t("f.published"), p.is_published === true);
      A.modal({ title: isNew ? t("ucms.pages.newPage") : t("btn.edit"), body: h("div", { class: "grid" }, title, slug, pageType, home, pub), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("btn.save"), cls: "btn-gold", onClick: function (m, btn) {
          if (!A.validateAll([title, slug])) return;
          var rec = { project_id: projectId, title: title.get(), slug: slug.get(), page_type: pageType.get(), is_home: home.get(), is_published: pub.get() };
          A.busy(btn, true);
          var run = function () {
            return (isNew ? db.from("builder_project_pages").insert(Object.assign({ sort_order: 999 }, rec)).select().single()
                          : db.from("builder_project_pages").update(rec).eq("id", p.id).select().single()).then(function (x) {
              A.busy(btn, false);
              if (x.error) return A.fail(x.error);
              U.audit(isNew ? "pages.create" : "pages.update", "builder_pages", x.data.id, A.tx(rec.title) || rec.slug, { slug: rec.slug, page_type: rec.page_type });
              m.close(); A.toast(t("msg.saved"), "ok"); load();
            });
          };
          if (home.get()) db.from("builder_project_pages").update({ is_home: false }).eq("project_id", projectId).then(run);
          else run();
        } }] });
    }
    function removePage(p) {
      A.confirm(t("msg.confirmDelete"), t("btn.delete"), true).then(function (ok) {
        if (!ok) return;
        db.from("builder_project_pages").delete().eq("id", p.id).then(function (x) {
          if (x.error) return A.fail(x.error);
          U.audit("pages.delete", "builder_pages", p.id, A.tx(p.title) || p.slug, {});
          A.toast(t("msg.deleted"), "ok"); load();
        });
      });
    }
    function newFromTemplate() {
      db.from("builder_page_templates").select("*").eq("is_published", true).order("sort_order").then(function (r) {
        if (r.error) return A.fail(r.error);
        var rows = r.data || [];
        if (!rows.length) { A.toast(t("msg.empty"), "error"); return; }
        var tplSel = A.fSelect(t("ucms.nav.templates"), rows[0].id, rows.map(function (x) { return [x.id, A.tx(x.name)]; }));
        var slug = A.fText(t("ucms.templates.slug"), "", { required: true, pattern: /^[a-z0-9/_-]{1,120}$/, help: "about-us" });
        A.modal({ title: t("ucms.editor.newFromTemplate"), body: h("div", { class: "grid" }, tplSel, slug), actions: [
          { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
          { label: t("ucms.templates.use"), cls: "btn-gold", onClick: function (m, btn) {
            if (!A.validateAll([slug])) return;
            A.busy(btn, true);
            var tpl = rows.filter(function (x) { return x.id === tplSel.get(); })[0];
            db.from("builder_project_pages").select("id").eq("project_id", projectId).eq("slug", slug.get()).maybeSingle()
              .then(function (ex) {
                if (ex.error) throw ex.error;
                if (ex.data) { A.busy(btn, false); A.toast(t("ucms.templates.slugExists"), "error"); return; }
                return db.from("builder_project_pages").insert({
                  project_id: projectId, slug: slug.get(), title: tpl.name, page_type: "visual",
                  is_home: false, is_published: false, sort_order: 999
                }).select().single().then(function (p) {
                  if (p.error) throw p.error;
                  return db.from("builder_editor_documents").insert({
                    project_id: projectId, page_id: p.data.id, html: tpl.html || "", css: tpl.css || "",
                    javascript: "", assets: [], status: "draft"
                  }).then(function (d) {
                    if (d.error) throw d.error;
                    U.audit("pages.create_from_template", "builder_pages", p.data.id, A.tx(tpl.name), { template: tpl.slug, slug: slug.get() });
                    A.editorProjectId = projectId; A.editorTargetPageId = p.data.id;
                    m.close(); A.toast(t("ucms.templates.created"), "ok");
                    A.go("visual-editor");
                  });
                });
              }).catch(function (e) { A.busy(btn, false); A.fail(e); });
          } }] });
      });
    }

    var toolbar = h("div", { class: "toolbar", "data-nodirty": "1" },
      h("label", null, t("project.projects"), " ", projectSelect),
      h("button", { type: "button", class: "btn", on: { click: function () { editPage(null); } } }, "+ " + t("ucms.pages.newPage")),
      h("button", { type: "button", class: "btn btn-gold", on: { click: newFromTemplate } }, t("ucms.editor.newFromTemplate")));
    view.appendChild(A.card(t("ucms.pages.title"), [toolbar, list], { help: t("ucms.pages.sub") }));
    view.appendChild(note);
    projectSelect.addEventListener("change", function () { projectId = projectSelect.value; A.editorProjectId = projectId; load(); });
    return loadProjects();
  } });

  /* ==================================================================== */
  /* HEADER & NAVIGATION                                                  */
  /* ==================================================================== */
  var NAV = [["home", "./", "nav.home"], ["applications", "applications/", "nav.applications"], ["committees", "committees/", "nav.committees"], ["about", "about/", "nav.about"], ["team", "team/", "nav.team"], ["faq", "faq/", "nav.faq"]];
  A.register("header", { group: "website", icon: "☰", title: "nav.header", preview: "./", render: function (view) {
    var s = A.section("global", "header").settings || {};
    var items = Array.isArray(s.nav) && s.nav.length ? s.nav : NAV.map(function (n) { return { page: n[0], href: n[1], visible: true }; });
    NAV.forEach(function (n) { if (!items.some(function (i) { return i.page === n[0]; })) items.push({ page: n[0], href: n[1], visible: false }); });
    var navField = A.fList(t("hdr.nav"), items, function (item) {
      var builtin = NAV.filter(function (n) { return n[0] === item.page; })[0];
      var href = A.fText(t("f.link"), item.href || (builtin && builtin[1]) || "", { url: true, required: true });
      var vis = A.fToggle(t("f.visible"), item.visible !== false);
      var label = builtin ? null : A.fI18n(t("f.label"), item.label || {}, { required: true });
      var newTab = builtin ? null : A.fToggle(t("f.newTab"), !!item.new_tab);
      var title = builtin ? h("strong", null, A.textField(builtin[2]).get().en || builtin[0]) : null;
      return { el: h("div", { class: "grid grid-2" }, title ? h("div", { class: "full" }, title, " ", A.badge(builtin[0])) : null, label ? h("div", { class: "full" }, label) : null, href, h("div", null, vis, newTab)),
        get: function () { var o = { page: item.page, href: href.get(), visible: vis.get() }; if (label) { o.label = label.get(); o.new_tab = newTab.get(); } return o; },
        validate: function () { return href.validate() && (!label || label.validate()); } };
    }, function () { return { page: "custom-" + Date.now().toString(36), href: "https://", visible: true, label: {} }; }, { addLabel: t("hdr.custom"), help: t("hdr.navHelp") });
    navField.classList.add("list-field");
    var ed = U.sectionEditor({ page: "global", key: "header", title: t("nav.header"), visible: false, cols: 2,
      fields: [["logo_url", A.fImage(t("hdr.logo"), s.logo_url || "images/logo.webp", { folder: "global" })], ["show_name", A.fToggle(t("hdr.showName"), s.show_name !== false)], ["nav", navField]],
      texts: [["brand.name"], ["nav.home"], ["nav.applications"], ["nav.committees"], ["nav.about"], ["nav.team"], ["nav.faq"]],
      validate: function () { return navField.validate(); } });
    U.editorPage(view, [ed]);
  } });

  /* ==================================================================== */
  /* HOMEPAGE                                                             */
  /* ==================================================================== */
  function heroEditor() {
    var s = A.section("home", "hero").settings || {};
    var start = A.data.settings["event.start"] || "2027-03-20T09:00:00+03:00";
    var startMs = new Date(start).getTime();
    var startVal = isNaN(startMs) ? "" : new Date(startMs + 3 * 3600e3).toISOString().slice(0, 16);
    var date = A.fText(t("hero.countdownDate"), startVal, { type: "datetime-local" });
    var ed = U.sectionEditor({ page: "home", key: "hero", title: t("home.hero"),
      fields: [
        ["emblem_url", A.fImage(t("hero.emblem"), s.emblem_url || "images/emblem-gold.webp", { folder: "home/hero" })],
        ["bg_image_url", A.fImage(t("hero.bg"), s.bg_image_url, { folder: "home/hero" })],
        ["use_video", A.fToggle(t("hero.useVideo"), s.use_video !== false)],
        ["overlay_color", A.fColor(t("hero.overlay"), s.overlay_color, "#081933")],
        ["overlay_opacity", A.fText(t("hero.opacity"), s.overlay_opacity === undefined ? "" : s.overlay_opacity, { type: "number", placeholder: "50" }), function (v) { return v === "" ? "" : Math.max(0, Math.min(100, +v)); }],
        ["show_buttons", A.fToggle(t("hero.buttons"), s.show_buttons !== false)],
        ["cta1_href", A.fText(t("hero.cta1"), s.cta1_href || "applications/", { url: true })],
        ["cta2_href", A.fText(t("hero.cta2"), s.cta2_href || "committees/", { url: true })],
        ["show_countdown", A.fToggle(t("hero.countdown"), s.show_countdown !== false)]
      ],
      extra: A.grid(2, [date]),
      texts: [["hero.l1"], ["hero.l2"], ["hero.l3"], ["hero.year"], ["hero.tagline"], ["hero.apply"], ["nav.committees"], ["cd.label"], ["cd.days"], ["cd.hours"], ["cd.minutes"], ["cd.seconds"], ["alt.emblem"]],
      afterSave: function () {
        var v = date.get();
        if (!v || v === startVal) return;
        var iso = v + ":00+03:00";
        return A.saveSetting("event.start", iso, "Event start (countdown target)").then(function () {
          startVal = v;
          U.audit("settings.event_start", "site_settings", "event.start", "Countdown date", { value: iso });
        });
      } });
    var draft = ed.draft;
    ed.draft = function () { var d = draft(); var v = date.get(); if (v) d.settings = { "event.start": v + ":00+03:00" }; return d; };
    return ed;
  }
  function presidentEditor() {
    var s = A.section("home", "president").settings || {};
    return U.sectionEditor({ page: "home", key: "president", title: t("home.president"),
      fields: [
        ["photo_url", A.fImage(t("pres.photo"), s.photo_url || "images/team/president.webp", { folder: "home/president" })],
        ["signature_url", A.fImage(t("pres.signature"), s.signature_url, { folder: "home/president" })],
        ["photo_position", A.fSelect(t("pres.pos"), s.photo_position || "left", [["left", t("pos.left")], ["right", t("pos.right")]])],
        ["button_href", A.fText(t("pres.btnHref"), s.button_href || "president/", { url: true })],
        ["show_photo", A.fToggle(t("pres.showPhoto"), s.show_photo !== false)],
        ["show_button", A.fToggle(t("pres.showBtn"), s.show_button !== false)]
      ],
      texts: [["pres.title"], ["pres.dear"], ["letter.p1", null, { multiline: true }], ["letter.p2", null, { multiline: true }], ["letter.p3", null, { multiline: true }], ["letter.p4", null, { multiline: true }], ["letter.close", null, { multiline: true }], ["pres.name"], ["pres.role"], ["pres.more"], ["pres.back"], ["alt.pres"]],
      help: t("pres.letter") });
  }
  function venueEditor() {
    var s = A.section("home", "venue").settings || {};
    return U.sectionEditor({ page: "home", key: "venue", title: t("home.venue"),
      fields: [
        ["address", A.fText(t("venue.address"), s.address || "Osmanlı Mah. Çakmak Küme Evleri İç Kapı No: 5, Şahinbey / Gaziantep")],
        ["email", A.fText(t("venue.email"), s.email || "gdf27.official@gmail.com", { type: "email", pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })],
        ["phone", A.fText(t("venue.phone"), s.phone || "+90 5822 064 300", { dir: "ltr" })],
        ["maps_url", A.fText(t("venue.maps"), s.maps_url || "https://maps.google.com/?cid=5253672414103134596", { url: true })],
        ["embed_url", A.fText(t("venue.embed"), s.embed_url || "", { url: true, https: true, placeholder: "https://www.google.com/maps/embed?pb=…", pattern: /^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed/i, patternMsg: t("venue.embed") }), null],
        ["show_map", A.fToggle(t("venue.showMap"), s.show_map !== false)],
        ["photo_url", A.fImage(t("venue.photo"), s.photo_url, { folder: "home/venue" })]
      ],
      texts: [["venue.title"], ["venue.school"], ["lbl.address"], ["lbl.email"], ["lbl.phone"], ["venue.maps"]] });
  }
  var HOME_SECTIONS = function () { return [["hero", t("home.hero")], ["president", t("home.president")], ["venue", t("home.venue")], ["sponsors", t("sp.section")]]; };
  A.register("home", { group: "website", icon: "◈", title: "nav.home", preview: "./", render: function (view) {
    view.appendChild(A.tabs([
      { key: "hero", label: t("home.hero"), render: function (host) { U.editorPage(host, [heroEditor()]); } },
      { key: "president", label: t("home.president"), render: function (host) { U.editorPage(host, [presidentEditor()]); } },
      { key: "venue", label: t("home.venue"), render: function (host) { U.editorPage(host, [venueEditor()]); } },
      { key: "sponsors", label: t("nav.sponsors"), render: function (host) { host.appendChild(h("p", null, h("button", { type: "button", class: "btn", on: { click: function () { A.go("sponsors"); } } }, t("nav.sponsors") + " →"))); } },
      { key: "sections", label: t("home.sections"), render: function (host) { U.managerPage(host, U.sectionsManager("home", HOME_SECTIONS())); } }
    ]));
  } });
  A.register("president", { group: "website", icon: "✉", title: "nav.president", preview: "president/", render: function (view) { U.editorPage(view, [presidentEditor()]); } });

  /* ==================================================================== */
  /* FOOTER                                                               */
  /* ==================================================================== */
  var PLATFORMS = ["instagram", "facebook", "x", "linkedin", "youtube", "tiktok", "whatsapp", "website"];
  A.register("footer", { group: "website", icon: "▁", title: "nav.footer", preview: "./#contact", render: function (view) {
    var s = A.section("global", "footer").settings || {};
    var phones = A.fList(t("ft.phones"), s.phones || ["+90 582 206 43 00", "+90 501 335 54 73"], function (p) {
      var f = A.fText("", p, { dir: "ltr", placeholder: "+90 …" });
      return { el: f, get: function () { return f.get() || null; } };
    }, function () { return ""; });
    var socials = A.fList(t("ft.socials"), s.socials || [{ platform: "instagram", url: "https://www.instagram.com/gdf.2027?mdxt=dXg1OGZkbHh3Mmhx", label: "GDF'27" }], function (x) {
      var pf = A.fSelect(t("ft.platform"), x.platform || "instagram", PLATFORMS.map(function (p) { return [p, p.charAt(0).toUpperCase() + p.slice(1)]; }));
      var url = A.fText(t("f.url"), x.url || "", { url: true, https: true, required: true });
      var label = A.fText(t("f.label"), typeof x.label === "string" ? x.label : A.tx(x.label));
      return { el: h("div", { class: "grid grid-3" }, pf, url, label), get: function () { return { platform: pf.get(), url: url.get(), label: label.get() }; }, validate: function () { return url.validate(); } };
    }, function () { return { platform: "instagram", url: "" }; });
    phones.classList.add("list-field"); socials.classList.add("list-field");
    U.editorPage(view, [U.sectionEditor({ page: "global", key: "footer", title: t("nav.footer"), visible: false,
      fields: [
        ["logo_url", A.fImage(t("ft.logo"), s.logo_url || "images/logo.webp", { folder: "global" })],
        ["show_name", A.fToggle(t("ft.showName"), s.show_name !== false)],
        ["address", A.fText(t("venue.address"), s.address || "Osmanlı Mah. Çakmak Küme Evleri İç Kapı No: 5, Şahinbey / Gaziantep")],
        ["email", A.fText(t("venue.email"), s.email || "gdf27.official@gmail.com", { type: "email", pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })],
        ["phones", phones], ["socials", socials],
        ["show_contact", A.fToggle(t("ft.showContact"), s.show_contact !== false)],
        ["show_quick", A.fToggle(t("ft.showQuick"), s.show_quick !== false)],
        ["show_social", A.fToggle(t("ft.showSocial"), s.show_social !== false)],
        ["show_credit", A.fToggle(t("ft.showCredit"), s.show_credit !== false)]
      ],
      texts: [["footer.desc", null, { multiline: true }], ["footer.contact"], ["lbl.school"], ["footer.quick"], ["nav.verify"], ["footer.follow"], ["footer.copy"], ["footer.made"], ["footer.design"]],
      validate: function () { return socials.validate(); } })]);
  } });

  /* ==================================================================== */
  /* SEO MANAGEMENT                                                       */
  /* ==================================================================== */
  var SEO_PAGES = [
    ["home", "./"], ["about", "about/"], ["applications", "applications/"], ["committees", "committees/"],
    ["president", "president/"], ["team", "team/"], ["faq", "faq/"], ["verify", "verify/"], ["certificate", "certificate/"], ["404", "404.html"]
  ];
  A.register("seo", { group: "website", icon: "◔", title: "ucms.nav.seo", render: function (view) {
    var ROBOTS = /^(index|noindex|follow|nofollow|none|noarchive|max-snippet:\d+|max-image-preview:\w+)(\s*,\s*(index|noindex|follow|nofollow|none|noarchive|max-snippet:\d+|max-image-preview:\w+))*$/i;
    var loaded = {};
    view.appendChild(h("p", { class: "muted" }, t("ucms.seo.sub")));
    if (!A.can.settings) view.appendChild(h("div", { class: "banner", style: { margin: "0 0 16px" } }, t("ucms.settings.adminOnly")));
    var tabs = SEO_PAGES.map(function (p) {
      return { key: p[0], label: p[0] + " (" + p[1] + ")", render: function (host) { renderPage(host, p[0]); } };
    });
    view.appendChild(A.tabs(tabs));

    function renderPage(host, pageKey) {
      var key = "seo." + pageKey;
      var v = loaded[key] || {};
      var title = A.fText(t("ucms.seo.seoTitle"), v.title || "", { placeholder: "GDF'27 — Gaziantep Diplomacy Forum 2027" });
      var desc = A.fText(t("ucms.seo.seoDesc"), v.description || "", { multiline: true, rows: 3 });
      var canonical = A.fText(t("ucms.seo.canonical"), v.canonical || "", { url: true, placeholder: "https://…" });
      var ogTitle = A.fText(t("ucms.seo.ogTitle"), v.og_title || "");
      var ogDesc = A.fText(t("ucms.seo.ogDesc"), v.og_description || "", { multiline: true, rows: 2 });
      var ogImage = A.fText(t("ucms.seo.ogImage"), v.og_image || "", { url: true, placeholder: "images/og-image.webp" });
      var robots = A.fText(t("ucms.seo.robots"), v.robots || "", { placeholder: t("ucms.seo.robotsHelp"), help: t("ucms.seo.robotsHelp") });
      var warn = h("p", { class: "muted small", role: "status" });
      var preview = h("div", { class: "seo-preview", "aria-hidden": "true" },
        h("div", { class: "sp-url" }, (v.canonical || new URL(pageKey === "home" ? "./" : SEO_PAGES.filter(function (x) { return x[0] === pageKey; })[0][1], document.baseURI).href)),
        h("div", { class: "sp-title" }, v.title || pageKey),
        h("div", { class: "sp-desc" }, v.description || ""));
      function refresh() {
        preview.querySelector(".sp-title").textContent = title.get() || pageKey;
        preview.querySelector(".sp-desc").textContent = desc.get() || "";
        var msgs = [];
        if (title.get().length > 60) msgs.push(t("ucms.seo.titleLong"));
        if (desc.get().length > 160) msgs.push(t("ucms.seo.descLong"));
        warn.textContent = msgs.join(" ");
      }
      [title, desc, canonical, ogTitle, ogDesc, ogImage, robots].forEach(function (f) { f.input.addEventListener("input", function () { refresh(); preview.querySelector(".sp-url").textContent = canonical.get() || preview.querySelector(".sp-url").textContent; }); });
      var bar = A.saveBar(function () {
        if (!A.validateAll([title, desc, canonical, ogTitle, ogDesc, ogImage, robots])) return false;
        if (robots.get() && !ROBOTS.test(robots.get())) { A.toast(t("ucms.seo.robotsInvalid"), "error"); return false; }
        var value = {};
        if (title.get()) value.title = title.get();
        if (desc.get()) value.description = desc.get();
        if (canonical.get()) value.canonical = canonical.get();
        if (ogTitle.get()) value.og_title = ogTitle.get();
        if (ogDesc.get()) value.og_description = ogDesc.get();
        if (ogImage.get()) value.og_image = ogImage.get();
        if (robots.get()) value.robots = robots.get();
        return A.saveSetting(key, value, "SEO for " + pageKey).then(function () {
          loaded[key] = value;
          U.audit("seo.save", "site_settings", key, pageKey, {});
          A.toast(t("ucms.seo.saved"), "ok");
        });
      });
      host.appendChild(A.card(t("ucms.seo.title") + " · " + pageKey, [A.grid(2, [title, desc, canonical, ogTitle, ogDesc, ogImage, robots]), warn, preview, bar]));
      refresh();
    }
    db.from("site_settings").select("key,value").like("key", "seo.%").then(function (r) {
      if (!r.error) (r.data || []).forEach(function (x) { loaded[x.key] = x.value || {}; });
    });
  } });

  /* ==================================================================== */
  /* GLOBAL WEBSITE SETTINGS (site_settings key/value editor)             */
  /* ==================================================================== */
  A.register("settings", { group: "website", icon: "⚙", title: "ucms.nav.settings", render: function (view) {
    var list = h("div", { class: "rows" });
    view.appendChild(A.card(t("ucms.settings.title"), [list], { help: t("ucms.settings.sub") }));
    if (!A.can.settings) view.appendChild(h("div", { class: "banner" }, t("ucms.settings.adminOnly")));
    function load() {
      return db.from("site_settings").select("*").order("key").then(function (r) {
        if (r.error) throw r.error;
        list.innerHTML = "";
        (r.data || []).forEach(function (s) {
          list.appendChild(A.row({ id: s.key, draggable: false,
            title: s.key, sub: (s.label || "") + " · " + (s.updated_at ? A.fmtDateTime(s.updated_at) : ""),
            actions: h("button", { type: "button", class: "btn btn-sm", on: { click: function () { edit(s); } } }, t("btn.edit")) }));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("msg.empty")));
      }).catch(A.fail);
    }
    function edit(s) {
      var value = h("textarea", { rows: 8, class: "code-input", "aria-label": t("ucms.settings.value") });
      value.value = JSON.stringify(s.value, null, 2);
      var label = A.fText(t("ucms.settings.label"), s.label || "");
      A.modal({ title: s.key, body: h("div", { class: "grid" }, h("label", { class: "field" }, h("span", null, t("ucms.settings.value")), value), label), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("btn.save"), cls: "btn-gold", onClick: function (m, btn) {
          var parsed;
          try { parsed = JSON.parse(value.value); } catch (e) { A.toast(t("ucms.settings.invalidJson"), "error"); return; }
          A.busy(btn, true);
          A.saveSetting(s.key, parsed, label.get() || s.label).then(function () {
            U.audit("settings.update", "site_settings", s.key, s.key, {});
            A.busy(btn, false); m.close(); A.toast(t("msg.saved"), "ok"); load();
          }).catch(function (e) { A.busy(btn, false); A.fail(e); });
        } }] });
    }
    return load();
  } });
})();
