/* =====================================================================
   GDF'27 UCMS — shared page-building helpers for the admin modules.
   Extracted from the former admin-pages.js monolith; every CMS module
   imports (via globals) the same editors that were proven in testing.
   New: audit logging on content writes, unified save-state feedback.
   ===================================================================== */
(function () {
  "use strict";
  var A = window.CMSA, h = A.h, t = A.t, db = A.db;
  A.U = {};
  var U = A.U;
  U.clone = function (o) { return JSON.parse(JSON.stringify(o || {})); };
  U.same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  U.pad2 = function (n) { return String(n).padStart(2, "0"); };
  U.toLocalInput = function (iso) { if (!iso) return ""; var d = new Date(iso); if (isNaN(d)) return ""; return d.getFullYear() + "-" + U.pad2(d.getMonth() + 1) + "-" + U.pad2(d.getDate()) + "T" + U.pad2(d.getHours()) + ":" + U.pad2(d.getMinutes()); };
  U.fromLocalInput = function (v) { return v ? new Date(v).toISOString() : null; };
  U.textsDefaultList = function (keys) { return keys.map(function (k) { var d = A.textDefaults(k); return { en: d.en, ar: d.ar, tr: d.tr }; }); };
  U.i18nItem = function (label, o) {
    return function (item) {
      var f = A.fI18n(label, item || {}, o || {});
      return { el: f, get: function () { var v = f.get(); return v.en ? v : null; } };
    };
  };
  /* One audit entry per logical write (best effort, never blocks the save). */
  U.audit = function (action, resourceType, resourceId, resourceLabel, metadata) {
    return A.log(action, resourceType, resourceId, resourceLabel, metadata || {});
  };

  /* ------------------------------------------------------------------
     Section editor: texts (site_texts) + settings (page_sections) for one
     section of a page. fields: [[settingsPath, fieldElement, transform?]]
     ------------------------------------------------------------------ */
  U.sectionEditor = function (o) {
    var row = A.section(o.page, o.key), base = U.clone(row.settings);
    var texts = (o.texts || []).map(function (x) { return A.textField(x[0], x[1], x[2]); });
    var vis = o.visible === false ? null : A.fToggle(t("f.visible"), row.is_visible !== false);
    var fields = (o.fields || []).slice();
    var st = base.style || {};
    var styleFields = [];
    if (o.style !== false) {
      styleFields = [["style.bg", A.fColor(t("f.bg"), st.bg)], ["style.text", A.fColor(t("f.text"), st.text)],
        ["style.pad_y", A.fText(t("f.pad"), st.pad_y ? parseInt(st.pad_y, 10) : "", { type: "number", placeholder: "auto" }), function (v) { return v ? Math.max(0, Math.min(400, parseInt(v, 10))) + "px" : ""; }]];
    }
    if (o.image) {
      styleFields.push(["image_url", A.fImage(t("f.sectionImage"), base.image_url, { folder: o.page })]);
      styleFields.push(["image_position", A.fSelect(t("f.imagePos"), base.image_position || "bottom", [["bottom", t("pos.bottom")], ["top", t("pos.top")]])]);
    }
    function collect() {
      var s = U.clone(base);
      fields.concat(styleFields).forEach(function (f) {
        var v = f[1].get();
        if (f[2]) v = f[2](v);
        A.setPath(s, f[0], v);
      });
      if (s.style && !Object.keys(s.style).length) delete s.style;
      if (o.collect) o.collect(s);
      return s;
    }
    fields.concat(styleFields).forEach(function (f) { f[1].setAttribute("data-path", f[0]); });
    var fieldEls = fields.map(function (f) { return f[1]; });
    var body = [];
    if (vis) body.push(vis);
    if (fieldEls.length) body.push(A.grid(o.cols || 2, fieldEls.map(function (el) { if (el.classList.contains("list-field") || el.querySelector(".list-editor,.uploader") || el.classList.contains("i18n")) el.classList.add("full"); return el; })));
    if (o.extra) body.push(o.extra);
    if (texts.length) body.push(h("h3", null, t("f.texts")), h("div", { class: "grid" }, texts));
    if (styleFields.length) body.push(h("details", { class: "style-box" }, h("summary", { class: "muted", style: { cursor: "pointer", margin: "12px 0" } }, t("f.style")), A.grid(3, styleFields.map(function (f) { return f[1]; }))));
    var el = A.card(o.title, body, { help: o.help });
    return {
      el: el, texts: texts,
      validate: function () { return A.validateAll(texts.concat(fieldEls).concat(o.validate ? [{ validate: o.validate }] : [])); },
      save: function () {
        var s = collect();
        var patch = { settings: s };
        if (vis) patch.is_visible = vis.get();
        return A.saveTexts(texts).then(function () { return A.saveSection(o.page, o.key, patch); }).then(function (r) {
          base = U.clone(r.settings);
          U.audit("content.section.save", "page_section", o.page + ":" + o.key, o.title, { visible: vis ? vis.get() : null });
          if (o.afterSave) return o.afterSave();
        });
      },
      draft: function () {
        return { texts: A.textDraft(texts), section: Object.assign({}, row, { page: o.page, section_key: o.key, is_visible: vis ? vis.get() : true, settings: collect() }) };
      }
    };
  };
  /* Puts editors on a page with one Save button and live preview.
     The input/change listeners attach to a wrapper INSIDE the view, so they
     are discarded with the page instead of accumulating on the persistent
     #view node across navigations. */
  U.editorPage = function (host, editors, extraSave) {
    var wrap = h("div");
    editors.forEach(function (e) { wrap.appendChild(e.el); });
    wrap.appendChild(A.saveBar(function () {
      if (!editors.every(function (e) { return e.validate(); })) return false;
      return editors.reduce(function (p, e) { return p.then(e.save); }, Promise.resolve()).then(function () { if (extraSave) return extraSave(); });
    }, t("f.fallback")));
    host.appendChild(wrap);
    function draft() {
      var msg = { texts: {}, sectionList: [] };
      editors.forEach(function (e) { var d = e.draft(); Object.assign(msg.texts, d.texts); if (d.section) msg.sectionList.push(d.section); if (d.settings) msg.settings = Object.assign(msg.settings || {}, d.settings); });
      return msg;
    }
    wrap.addEventListener("input", function () { A.queuePreview(draft); });
    wrap.addEventListener("change", function () { A.queuePreview(draft); });
  };
  /* Order + visibility + colours of the sections of one page. */
  U.sectionsManager = function (page, defs, help) {
    var list = h("div", { class: "rows" });
    var sorted = defs.map(function (d, i) { var r = A.section(page, d[0]); return { key: d[0], label: d[1], row: r, i: A.data.sections[page + ":" + d[0]] ? r.sort_order : i }; })
      .sort(function (a, b) { return a.i - b.i; });
    sorted.forEach(function (d) {
      var vis = A.fToggle(t("f.visible"), d.row.is_visible !== false);
      var r = A.row({ id: d.key, title: d.label, sub: page + " · " + d.key, onMove: function () { A.setDirty(true); }, actions: vis });
      r._vis = vis;
      list.appendChild(r);
    });
    A.sortable(list, function () { A.setDirty(true); }, "sections-" + page);
    return {
      el: A.card(t("home.sections"), list, { help: help || t("home.sectionsHelp") }),
      texts: [],
      validate: function () { return true; },
      save: function () {
        return A.$$(":scope > .row", list).reduce(function (p, r, i) {
          return p.then(function () { return A.saveSection(page, r.getAttribute("data-id"), { sort_order: i, is_visible: r._vis.get() }); });
        }, Promise.resolve()).then(function () {
          U.audit("content.section.order", "page_section", page, page, {});
        });
      },
      draft: function () {
        return { texts: {}, sectionList: null, section: null, all: A.$$(":scope > .row", list).map(function (r, i) { return Object.assign({}, A.section(page, r.getAttribute("data-id")), { page: page, section_key: r.getAttribute("data-id"), sort_order: i, is_visible: r._vis.get() }); }) };
      },
      list: list
    };
  };
  U.managerPage = function (host, mgr) {
    var wrap = h("div");
    wrap.appendChild(mgr.el);
    wrap.appendChild(A.saveBar(mgr.save));
    host.appendChild(wrap);
    var send = function () { A.queuePreview(function () { return { sectionList: mgr.draft().all }; }); };
    wrap.addEventListener("input", send); wrap.addEventListener("change", send);
    mgr.list.addEventListener("drop", send); mgr.list.addEventListener("click", send);
  };

  /* Generic table list (committees, FAQ, sponsors, applications).
     opts.auditType: resource type used for audit log entries. */
  U.tableList = function (host, o) {
    var list = h("div", { class: "rows" }), search = h("input", { type: "search", class: "search", placeholder: "🔍" });
    var rows = [];
    function render() {
      list.innerHTML = "";
      var q = search.value.trim().toLowerCase();
      var shown = rows.filter(function (r) { return !q || JSON.stringify(r).toLowerCase().indexOf(q) >= 0; });
      if (!shown.length) list.appendChild(h("div", { class: "empty" }, q ? t("msg.noSearch") : t("msg.empty")));
      shown.forEach(function (r) {
        var info = o.rowInfo(r);
        list.appendChild(A.row({ id: r.id, title: info.title, sub: info.sub, thumb: info.thumb === undefined ? undefined : info.thumb, contain: o.contain,
          badges: r.is_published === false ? A.badge(t("f.published") + " ✕", "off") : null,
          draggable: !q, onMove: q ? null : function () { A.saveOrder(o.table, list); },
          onEdit: function () { edit(r); },
          onDelete: function () { A.confirm(t("msg.confirmDelete"), t("btn.delete")).then(function (ok) { if (!ok) return; db.from(o.table).delete().eq("id", r.id).then(function (x) {
            if (x.error) { U.audit("content.row.delete", o.auditType || o.table, r.id, info.title, {}, "error"); return A.fail(x.error); }
            U.audit("content.row.delete", o.auditType || o.table, r.id, info.title, { table: o.table });
            A.toast(t("msg.deleted"), "ok"); load();
          }); }); } }));
      });
    }
    function load() {
      return db.from(o.table).select("*").order("sort_order").then(function (r) { if (r.error) throw r.error; rows = r.data || []; render(); if (o.onLoad) o.onLoad(rows); });
    }
    function edit(r) {
      var isNew = !r; r = r || {};
      var fields = o.fields(r);
      fields.forEach(function (f) { if (f[0]) f[1].setAttribute("data-field", f[0]); });
      var pub = A.fToggle(t("f.published"), r.is_published !== false);
      var body = h("div", { class: "grid" }, fields.map(function (f) { return f[1]; }), pub);
      A.modal({ title: isNew ? o.newLabel : (o.rowInfo(r).title || t("btn.edit")), body: body, actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("btn.save"), cls: "btn-gold", onClick: function (m, btn) {
          if (!A.validateAll(fields.map(function (f) { return f[1]; }))) return;
          var rec = { is_published: pub.get() };
          fields.forEach(function (f) { if (!f[0]) return; var v = f[2] ? f[2](f[1]) : (f[1].getOrNull ? f[1].getOrNull() : f[1].get()); rec[f[0]] = v === "" ? null : v; });
          if (isNew) rec.sort_order = rows.length;
          A.busy(btn, true);
          (isNew ? db.from(o.table).insert(rec) : db.from(o.table).update(rec).eq("id", r.id)).then(function (x) {
            A.busy(btn, false);
            if (x.error) return A.fail(x.error);
            U.audit(isNew ? "content.row.create" : "content.row.update", o.auditType || o.table, x.data && x.data.id ? x.data.id : r.id, o.rowInfo(rec).title || "", { table: o.table });
            m.close(); A.toast(t("msg.saved"), "ok"); load(); A.preview.reload();
          });
        } }] });
    }
    A.sortable(list, function () { A.saveOrder(o.table, list); }, o.table);
    search.addEventListener("input", render);
    host.appendChild(A.card(o.title, [h("div", { class: "toolbar", "data-nodirty": "1" }, search, h("button", { type: "button", class: "btn btn-gold", on: { click: function () { edit(null); } } }, "+ " + o.newLabel)), list], { help: o.help }));
    return load();
  };
})();
