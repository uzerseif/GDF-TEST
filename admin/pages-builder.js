/* =====================================================================
   GDF'27 UCMS — Design Studio (group "design"):
   Visual Editor (GrapesJS), Global Styles (design tokens), Reusable
   Components, Page Templates, Hero & Responsive, Project Settings,
   Code & Archives, Static Checks.
   Editor security: untrusted document HTML is previewed only inside a
   fully sandboxed iframe (srcdoc + sandbox="") — no scripts, no
   same-origin access to dashboard state or credentials.
   ===================================================================== */
(function () {
  "use strict";
  var A = window.CMSA, h = A.h, t = A.t, db = A.db, U = A.U;

  /* Sandboxed preview dialog: document HTML runs with no scripts and an
     opaque origin; it cannot touch cookies, localStorage or the DOM of
     the dashboard. */
  function sandboxPreview(title, html, css) {
    var frame = h("iframe", { class: "sandbox-frame", title: title, sandbox: "",
      referrerpolicy: "no-referrer",
      srcdoc: "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>" + (css || "") + "</style></head><body>" + (html || "") + "</body></html>" });
    A.modal({ title: title, size: "lg", body: frame,
      actions: [{ label: t("btn.close"), cls: "btn-ghost", onClick: function (m) { m.close(); } }] });
  }

  /* ==================================================================== */
  /* VISUAL EDITOR                                                        */
  /* ==================================================================== */
  A.register("visual-editor", { group: "design", icon: "▦", title: "editor.title", preview: null, render: function (view) {
    if (!window.grapesjs) {
      view.appendChild(h("div", { class: "empty" }, t("editor.unsupported")));
      return Promise.resolve();
    }

    var projectId = A.editorProjectId || null;
    var projectSelect = h("select");
    var pageSelect = h("select");
    var canvasHost = h("div", { id: "gjs", class: "gjs-host" });
    var blocksHost = h("div", { id: "gjs-blocks", class: "gjs-panel-scroll" });
    var layersHost = h("div", { id: "gjs-layers", class: "gjs-panel-scroll" });
    var stylesHost = h("div", { id: "gjs-styles", class: "gjs-panel-scroll" });
    var traitsHost = h("div", { id: "gjs-traits", class: "gjs-panel-scroll" });
    var status = h("span", { class: "muted small", role: "status" });
    var deployNote = h("p", { class: "muted small", style: { margin: "6px 0 0" } }, t("ucms.editor.deployNote"));
    var editor = null;
    var currentPage = null;
    var saveTimer = null;
    var autosaveTimer = null;
    var lastSavedSig = "";
    var autosaveAt = null;
    var saveSeq = 0;          /* monotonic save token: only the newest save wins */
    var saveInFlight = false; /* overlapping saves are chained, never parallel */

    /* One GrapesJS instance at a time: destroy the previous editor before a
       new canvas is built and when the page is left (A.go runs cleanups). */
    function destroyEditor() {
      clearTimeout(autosaveTimer);
      clearTimeout(saveTimer);
      if (editor) {
        try { editor.destroy(); } catch (e) { /* already gone */ }
        editor = null;
      }
    }
    A.addCleanup(destroyEditor);

    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name,status").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) {
          projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug));
        });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        return loadPages();
      });
    }

    function loadPages() {
      projectId = projectSelect.value;
      A.editorProjectId = projectId;
      return db.from("builder_project_pages").select("*").eq("project_id", projectId).order("sort_order").then(function (r) {
        if (r.error) throw r.error;
        pageSelect.innerHTML = "";
        (r.data || []).forEach(function (p) {
          pageSelect.appendChild(h("option", { value: p.id }, A.tx(p.title) || p.slug));
        });
        if (!pageSelect.options.length) {
          status.textContent = t("msg.empty");
          return;
        }
        if (A.editorTargetPageId && pageSelect.querySelector("option[value='" + A.editorTargetPageId + "']")) {
          pageSelect.value = A.editorTargetPageId;
        }
        A.editorTargetPageId = null;
        return loadPage(pageSelect.value);
      });
    }

    function pageSource(page) {
      if (!page) return "";
      if (page.slug === "./") return "index.html";
      if (/^.+\/$/.test(page.slug)) return page.slug + "index.html";
      return page.slug;
    }

    function loadLegacySource(page) {
      var src = pageSource(page);
      if (!src) return Promise.resolve({ html: "", css: "", js: "" });
      var resolved = new URL(src, document.baseURI).href;
      return fetch(resolved, { credentials: "same-origin" }).then(function (res) {
        if (!res.ok) throw new Error("Could not load " + src);
        return res.text();
      }).then(function (text) {
        var doc = new DOMParser().parseFromString(text, "text/html");
        var body = doc.body;
        var css = [];
        var scripts = [];
        [].slice.call(doc.querySelectorAll("link[rel=stylesheet]")).forEach(function (link) {
          css.push('@import url("' + new URL(link.getAttribute("href"), resolved).href + '");');
        });
        [].slice.call(doc.querySelectorAll("script")).forEach(function (s) {
          if (!s.src) scripts.push(s.textContent);
        });
        if (body) body.querySelectorAll("script").forEach(function (s) { s.remove(); });
        if (body) {
          [].slice.call(body.querySelectorAll("[src],[href]")).forEach(function (el) {
            ["src", "href"].forEach(function (attr) {
              var value = el.getAttribute(attr);
              if (!value || /^(?:https?:|mailto:|tel:|javascript:|data:|blob:|#)/i.test(value)) return;
              el.setAttribute(attr, new URL(value, resolved).href);
            });
          });
        }
        return { html: body ? body.innerHTML : text, css: css.join("\n"), js: scripts.join("\n") };
      }).catch(function () { return { html: "", css: "", js: "" }; });
    }

    function registerBlocks() {
      var bm = editor.BlockManager;
      var G = t("editor.blocks");
      bm.add("text", { label: "Text", category: G, content: "<div style=\"padding:16px\"><h2>Heading</h2><p>Text paragraph</p></div>" });
      bm.add("image", { label: "Image", category: G, content: "<img src=\"" + new URL("images/og-image.webp", document.baseURI).href + "\" style=\"max-width:100%\" alt=\"\">", activate: true });
      bm.add("button", { label: "Button", category: G, content: "<a href=\"#\" class=\"cta\" style=\"display:inline-block;padding:12px 18px\">Button</a>" });
      bm.add("section", { label: "Section", category: G, content: "<section style=\"min-height:220px;padding:48px 24px\"><h2>Section</h2><p>Add content here.</p></section>" });
      bm.add("columns", { label: "Two columns", category: G, content: "<div style=\"display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:24px\"><div><h3>Column 1</h3></div><div><h3>Column 2</h3></div></div>" });
      bm.add("form", { label: "Form", category: G, content: "<form style=\"display:grid;gap:12px;padding:24px\"><input name=\"name\" placeholder=\"Name\"><input name=\"email\" type=\"email\" placeholder=\"Email\"><button type=\"submit\">Submit</button></form>" });
      /* GDF-branded blocks */
      bm.add("gdf-hero", { label: "GDF Hero", category: "GDF", content:
        "<section style=\"background:linear-gradient(160deg,#081a37,#06122a);color:#f5efe0;padding:80px 24px;text-align:center\">" +
        "<p style=\"color:#d9c48f;letter-spacing:.35em;text-transform:uppercase;font-size:13px;margin:0 0 10px\">GDF'27</p>" +
        "<h1 style=\"font-family:Georgia,serif;font-size:52px;margin:0 0 12px\">Headline</h1>" +
        "<p style=\"font-size:18px;opacity:.9\">Supporting sentence for the hero.</p>" +
        "<div style=\"margin-top:26px\"><a href=\"#\" style=\"background:#c9a44c;color:#081a37;padding:13px 26px;border-radius:999px;font-weight:600;text-decoration:none\">Primary</a> " +
        "<a href=\"#\" style=\"border:1px solid #d9c48f;color:#f5efe0;padding:13px 26px;border-radius:999px;text-decoration:none\">Secondary</a></div></section>" });
      bm.add("gdf-stats", { label: "GDF Statistics", category: "GDF", content:
        "<section style=\"padding:48px 24px\"><div style=\"max-width:960px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:18px;text-align:center\">" +
        "<div><b style=\"display:block;font-size:34px;color:#081a37;font-family:Georgia,serif\">300+</b><span style=\"color:#8a6d1f;font-size:13px;text-transform:uppercase\">Delegates</span></div>" +
        "<div><b style=\"display:block;font-size:34px;color:#081a37;font-family:Georgia,serif\">6</b><span style=\"color:#8a6d1f;font-size:13px;text-transform:uppercase\">Committees</span></div>" +
        "<div><b style=\"display:block;font-size:34px;color:#081a37;font-family:Georgia,serif\">3</b><span style=\"color:#8a6d1f;font-size:13px;text-transform:uppercase\">Days</span></div>" +
        "<div><b style=\"display:block;font-size:34px;color:#081a37;font-family:Georgia,serif\">1</b><span style=\"color:#8a6d1f;font-size:13px;text-transform:uppercase\">Forum</span></div>" +
        "</div></section>" });
      bm.add("gdf-cta", { label: "GDF Call to action", category: "GDF", content:
        "<section style=\"background:#f1e8d1;padding:56px 24px;text-align:center\"><h2 style=\"color:#081a37;font-family:Georgia,serif;margin:0 0 14px\">Ready to join?</h2>" +
        "<p style=\"color:#3d3a33\">Short persuasive sentence.</p>" +
        "<a href=\"#\" style=\"display:inline-block;margin-top:14px;background:#c9a44c;color:#081a37;padding:13px 26px;border-radius:999px;font-weight:600;text-decoration:none\">Apply now</a></section>" });
      bm.add("gdf-cards", { label: "GDF Cards", category: "GDF", content:
        "<section style=\"padding:48px 24px\"><div style=\"max-width:960px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px\">" +
        "<div style=\"background:#fff;border:1px solid #e5d9bd;border-radius:14px;padding:22px\"><h3 style=\"color:#081a37;margin:0 0 8px\">Card one</h3><p style=\"color:#3d3a33\">Description.</p></div>" +
        "<div style=\"background:#fff;border:1px solid #e5d9bd;border-radius:14px;padding:22px\"><h3 style=\"color:#081a37;margin:0 0 8px\">Card two</h3><p style=\"color:#3d3a33\">Description.</p></div>" +
        "<div style=\"background:#fff;border:1px solid #e5d9bd;border-radius:14px;padding:22px\"><h3 style=\"color:#081a37;margin:0 0 8px\">Card three</h3><p style=\"color:#3d3a33\">Description.</p></div>" +
        "</div></section>" });
      bm.add("gdf-gallery", { label: "GDF Gallery", category: "GDF", content:
        "<section style=\"padding:48px 24px\"><div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px\">" +
        "<img src=\"" + new URL("images/delegation.webp", document.baseURI).href + "\" style=\"width:100%;border-radius:12px\" alt=\"\">" +
        "<img src=\"" + new URL("images/delegate.webp", document.baseURI).href + "\" style=\"width:100%;border-radius:12px\" alt=\"\">" +
        "</div></section>" });
      db.from("builder_project_components").select("*").eq("project_id", projectId).eq("is_published", true).order("sort_order").then(function (r) {
        if (r.error) return;
        (r.data || []).forEach(function (c) {
          bm.add("component-" + c.id, { label: c.name, category: t("ucms.nav.components"), content: (c.html || "") + (c.css ? "<style>" + c.css + "</style>" : "") });
        });
      });
    }

    function responsiveCss(rows) {
      var css = [];
      (rows || []).forEach(function (row) {
        function rules(values) {
          if (!values || typeof values !== "object" || Array.isArray(values)) return "";
          return Object.keys(values).map(function (key) {
            var prop = String(key).trim().replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); });
            return prop + ":" + String(values[key]).replace(/[;{}]/g, "") + ";";
          }).join("");
        }
        var desktop = rules(row.desktop), tablet = rules(row.tablet), mobile = rules(row.mobile);
        if (desktop) css.push(row.selector + "{" + desktop + "}");
        if (tablet) css.push("@media (max-width:768px){" + row.selector + "{" + tablet + "}}");
        if (mobile) css.push("@media (max-width:390px){" + row.selector + "{" + mobile + "}}");
      });
      return css.join("\n");
    }

    function initEditor(documentRow, legacy, responsive) {
      destroyEditor();
      canvasHost.innerHTML = "";
      blocksHost.innerHTML = "";
      layersHost.innerHTML = "";
      stylesHost.innerHTML = "";
      traitsHost.innerHTML = "";

      editor = window.grapesjs.init({
        container: canvasHost,
        height: "calc(100vh - 210px)",
        width: "auto",
        fromElement: false,
        storageManager: false,
        blockManager: { appendTo: blocksHost },
        layerManager: { appendTo: layersHost },
        styleManager: { appendTo: stylesHost },
        traitManager: { appendTo: traitsHost },
        deviceManager: {
          devices: [
            { name: t("editor.desktop"), width: "" },
            { name: t("editor.tablet"), width: "768px", widthMedia: "768px" },
            { name: t("editor.mobile"), width: "390px", widthMedia: "390px" }
          ]
        }
      });
      registerBlocks();
      var initializing = true;
      editor.setComponents(documentRow ? documentRow.html : legacy.html);
      var baseCss = documentRow ? documentRow.css : legacy.css;
      editor.setStyle(baseCss + "\n" + responsive);
      lastSavedSig = documentRow ? JSON.stringify([documentRow.html, documentRow.css]) : JSON.stringify([legacy.html, legacy.css]);
      /* 'load' fires when the canvas finished rendering; the timeout is only
         a safety net so a missed event can never leave autosave disabled. */
      editor.on("load", function () { initializing = false; });
      setTimeout(function () { initializing = false; }, 1200);
      editor.getModel().on("change", function () { if (!initializing) onCanvasChange(); });
      status.textContent = (documentRow ? documentRow.status : t("editor.documentMissing"))
        + (documentRow && documentRow.status === "published" ? " · " + t("ucms.editor.publishedBadge") : "");
      if (autosaveAt) status.textContent += " · " + t("ucms.save.autosaved") + " " + autosaveAt;
    }

    var loadSeq = 0; /* only the newest page load may initialise the editor */
    function loadPage(pageId) {
      currentPage = null;
      var page = null;
      var seq = ++loadSeq;
      autosaveAt = null;
      db.from("builder_project_pages").select("*").eq("id", pageId).single().then(function (r) {
        if (r.error) throw r.error;
        page = r.data;
        currentPage = page;
        return Promise.all([
          db.from("builder_editor_documents").select("*").eq("project_id", projectId).eq("page_id", pageId).maybeSingle(),
          page.page_type === "legacy" ? loadLegacySource(page) : Promise.resolve({ html: "", css: "", js: "" }),
          db.from("builder_project_responsive").select("*").eq("project_id", projectId)
        ]);
      }).then(function (r) {
        if (seq !== loadSeq || !r) return;   /* a newer page load superseded this one */
        initEditor(r[0].error ? null : r[0].data, r[1], r[2].error ? "" : responsiveCss(r[2].data));
      }).catch(A.fail);
    }

    function exportDocument() {
      var assets = [];
      if (editor.AssetManager && editor.AssetManager.getAll) {
        assets = editor.AssetManager.getAll().map(function (asset) { return asset.get ? asset.get() : asset; });
      }
      return {
        html: editor.getHtml(),
        css: editor.getCss(),
        js: "",
        assets: assets
      };
    }

    /* Autosave: debounced, silent, writes only the draft document (no
       revision row) and never publishes. */
    function onCanvasChange() {
      A.setDirty(true);
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(function () {
        if (!editor || !currentPage) return;
        var body = exportDocument();
        var sig = JSON.stringify([body.html, body.css]);
        if (sig === lastSavedSig) return;
        saveDraft(false, { silent: true }).then(function (ok) {
          if (ok) {
            lastSavedSig = sig;
            autosaveAt = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            status.textContent = t("ucms.save.autosaved") + " " + autosaveAt;
          }
        });
      }, 4000);
    }
    /* kept for compatibility: marks dirty without a save timer */
    function queueDraftSave() { A.setDirty(true); }

    function saveDraft(publish, opts) {
      opts = opts || {};
      if (!editor || !currentPage) return Promise.resolve(false);
      /* Race control: only one request at a time; a save requested while
         another is in flight is chained afterwards, and every completion
         checks its sequence token so an older response can never overwrite
         a newer document state or status label. */
      var seq = ++saveSeq;
      var run = function () {
        var body = exportDocument();
        var rec = {
          project_id: projectId,
          page_id: currentPage.id,
          html: body.html,
          css: body.css,
          javascript: body.js,
          assets: body.assets,
          status: publish ? "published" : (opts.silent ? undefined : "draft")
        };
        if (!publish) delete rec.status; /* keep the existing status on autosave/draft */
        return db.from("builder_editor_documents").upsert(rec, { onConflict: "project_id,page_id" }).select().single().then(function (r) {
          if (seq !== saveSeq) return true; /* superseded by a newer save */
          if (r.error) throw r.error;
          if (publish) {
            return db.rpc("publish_builder_document", { p_document_id: r.data.id, p_label: "Published release" }).then(function (release) {
              if (seq !== saveSeq) return true;
              if (release.error) throw release.error;
              A.setDirty(false);
              lastSavedSig = JSON.stringify([body.html, body.css]);
              U.audit("publish.publish", "builder_documents", r.data.id, A.tx(currentPage.title) || currentPage.slug, { release: release.data, project: projectId });
              A.notify("success", t("ucms.editor.dbPublished"), (A.tx(currentPage.title) || currentPage.slug) + " · " + t("ucms.editor.deployNote"), "pages");
              A.toast(t("ucms.editor.dbPublished"), "ok");
              status.textContent = "published · " + t("ucms.editor.publishedBadge");
              return true;
            });
          }
          A.setDirty(false);
          lastSavedSig = JSON.stringify([body.html, body.css]);
          U.audit(opts.silent ? "editor.autosave" : "editor.save_draft", "builder_documents", r.data.id, A.tx(currentPage.title) || currentPage.slug, { project: projectId });
          if (!opts.silent) {
            A.toast(t("ucms.editor.dbSaved"), "ok");
            status.textContent = "draft · " + t("ucms.save.saved") + " " + new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
          }
          return true;
        });
      };
      var finish = function (p) {
        return p.then(function (ok) { saveInFlight = false; if (seq === saveSeq && pending) { var n = pending; pending = null; return finish(n()); } return ok; },
          function (e) { saveInFlight = false; throw e; });
      };
      var pending = null;
      if (saveInFlight) {
        pending = run;
        return Promise.resolve(true);
      }
      saveInFlight = true;
      return finish(run());
    }

    function saveRevision() {
      if (!editor || !currentPage) return;
      var body = exportDocument();
      var labelInput = A.fText(t("ucms.editor.revisionLabel"), "", { placeholder: "Before redesign" });
      A.modal({ title: t("ucms.editor.revisionSave"), size: "sm", body: h("div", { class: "grid" }, labelInput), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("ucms.editor.revisionSave"), cls: "btn-gold", onClick: function (m, btn) {
          A.busy(btn, true);
          db.from("builder_project_revisions").insert({
            project_id: projectId, page_id: currentPage.id, label: labelInput.get() || t("ucms.editor.revisionSave"),
            html: body.html, css: body.css, javascript: body.js, assets: body.assets, created_by: A.user.id
          }).then(function (x) {
            A.busy(btn, false);
            if (x.error) return A.fail(x.error);
            U.audit("editor.revision", "builder_revisions", x.data.id, labelInput.get() || "", { page: currentPage.id });
            m.close(); A.toast(t("ucms.editor.revisionSaved"), "ok");
          });
        } }] });
    }

    function openPreview() {
      if (!editor) return;
      var body = exportDocument();
      sandboxPreview(t("editor.preview"), body.html, body.css);
    }

    function deleteSelectedElement() {
      if (!editor) return;
      var selected = editor.getSelected();
      if (!selected) { A.toast(t("editor.selectPage"), "error"); return; }
      selected.remove();
      A.setDirty(true);
    }

    function duplicateSelectedElement() {
      if (!editor) return;
      var selected = editor.getSelected();
      if (!selected) { A.toast(t("editor.selectPage"), "error"); return; }
      var parent = selected.parent();
      if (!parent) return;
      var copy = selected.clone();
      parent.append(copy);
      A.setDirty(true);
    }

    function openRevisionHistory() {
      if (!currentPage) return;
      var list = h("div", { class: "rows" });
      db.from("builder_project_revisions").select("*").eq("project_id", projectId).eq("page_id", currentPage.id).order("created_at", { ascending: false }).limit(30).then(function (r) {
        if (r.error) throw r.error;
        list.innerHTML = "";
        (r.data || []).forEach(function (revision) {
          list.appendChild(A.row({
            id: revision.id,
            title: revision.label || t("publish.revisions"),
            sub: A.fmtDateTime(revision.created_at),
            actions: h("div", { class: "r-actions" },
              h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () {
                sandboxPreview(t("ucms.pages.preview") + " · " + (revision.label || ""), revision.html, revision.css);
              } } }, t("ucms.pages.preview")),
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () {
                A.confirm(t("publish.confirmRestore"), t("publish.restore")).then(function (ok) {
                  if (!ok) return;
                  db.rpc("restore_builder_revision", { p_revision_id: revision.id }).then(function (x) {
                    if (x.error) return A.fail(x.error);
                    U.audit("publish.revision.restore", "builder_revisions", revision.id, revision.label || "", { page: currentPage.id });
                    A.toast(t("publish.restored"), "ok");
                    A.setDirty(false);
                    loadPage(currentPage.id);
                  });
                });
              } } }, t("publish.restore")))
          }));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("ucms.editor.revisionEmpty")));
      }).catch(A.fail);
      A.modal({ title: t("publish.revisions"), body: list, size: "md" });
    }

    function publishCurrent() {
      if (!A.can.publish) { A.toast(t("msg.adminOnly"), "error"); return; }
      A.confirm(t("publish.confirmPublish"), t("publish.publish")).then(function (ok) {
        if (ok) saveDraft(true).catch(A.fail);
      });
    }

    function unpublishCurrent() {
      if (!editor || !currentPage) return;
      A.confirm(t("publish.confirmUnpublish"), t("publish.unpublish")).then(function (ok) {
        if (!ok) return;
        Promise.all([
          db.from("builder_editor_documents").update({ status: "draft" }).eq("project_id", projectId).eq("page_id", currentPage.id),
          db.from("builder_project_pages").update({ is_published: false }).eq("id", currentPage.id)
        ]).then(function (res) {
          var bad = res.filter(function (x) { return x.error; })[0];
          if (bad) return A.fail(bad.error);
          U.audit("publish.unpublish", "builder_documents", currentPage.id, A.tx(currentPage.title) || currentPage.slug, {});
          status.textContent = "draft";
          A.toast(t("publish.unpublished"), "ok");
        });
      });
    }

    function saveSelectedComponent() {
      if (!editor) return;
      var selected = editor.getSelected();
      if (!selected) { A.toast(t("editor.componentSave"), "error"); return; }
      var name = A.fText(t("ucms.editor.componentName"), "", { required: true, placeholder: "GDF CTA band" });
      A.modal({ title: t("editor.componentSave"), size: "sm", body: h("div", { class: "grid" }, name), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("editor.componentSave"), cls: "btn-gold", onClick: function (m, btn) {
          if (!name.validate()) return;
          A.busy(btn, true);
          db.from("builder_project_components").insert({
            project_id: projectId,
            name: name.get().trim(),
            category: "Components",
            html: selected.toHtml(),
            css: "",
            is_published: true
          }).then(function (r) {
            A.busy(btn, false);
            if (r.error) return A.fail(r.error);
            U.audit("design.component.create", "builder_components", r.data.id, name.get().trim(), { project: projectId });
            m.close(); A.toast(t("editor.componentSaved"), "ok");
          }).catch(function (e) { A.busy(btn, false); A.fail(e); });
        } }] });
    }

    projectSelect.addEventListener("change", loadPages);
    pageSelect.addEventListener("change", function () { loadPage(pageSelect.value); });

    var toolbar = h("div", { class: "gjs-toolbar" },
      h("label", null, t("project.projects"), " ", projectSelect),
      h("label", null, t("editor.pages"), " ", pageSelect),
      h("button", { type: "button", class: "btn btn-sm", on: { click: function () { editor && editor.UndoManager.undo(); } } }, "↶ " + t("editor.undo")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: function () { editor && editor.UndoManager.redo(); } } }, "↷ " + t("editor.redo")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: function () { editor && editor.setDevice(t("editor.desktop")); } } }, t("editor.desktop")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: function () { editor && editor.setDevice(t("editor.tablet")); } } }, t("editor.tablet")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: function () { editor && editor.setDevice(t("editor.mobile")); } } }, t("editor.mobile")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: openPreview } }, t("editor.preview")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: saveSelectedComponent } }, t("editor.componentSave")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: duplicateSelectedElement } }, t("editor.duplicate")),
      h("button", { type: "button", class: "btn btn-sm btn-danger", on: { click: deleteSelectedElement } }, t("btn.delete")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: openRevisionHistory } }, t("publish.revisions")),
      h("button", { type: "button", class: "btn btn-sm", on: { click: saveRevision } }, t("ucms.editor.revisionSave")),
      h("button", { type: "button", class: "btn btn-gold", on: { click: function () { saveDraft(false).catch(A.fail); } } }, t("editor.saveDraft")),
      A.can.publish ? h("button", { type: "button", class: "btn", on: { click: publishCurrent } }, t("publish.publish")) : null,
      A.can.publish ? h("button", { type: "button", class: "btn btn-ghost", on: { click: unpublishCurrent } }, t("publish.unpublish")) : null,
      status);

    var panel = h("div", { class: "gjs-layout" },
      h("aside", { class: "gjs-side gjs-left" },
        h("div", { class: "gjs-tabbar" }, h("strong", null, t("editor.blocks")), h("strong", null, t("editor.layers"))),
        h("div", { class: "gjs-panel-section" }, blocksHost),
        h("div", { class: "gjs-panel-section" }, layersHost)),
      h("main", { class: "gjs-canvas" }, canvasHost),
      h("aside", { class: "gjs-side gjs-right" }, h("strong", { class: "gjs-side-title" }, t("editor.styles")), stylesHost, h("strong", { class: "gjs-side-title" }, "Traits"), traitsHost));

    view.appendChild(toolbar);
    view.appendChild(panel);
    view.appendChild(deployNote);
    return loadProjects();
  } });

  /* ==================================================================== */
  /* GLOBAL STYLES (design tokens)                                        */
  /* ==================================================================== */
  var FONTS = ["", "Inter", "Playfair Display", "Cormorant Garamond", "Montserrat", "Lora", "Poppins", "Merriweather", "Cairo", "Tajawal", "Arial", "Georgia"];
  A.register("design", { group: "design", icon: "◐", title: "nav.design", preview: "./", render: function (view) {
    var tk = U.clone(A.data.settings["theme.tokens"]);
    var colors = [["primary", "ds.primary", "#081933"], ["gold", "ds.gold", "#EAD7B0"], ["secondary", "ds.secondary", "#EAD7B0"], ["background", "ds.background", "#F1E8D1"], ["text", "ds.text", "#262626"], ["heading", "ds.heading", "#081933"], ["surface", "ds.surface", "#0e2041"], ["border", "ds.border", "#EAD7B0"], ["button_bg", "ds.buttonBg", "#EAD7B0"], ["button_text", "ds.buttonText", "#081933"]]
      .map(function (c) { return [c[0], A.fColor(t(c[1]), tk[c[0]], c[2])]; });
    var px = function (v) { return v === "" || v == null ? "" : Math.max(0, Math.min(200, parseInt(v, 10))) + "px"; };
    var type = [
      ["font_body", A.fSelect(t("ds.fontBody"), tk.font_body || "", FONTS.map(function (f) { return [f, f || t("ds.default")]; }))],
      ["font_heading", A.fSelect(t("ds.fontHeading"), tk.font_heading || "", FONTS.map(function (f) { return [f, f || t("ds.default")]; }))],
      ["font_size", A.fSelect(t("ds.fontSize"), tk.font_size || "", [["", t("ds.default")], ["14px", "14px"], ["15px", "15px"], ["16px", "16px"], ["17px", "17px"], ["18px", "18px"]])]
    ];
    var shape = [
      ["radius", A.fText(t("ds.radius") + " (px)", tk.radius ? parseInt(tk.radius, 10) : "", { type: "number", placeholder: "auto" }), px],
      ["section_y", A.fText(t("ds.sectionY") + " (px)", tk.section_y ? parseInt(tk.section_y, 10) : "", { type: "number", placeholder: "auto" }), px],
      ["button_style", A.fSelect(t("ds.buttonStyle"), tk.button_style || "", [["", t("ds.default")], ["pill", t("ds.pill")], ["square", t("ds.square")], ["outline", t("ds.outline")]])]
    ];
    var all = colors.concat(type, shape);
    function collect() { var o = {}; all.forEach(function (f) { var v = f[1].get(); if (f[2]) v = f[2](v); if (v !== "" && v != null) o[f[0]] = v; }); return o; }
    view.appendChild(h("p", { class: "muted" }, t("ds.help")));
    if (!A.can.design) view.appendChild(h("div", { class: "banner", style: { margin: "0 0 16px" } }, t("msg.adminOnly")));
    view.appendChild(A.card(t("ds.colors"), A.grid(4, colors.map(function (c) { return c[1]; }))));
    view.appendChild(A.card(t("ds.type"), A.grid(3, type.map(function (c) { return c[1]; }))));
    view.appendChild(A.card(t("ds.shape"), A.grid(3, shape.map(function (c) { return c[1]; }))));
    var reset = h("button", { type: "button", class: "btn btn-ghost", on: { click: function () {
      A.confirm(t("btn.reset") + "?", t("btn.reset"), false).then(function (ok) { if (!ok) return; A.saveSetting("theme.tokens", {}, "Design tokens").then(function () { U.audit("design.tokens.reset", "site_settings", "theme.tokens", "Design tokens", {}); A.toast(t("msg.saved"), "ok"); A.setDirty(false); A.go("design", true); }).catch(A.fail); });
    } } }, t("btn.reset"));
    var bar = A.saveBar(function () { return A.saveSetting("theme.tokens", collect(), "Design tokens (Design Settings page)").then(function () { U.audit("design.tokens.save", "site_settings", "theme.tokens", "Design tokens", {}); }); });
    bar.insertBefore(reset, bar.lastChild);
    view.appendChild(bar);
    var send = function () { A.queuePreview(function () { return { settings: { "theme.tokens": collect() } }; }); };
    view.addEventListener("input", send); view.addEventListener("change", send);
  } });

  /* ==================================================================== */
  /* REUSABLE COMPONENTS manager                                          */
  /* ==================================================================== */
  A.register("components", { group: "design", icon: "❏", title: "ucms.nav.components", render: function (view) {
    var projectSelect = h("select");
    var projectId = A.editorProjectId || null;
    var list = h("div", { class: "rows" });
    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) { projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug)); });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        return load();
      });
    }
    function load() {
      projectId = projectSelect.value;
      A.editorProjectId = projectId;
      list.innerHTML = '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      return db.from("builder_project_components").select("*").eq("project_id", projectId).order("sort_order").then(function (r) {
        if (r.error) throw r.error;
        list.innerHTML = "";
        (r.data || []).forEach(function (c) {
          list.appendChild(A.row({ id: c.id, draggable: false, title: c.name, sub: c.category,
            badges: c.is_published ? A.badge(t("ucms.components.published"), "ok") : A.badge(t("project.statusDraft"), "gold"),
            actions: h("div", { class: "r-actions" },
              h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { sandboxPreview(c.name, c.html, c.css); } } }, t("ucms.pages.preview")),
              h("button", { type: "button", class: "icon-btn", title: t("btn.edit"), on: { click: function () { edit(c); } } }, "✎"),
              h("button", { type: "button", class: "icon-btn danger", title: t("btn.delete"), on: { click: function () { remove(c); } } }, "🗑")) }));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("ucms.components.empty")));
      }).catch(A.fail);
    }
    function edit(c) {
      var isNew = !c; c = c || {};
      var name = A.fText(t("ucms.components.name"), c.name || "", { required: true });
      var cat = A.fText(t("ucms.components.category"), c.category || "Components");
      var html = h("textarea", { rows: 10, class: "code-input" }); html.value = c.html || "";
      var css = h("textarea", { rows: 6, class: "code-input" }); css.value = c.css || "";
      var pub = A.fToggle(t("ucms.components.published"), c.is_published !== false);
      A.modal({ title: isNew ? t("ucms.components.new") : c.name, size: "lg", body: h("div", { class: "grid" }, name, cat, h("label", { class: "field" }, h("span", null, t("ucms.components.html")), html), h("label", { class: "field" }, h("span", null, t("ucms.components.css")), css), pub), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("btn.save"), cls: "btn-gold", onClick: function (m, btn) {
          if (!name.validate()) return;
          var rec = { project_id: projectId, name: name.get(), category: cat.get() || "Components", html: html.value, css: css.value, is_published: pub.get() };
          A.busy(btn, true);
          (isNew ? db.from("builder_project_components").insert(rec) : db.from("builder_project_components").update(rec).eq("id", c.id)).then(function (x) {
            A.busy(btn, false);
            if (x.error) return A.fail(x.error);
            U.audit(isNew ? "design.component.create" : "design.component.update", "builder_components", x.data && x.data.id ? x.data.id : c.id, rec.name, {});
            m.close(); A.toast(t("msg.saved"), "ok"); load();
          });
        } }] });
    }
    function remove(c) {
      A.confirm(t("msg.confirmDelete"), t("btn.delete"), true).then(function (ok) {
        if (!ok) return;
        db.from("builder_project_components").delete().eq("id", c.id).then(function (x) {
          if (x.error) return A.fail(x.error);
          U.audit("design.component.delete", "builder_components", c.id, c.name, {});
          A.toast(t("ucms.components.deleted"), "ok"); load();
        });
      });
    }
    projectSelect.addEventListener("change", load);
    view.appendChild(h("div", { class: "toolbar", "data-nodirty": "1" }, h("label", null, t("project.projects"), " ", projectSelect)));
    view.appendChild(A.card(t("ucms.components.title"), [list], { help: t("ucms.components.sub") }));
    return loadProjects();
  } });

  /* ==================================================================== */
  /* PAGE TEMPLATES manager                                               */
  /* ==================================================================== */
  A.register("templates", { group: "design", icon: "🖫", title: "ucms.nav.templates", render: function (view) {
    var list = h("div", { class: "rows" });
    var projectSelect = h("select");
    var projectId = A.editorProjectId || null;
    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) { projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug)); });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        return load();
      });
    }
    function load() {
      projectId = projectSelect.value;
      A.editorProjectId = projectId;
      list.innerHTML = '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      return db.from("builder_page_templates").select("*").eq("is_published", true).order("sort_order").then(function (r) {
        if (r.error) throw r.error;
        list.innerHTML = "";
        (r.data || []).forEach(function (tpl) {
          list.appendChild(A.row({ id: tpl.id, draggable: false, title: A.tx(tpl.name), sub: A.tx(tpl.description) || "",
            actions: h("div", { class: "r-actions" },
              h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { sandboxPreview(A.tx(tpl.name) || tpl.slug, tpl.html, tpl.css); } } }, t("ucms.templates.preview")),
              h("button", { type: "button", class: "btn btn-sm btn-gold", on: { click: function () { apply(tpl); } } }, t("ucms.templates.use"))) }));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("msg.empty")));
      }).catch(A.fail);
    }
    function apply(tpl) {
      var slug = A.fText(t("ucms.templates.slug"), "", { required: true, pattern: /^[a-z0-9/_-]{1,120}$/, help: "about-us" });
      A.modal({ title: t("ucms.templates.use") + " · " + (A.tx(tpl.name) || tpl.slug), size: "sm", body: h("div", { class: "grid" }, slug), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("ucms.templates.use"), cls: "btn-gold", onClick: function (m, btn) {
          if (!slug.validate()) return;
          A.busy(btn, true);
          db.from("builder_project_pages").select("id").eq("project_id", projectId).eq("slug", slug.get()).maybeSingle().then(function (ex) {
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
    }
    projectSelect.addEventListener("change", load);
    view.appendChild(h("div", { class: "toolbar", "data-nodirty": "1" }, h("label", null, t("ucms.templates.project"), " ", projectSelect)));
    view.appendChild(A.card(t("ucms.templates.title"), [list], { help: t("ucms.templates.sub") }));
    return loadProjects();
  } });

  /* ==================================================================== */
  /* PROJECT SETTINGS (builder navigation / header / footer / tokens)     */
  /* ==================================================================== */
  A.register("website-management", { group: "design", icon: "◇", title: "ucms.nav.projectSettings", render: function (view) {
    var projectSelect = h("select");
    var projectId = A.editorProjectId || null;
    var host = h("div");

    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name,status,is_system").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) {
          projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug));
        });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        /* sync the closure before rendering tabs, or every query filters project_id = null */
        projectId = projectSelect.value || null;
        renderTabs();
      });
    }

    function setting(key) {
      return db.from("builder_project_settings").select("value").eq("project_id", projectId).eq("key", key).maybeSingle();
    }

    function saveSetting(key, value) {
      return db.from("builder_project_settings").upsert({ project_id: projectId, key: key, value: value }, { onConflict: "project_id,key" }).then(function (r) {
        if (r.error) throw r.error;
        U.audit("design.project_setting", "builder_settings", projectId + ":" + key, key, {});
        A.toast(t("manage.saved"), "ok");
      });
    }

    function renderNavigation(host2) {
      function section(location, title) {
        var list = h("div", { class: "rows" });
        function load() {
          db.from("builder_project_navigation").select("*").eq("project_id", projectId).eq("location", location).order("sort_order").then(function (r) {
            if (r.error) throw r.error;
            list.innerHTML = "";
            (r.data || []).forEach(function (n) {
              list.appendChild(A.row({ id: n.id, title: A.tx(n.label) || n.href, sub: n.href,
                badges: n.is_visible ? A.badge(t("f.visible"), "ok") : A.badge(t("f.visible") + " ✕", "off"),
                draggable: true, onMove: function () { saveOrder(); },
                onEdit: function () { edit(n); }, onDelete: function () { remove(n); } }));
            });
            if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("msg.empty")));
            A.sortable(list, saveOrder, "navigation-" + projectId + "-" + location);
          }).catch(A.fail);
        }
        function saveOrder() {
          var jobs = A.$$(":scope > .row", list).map(function (row, i) {
            return db.from("builder_project_navigation").update({ sort_order: i }).eq("id", row.getAttribute("data-id"));
          });
          Promise.all(jobs).then(function (res) { var bad = res.filter(function (x) { return x.error; })[0]; if (bad) A.fail(bad.error); });
        }
        function edit(n) {
          n = n || {};
          var label = A.fI18n(t("f.label"), n.label || {}, { required: true });
          var href = A.fText(t("f.link"), n.href || "", { required: true, url: true });
          var visible = A.fToggle(t("f.visible"), n.is_visible !== false);
          A.modal({ title: n.id ? t("btn.edit") : t("manage.newLink"), body: h("div", { class: "grid" }, label, href, visible), actions: [
            { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
            { label: t("btn.save"), cls: "btn-gold", onClick: function (m, btn) {
              if (!A.validateAll([label, href])) return;
              var rec = { project_id: projectId, label: label.get(), href: href.get(), location: location, is_visible: visible.get() };
              A.busy(btn, true);
              (n.id ? db.from("builder_project_navigation").update(rec).eq("id", n.id) : db.from("builder_project_navigation").insert(Object.assign({ sort_order: 999 }, rec))).then(function (x) {
                A.busy(btn, false); if (x.error) return A.fail(x.error); U.audit("design.project_nav", "builder_navigation", x.data ? x.data.id : n.id, A.tx(rec.label) || rec.href, { location: location }); m.close(); A.toast(t("msg.saved"), "ok"); load();
              });
            } }] });
        }
        function remove(n) {
          A.confirm(t("msg.confirmDelete"), t("btn.delete"), true).then(function (ok) {
            if (!ok) return;
            db.from("builder_project_navigation").delete().eq("id", n.id).then(function (x) { if (x.error) return A.fail(x.error); U.audit("design.project_nav_delete", "builder_navigation", n.id, n.href || "", {}); A.toast(t("msg.deleted"), "ok"); load(); });
          });
        }
        host2.appendChild(A.card(title,
          [h("div", { class: "toolbar" }, h("button", { type: "button", class: "btn btn-sm btn-gold", on: { click: function () { edit(null); } } }, "+ " + t("manage.newLink"))), list]));
        load();
      }
      section("header", t("manage.headerNav"));
      section("footer", t("manage.footerNav"));
    }

    function renderGlobal(host2, location) {
      Promise.all([setting(location + ".settings"), setting(location === "header" ? "global.logo" : "global.footer")]).then(function (r) {
        var main = r[0].data && r[0].data.value ? r[0].data.value : {};
        var logo = r[1].data && r[1].data.value ? r[1].data.value : "";
        var logoField = A.fImage(t("manage.logo"), typeof logo === "string" ? logo : (main.logo_url || ""), { folder: "project/" + projectId + "/" + location });
        var nameVisible = A.fToggle(t("manage.nameVisible"), main.show_name !== false);
        var primary = A.fColor(t("manage.primary"), main.primary);
        var accent = A.fColor(t("manage.accent"), main.accent);
        var bg = A.fColor(t("manage.background"), main.background);
        var text = A.fColor(t("manage.text"), main.text);
        host2.appendChild(A.card(location === "header" ? t("manage.header") : t("manage.footer"),
          [A.grid(2, [logoField, nameVisible, primary, accent, bg, text]),
            h("div", { class: "savebar" }, h("button", { type: "button", class: "btn btn-gold", on: { click: function () {
              var value = { logo_url: logoField.get(), show_name: nameVisible.get(), primary: primary.get(), accent: accent.get(), background: bg.get(), text: text.get() };
              saveSetting(location + ".settings", value).catch(A.fail);
            } } }, t("btn.save")))]));
      }).catch(A.fail);
    }

    function renderDesign(host2) {
      setting("design.tokens").then(function (r) {
        var v = r.data && r.data.value ? r.data.value : {};
        var fields = [
          A.fColor(t("manage.primary"), v.primary),
          A.fColor(t("manage.accent"), v.accent),
          A.fColor(t("manage.background"), v.background),
          A.fColor(t("manage.text"), v.text),
          A.fText(t("manage.fontBody"), v.font_body || "", { placeholder: "Inter" }),
          A.fText(t("manage.fontHeading"), v.font_heading || "", { placeholder: "Playfair Display" }),
          A.fText(t("manage.radius"), v.radius || "", { placeholder: "14px" }),
          A.fText(t("manage.sectionSpacing"), v.section_spacing || "", { placeholder: "80px" })
        ];
        host2.appendChild(A.card(t("manage.design"),
          [A.grid(2, fields),
            h("div", { class: "savebar" }, h("button", { type: "button", class: "btn btn-gold", on: { click: function () {
              var value = { primary: fields[0].get(), accent: fields[1].get(), background: fields[2].get(), text: fields[3].get(), font_body: fields[4].get(), font_heading: fields[5].get(), radius: fields[6].get(), section_spacing: fields[7].get() };
              saveSetting("design.tokens", value).catch(A.fail);
            } } }, t("btn.save")))]));
      }).catch(A.fail);
    }

    function renderTabs() {
      A.editorProjectId = projectId;
      host.innerHTML = "";
      host.appendChild(A.tabs([
        { key: "navigation", label: t("manage.navigation"), render: renderNavigation },
        { key: "header", label: t("manage.header"), render: function (h) { renderGlobal(h, "header"); } },
        { key: "footer", label: t("manage.footer"), render: function (h) { renderGlobal(h, "footer"); } },
        { key: "design", label: t("manage.design"), render: renderDesign }
      ]));
    }

    projectSelect.addEventListener("change", function () {
      projectId = projectSelect.value;
      renderTabs();
    });
    view.appendChild(h("p", { class: "muted" }, t("ucms.builder.sub")));
    view.appendChild(h("div", { class: "toolbar", "data-nodirty": "1" }, h("label", null, t("project.projects"), " ", projectSelect)));
    view.appendChild(host);
    return loadProjects();
  } });

  /* ==================================================================== */
  /* HERO, MEDIA ASSETS, RESPONSIVE (advanced editing)                    */
  /* ==================================================================== */
  A.register("advanced-editing", { group: "design", icon: "◫", title: "advanced.title", render: function (view) {
    var projectSelect = h("select");
    var projectId = A.editorProjectId || null;
    var host = h("div");

    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) {
          projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug));
        });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        /* sync the closure before rendering tabs, or every query filters project_id = null */
        projectId = projectSelect.value || null;
        renderTabs();
      }).catch(A.fail);
    }

    function renderMedia(host2) {
      var grid = h("div", { class: "media-grid" });
      var file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "search" });
      var upload = h("button", { type: "button", class: "btn btn-gold", on: { click: function () { file.click(); } } }, t("advanced.upload"));
      function load() {
        grid.innerHTML = "";
        db.from("builder_project_assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) grid.appendChild(h("div", { class: "empty" }, t("md.empty")));
          (r.data || []).forEach(function (a) {
            var item = h("article", { class: "media-item" },
              h("div", { class: "mi-img" }, h("img", { src: a.asset_url, alt: a.name, loading: "lazy" })),
              h("div", { class: "mi-body" },
                h("span", { class: "mi-name" }, a.name),
                h("div", { class: "mi-actions" },
                  h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { copyAsset(a.asset_url); } } }, t("btn.copy")),
                  h("button", { type: "button", class: "icon-btn danger", title: t("advanced.deleteAsset"), on: { click: function () { deleteAsset(a); } } }, "×"))));
            grid.appendChild(item);
          });
        }).catch(A.fail);
      }
      function copyAsset(url) {
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { A.toast(t("msg.copied"), "ok"); }, function () { window.prompt("URL", url); });
        else window.prompt("URL", url);
      }
      function deleteAsset(a) {
        A.confirm(t("advanced.deleteAsset") + "?", t("btn.delete"), true).then(function (ok) {
          if (!ok) return;
          db.from("builder_project_assets").delete().eq("id", a.id).then(function (r) {
            if (r.error) return A.fail(r.error);
            var path = a.asset_url.indexOf("/site-media/") >= 0 ? a.asset_url.split("/site-media/")[1] : null;
            if (path) db.storage.from("site-media").remove([decodeURIComponent(path)]).catch(A.fail);
            U.audit("media.asset_delete", "builder_assets", a.id, a.name, {});
            A.toast(t("msg.deleted"), "ok"); load();
          });
        });
      }
      file.addEventListener("change", function () {
        var f = file.files[0]; if (!f) return;
        A.upload(f, "project/" + projectId).then(function (r) {
          return db.from("builder_project_assets").insert({ project_id: projectId, name: f.name, asset_url: r.url, asset_type: f.type });
        }).then(function (r) {
          if (r.error) throw r.error;
          U.audit("media.asset_upload", "builder_assets", r.data && r.data.id ? r.data.id : null, f.name, { project: projectId });
          A.toast(t("up.done"), "ok"); file.value = ""; load();
        }).catch(function (e) { A.fail(e, t("up.failed")); });
      });
      host2.appendChild(h("div", { class: "card" }, h("div", { class: "toolbar", "data-nodirty": "1" }, file, upload), grid));
      load();
    }

    function renderHero(host2) {
      var pageSelect = h("select");
      var title = A.fI18n(t("f.title"), {}, { required: true });
      var subtitle = A.fI18n(t("f.description"), {}, { multiline: true });
      var bgType = A.fSelect(t("advanced.backgroundType"), "image", [["image", "Image"], ["video", "Video"], ["color", "Colour"]]);
      var bgImage = A.fImage(t("advanced.backgroundImage"), "", { folder: "project/" + projectId + "/hero" });
      var bgVideo = A.fText(t("advanced.backgroundVideo"), "", { url: true, https: true });
      var bgColor = A.fColor(t("manage.background"), "");
      var overlay = A.fColor(t("advanced.overlay"), "");
      var opacity = A.fText(t("advanced.opacity"), "50", { type: "number", placeholder: "50" });
      var ctaLabel = A.fI18n(t("f.label"), {}, {});
      var ctaUrl = A.fText(t("f.link"), "", { url: true });
      var visible = A.fToggle(t("advanced.visible"), true);

      function loadPagesAndHero() {
        db.from("builder_project_pages").select("id,slug,title").eq("project_id", projectId).order("sort_order").then(function (r) {
          if (r.error) throw r.error;
          pageSelect.innerHTML = "";
          (r.data || []).forEach(function (p) { pageSelect.appendChild(h("option", { value: p.id }, A.tx(p.title) || p.slug)); });
          loadHero();
        }).catch(A.fail);
      }
      function loadHero() {
        var pageId = pageSelect.value || null;
        if (!pageId) return;
        db.from("builder_project_heroes").select("*").eq("project_id", projectId).eq("page_id", pageId).maybeSingle().then(function (r) {
          if (r.error) throw r.error;
          var v = r.data || {};
          title.set(v.title || {});
          subtitle.set(v.subtitle || {});
          bgType.set(v.background_type || "image");
          bgImage.set(v.background_url || "");
          bgVideo.set(v.background_video_url || "");
          bgColor.set(v.background_color || "");
          overlay.set(v.overlay_color || "");
          opacity.set(String(v.overlay_opacity == null ? 50 : v.overlay_opacity));
          ctaLabel.set(v.cta_label || {});
          ctaUrl.set(v.cta_url || "");
          visible.set(v.is_visible !== false);
        }).catch(A.fail);
      }
      pageSelect.addEventListener("change", loadHero);
      loadPagesAndHero();
      host2.appendChild(A.card(t("advanced.hero"),
        [h("label", { class: "field" }, h("span", null, t("manage.pages")), pageSelect),
          A.grid(2, [title, subtitle, bgType, bgImage, bgVideo, bgColor, overlay, opacity, ctaLabel, ctaUrl, visible]),
          h("div", { class: "savebar" }, h("button", { type: "button", class: "btn btn-gold", on: { click: function () {
            var n = Math.max(0, Math.min(100, parseInt(opacity.get(), 10) || 0));
            var rec = { project_id: projectId, page_id: pageSelect.value, title: title.get(), subtitle: subtitle.get(), background_type: bgType.get(), background_url: bgImage.get() || null, background_video_url: bgVideo.get() || null, background_color: bgColor.get() || null, overlay_color: overlay.get() || null, overlay_opacity: n, cta_label: ctaLabel.get(), cta_url: ctaUrl.get() || null, is_visible: visible.get() };
            db.from("builder_project_heroes").upsert(rec, { onConflict: "project_id,page_id" }).then(function (r) {
              if (r.error) return A.fail(r.error);
              U.audit("design.hero_save", "builder_heroes", pageSelect.value, pageSelect.value, {});
              A.toast(t("manage.saved"), "ok");
            });
          } } }, t("btn.save")))]));
    }

    function parseStyle(text) {
      try {
        var v = JSON.parse(text || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch (e) { return null; }
    }
    function renderResponsive(host2) {
      var list = h("div", { class: "rows" });
      function load() {
        db.from("builder_project_responsive").select("*").eq("project_id", projectId).order("selector").then(function (r) {
          if (r.error) throw r.error;
          list.innerHTML = "";
          (r.data || []).forEach(function (x) {
            list.appendChild(A.row({ id: x.id, title: x.selector, sub: "Desktop / Tablet / Mobile", onEdit: function () { edit(x); }, onDelete: function () { remove(x); } }));
          });
          if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("msg.empty")));
        }).catch(A.fail);
      }
      function edit(x) {
        x = x || {};
        var selector = A.fText(t("advanced.selector"), x.selector || "", { required: true, pattern: /^[A-Za-z0-9_\-#.:[\] >+~*="'%,]+$/ });
        var desktop = A.fText(t("advanced.desktop"), JSON.stringify(x.desktop || {}, null, 2), { multiline: true, rows: 5, placeholder: "{}" });
        var tablet = A.fText(t("advanced.tablet"), JSON.stringify(x.tablet || {}, null, 2), { multiline: true, rows: 5, placeholder: "{}" });
        var mobile = A.fText(t("advanced.mobile"), JSON.stringify(x.mobile || {}, null, 2), { multiline: true, rows: 5, placeholder: "{}" });
        A.modal({ title: x.id ? t("btn.edit") : t("advanced.responsive"), body: h("div", { class: "grid" }, selector, h("p", { class: "muted" }, t("advanced.jsonHelp")), desktop, tablet, mobile), actions: [
          { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
          { label: t("btn.save"), cls: "btn-gold", onClick: function (m, btn) {
            var ds = parseStyle(desktop.get()), ts = parseStyle(tablet.get()), ms = parseStyle(mobile.get());
            if (!selector.validate()) return;
            if (!ds || !ts || !ms) { A.toast(t("advanced.jsonHelp"), "error"); return; }
            var rec = { project_id: projectId, selector: selector.get(), desktop: ds, tablet: ts, mobile: ms };
            A.busy(btn, true);
            (x.id ? db.from("builder_project_responsive").update(rec).eq("id", x.id) : db.from("builder_project_responsive").insert(rec)).then(function (r) {
              A.busy(btn, false); if (r.error) return A.fail(r.error); U.audit("design.responsive_save", "builder_responsive", x.id || selector.get(), selector.get(), {}); m.close(); A.toast(t("msg.saved"), "ok"); load();
            });
          } }] });
      }
      function remove(x) {
        A.confirm(t("msg.confirmDelete"), t("btn.delete"), true).then(function (ok) {
          if (!ok) return;
          db.from("builder_project_responsive").delete().eq("id", x.id).then(function (r) { if (r.error) return A.fail(r.error); U.audit("design.responsive_delete", "builder_responsive", x.id, x.selector || "", {}); A.toast(t("msg.deleted"), "ok"); load(); });
        });
      }
      host2.appendChild(A.card(t("advanced.responsive"),
        [h("div", { class: "toolbar" }, h("button", { type: "button", class: "btn btn-gold", on: { click: function () { edit(null); } } }, "+ " + t("advanced.responsive"))), list]));
      load();
    }

    function renderTabs() {
      A.editorProjectId = projectId;
      host.innerHTML = "";
      host.appendChild(A.tabs([
        { key: "media", label: t("advanced.media"), render: renderMedia },
        { key: "hero", label: t("advanced.hero"), render: renderHero },
        { key: "responsive", label: t("advanced.responsive"), render: renderResponsive }
      ]));
    }

    projectSelect.addEventListener("change", function () { projectId = projectSelect.value; renderTabs(); });
    view.appendChild(h("div", { class: "toolbar", "data-nodirty": "1" }, h("label", null, t("project.projects"), " ", projectSelect)));
    view.appendChild(host);
    return loadProjects();
  } });

  /* ==================================================================== */
  /* CODE, IMPORT AND EXPORT                                              */
  /* ==================================================================== */
  A.register("code-archives", { group: "design", icon: "</>", title: "code.title", render: function (view) {
    var projectSelect = h("select");
    var pageSelect = h("select");
    var projectId = A.editorProjectId || null;
    var host = h("div");
    var editors = {};

    function loadProjects() {
      return db.from("builder_projects").select("id,slug,name").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) { projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug)); });
        if (projectId) projectSelect.value = projectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        return loadPages();
      });
    }

    function loadPages() {
      projectId = projectSelect.value;
      A.editorProjectId = projectId;
      return db.from("builder_project_pages").select("id,slug,title,page_type").eq("project_id", projectId).order("sort_order").then(function (r) {
        if (r.error) throw r.error;
        pageSelect.innerHTML = "";
        (r.data || []).forEach(function (p) { pageSelect.appendChild(h("option", { value: p.id }, A.tx(p.title) || p.slug)); });
        if (!pageSelect.options.length) pageSelect.appendChild(h("option", { value: "" }, t("msg.empty")));
        renderTabs();
      });
    }

    function makeEditor(textarea, mode) {
      if (!window.CodeMirror) {
        return {
          getValue: function () { return textarea.value; },
          setValue: function (value) { textarea.value = value == null ? "" : value; }
        };
      }
      return window.CodeMirror.fromTextArea(textarea, {
        mode: mode,
        lineNumbers: true,
        tabSize: 2,
        indentWithTabs: false,
        lineWrapping: true,
        theme: "default"
      });
    }

    function renderCode(host2) {
      var htmlArea = h("textarea", { rows: 18 });
      var cssArea = h("textarea", { rows: 18 });
      var jsArea = h("textarea", { rows: 18 });
      var location = h("select");
      [["head", "Head"], ["page", "Page"], ["footer", "Footer"]].forEach(function (x) { location.appendChild(h("option", { value: x[0] }, x[1])); });
      var legacy = h("label", { class: "toggle" }, h("input", { type: "checkbox" }), h("span", null, t("code.legacy")));
      var cmHtml = null;
      var cmCss = null;
      var cmJs = null;

      function load() {
        var pageId = pageSelect.value || null;
        db.from("builder_project_custom_code").select("*").eq("project_id", projectId).eq("location", location.value).then(function (r) {
          if (r.error) throw r.error;
          var row = (r.data || []).filter(function (x) { return (x.page_id || "") === (pageId || "") })[0] || {};
          cmHtml.setValue(row.html || "");
          cmCss.setValue(row.css || "");
          cmJs.setValue(row.javascript || "");
          legacy.querySelector("input").checked = !!row.is_legacy;
        }).catch(A.fail);
      }
      location.addEventListener("change", load);
      pageSelect.addEventListener("change", load);

      host2.appendChild(A.card(t("code.title"), [
        h("div", { class: "toolbar" }, h("label", { class: "field" }, h("span", null, t("code.location")), location)),
        h("div", { class: "grid grid-1 code-editors" },
          h("label", { class: "field" }, h("span", null, t("code.html")), htmlArea),
          h("label", { class: "field" }, h("span", null, t("code.css")), cssArea),
          h("label", { class: "field" }, h("span", null, t("code.js")), jsArea),
          legacy),
        h("div", { class: "savebar" }, h("button", { type: "button", class: "btn btn-gold", on: { click: function () {
          var rec = { project_id: projectId, page_id: pageSelect.value || null, location: location.value, html: cmHtml.getValue(), css: cmCss.getValue(), javascript: cmJs.getValue(), is_legacy: legacy.querySelector("input").checked };
          db.from("builder_project_custom_code").upsert(rec, { onConflict: "project_id,page_id,location" }).then(function (r) {
            if (r.error) return A.fail(r.error);
            U.audit("design.custom_code", "builder_custom_code", projectId + ":" + location.value, location.value, {});
            A.toast(t("code.saved"), "ok");
          });
        } } }, t("code.save")))
      ]));
      cmHtml = makeEditor(htmlArea, "xml");
      cmCss = makeEditor(cssArea, "css");
      cmJs = makeEditor(jsArea, "javascript");
      editors.html = cmHtml; editors.css = cmCss; editors.js = cmJs;
      load();
    }

    function downloadBlob(name, content, type) {
      var url = URL.createObjectURL(new Blob([content], { type: type || "application/octet-stream" }));
      var a = h("a", { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    function buildManifest() {
      return Promise.all([
        db.from("builder_project_pages").select("*").eq("project_id", projectId),
        db.from("builder_project_settings").select("key,value").eq("project_id", projectId),
        db.from("builder_project_navigation").select("*").eq("project_id", projectId),
        db.from("builder_editor_documents").select("*").eq("project_id", projectId),
        db.from("builder_project_custom_code").select("*").eq("project_id", projectId),
        db.from("builder_project_assets").select("*").eq("project_id", projectId)
      ]);
    }

    function renderArchives(host2) {
      var file = h("input", { type: "file", accept: ".html,.htm,.zip,application/zip,text/html" });
      var exportZip = h("button", { type: "button", class: "btn btn-gold", on: { click: function () { exportWebsite().catch(A.fail); } } }, t("code.export"));
      var importBtn = h("button", { type: "button", class: "btn", on: { click: function () { file.click(); } } }, t("code.import"));
      var history = h("div", { class: "rows" });

      function loadHistory() {
        db.from("builder_project_archives").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).then(function (r) {
          if (r.error) throw r.error;
          history.innerHTML = "";
          (r.data || []).forEach(function (x) {
            history.appendChild(A.row({ id: x.id, title: x.file_name || x.operation, sub: x.operation + " · " + x.status + " · " + A.fmtDateTime(x.created_at) }));
          });
          if (!(r.data || []).length) history.appendChild(h("div", { class: "empty" }, t("msg.empty")));
        }).catch(A.fail);
      }

      function recordArchive(operation, fileName, manifest, status, error) {
        return db.from("builder_project_archives").insert({ project_id: projectId, operation: operation, status: status, file_name: fileName, manifest: manifest, error: error || null, created_by: A.user.id });
      }

      async function exportWebsite() {
        var manifest = {};
        var result = await buildManifest();
        var bad = result.filter(function (r) { return r.error; })[0];
        if (bad) throw bad.error;
        ["pages", "settings", "navigation", "documents", "code", "assets"].forEach(function (key, i) { manifest[key] = result[i].data || []; });
        manifest.project_id = projectId;
        manifest.exported_at = new Date().toISOString();

        var archiveName = "builder-project-" + projectId + "-" + Date.now().toString(36);
        if (window.JSZip) {
          var zip = new window.JSZip();
          zip.file("manifest.json", JSON.stringify(manifest, null, 2));
          (manifest.documents || []).forEach(function (d) {
            var page = (manifest.pages || []).filter(function (p) { return p.id === d.page_id; })[0];
            var slug = page ? page.slug.replace(/^\.\/$/, "").replace(/\/+$/, "") : d.page_id;
            var exportPath = slug ? slug + "/index.html" : "index.html";
            zip.file(exportPath, "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>" + d.css + "</style></head><body>" + d.html + "<script>" + d.javascript + "<\/script></body></html>");
          });
          (manifest.code || []).forEach(function (c, i) { zip.file("custom-code/" + i + "-" + c.location + ".html", c.html || ""); zip.file("custom-code/" + i + "-" + c.location + ".css", c.css || ""); zip.file("custom-code/" + i + "-" + c.location + ".js", c.javascript || ""); });
          var blob = await zip.generateAsync({ type: "blob" });
          var url = URL.createObjectURL(blob);
          var a = h("a", { href: url, download: archiveName + ".zip" });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        } else {
          downloadBlob(archiveName + ".json", JSON.stringify(manifest, null, 2), "application/json");
        }
        await recordArchive("export", archiveName + (window.JSZip ? ".zip" : ".json"), manifest, "completed");
        U.audit("design.export", "builder_archives", projectId, archiveName, {});
        A.toast(t("code.exported"), "ok"); loadHistory();
      }

      file.addEventListener("change", async function () {
        var f = file.files[0]; if (!f) return;
        var manifest = {};
        try {
          var importedHtml = "";
          if (/\.zip$/i.test(f.name) && window.JSZip) {
            var zip = await window.JSZip.loadAsync(f);
            var manifestFile = zip.file("manifest.json");
            if (manifestFile) manifest = JSON.parse(await manifestFile.async("text"));
            else {
              var htmlFiles = [];
              await Promise.all(Object.keys(zip.files).filter(function (n) { return /\.html?$/i.test(n) && !zip.files[n].dir; }).map(async function (n) { htmlFiles.push({ path: n, html: await zip.files[n].async("text") }); }));
              manifest = { imported_files: htmlFiles.map(function (x) { return x.path; }) };
              importedHtml = htmlFiles.length ? htmlFiles[0].html : "";
            }
          } else {
            importedHtml = await f.text();
            manifest = { imported_file: f.name, html: importedHtml, source: "html" };
          }
          if (manifest.pages && manifest.documents) {
            for (const page of manifest.pages) {
              const existing = await db.from("builder_project_pages").select("id").eq("project_id", projectId).eq("slug", page.slug).maybeSingle();
              if (existing.error) throw existing.error;
              if (existing.data) continue;
              await db.from("builder_project_pages").insert({
                project_id: projectId,
                slug: page.slug,
                title: page.title,
                page_type: "visual",
                is_home: !!page.is_home,
                is_published: false,
                sort_order: page.sort_order || 0
              });
            }
            const stagedPages = await db.from("builder_project_pages").select("id,slug").eq("project_id", projectId);
            if (stagedPages.error) throw stagedPages.error;
            for (const document of manifest.documents) {
              const sourcePage = (manifest.pages || []).filter(function (p) { return p.id === document.page_id; })[0];
              const targetPage = sourcePage ? (stagedPages.data || []).filter(function (p) { return p.slug === sourcePage.slug; })[0] : null;
              if (!targetPage) continue;
              const stagedDocument = await db.from("builder_editor_documents").upsert({
                project_id: projectId,
                page_id: targetPage.id,
                html: document.html || "",
                css: document.css || "",
                javascript: document.javascript || "",
                assets: document.assets || [],
                status: "draft"
              }, { onConflict: "project_id,page_id" });
              if (stagedDocument.error) throw stagedDocument.error;
            }
            for (const code of manifest.code || []) {
              const stagedCode = await db.from("builder_project_custom_code").insert({
                project_id: projectId,
                page_id: null,
                location: code.location || "page",
                html: code.html || "",
                css: code.css || "",
                javascript: code.javascript || "",
                is_legacy: true
              });
              if (stagedCode.error) throw stagedCode.error;
            }
          }
          if (importedHtml) {
            var importedDoc = new DOMParser().parseFromString(importedHtml, "text/html");
            var importedStyles = [].slice.call(importedDoc.querySelectorAll("style")).map(function (s) { return s.textContent; }).join("\n");
            var importedScripts = [].slice.call(importedDoc.querySelectorAll("script")).filter(function (s) { return !s.src; }).map(function (s) { return s.textContent; }).join("\n");
            var importedBody = importedDoc.body ? importedDoc.body.innerHTML : importedHtml;
            var targetPage = pageSelect.value || null;
            if (targetPage) {
              var staged = await db.from("builder_project_custom_code").upsert({
                project_id: projectId,
                page_id: targetPage,
                location: "page",
                html: importedBody,
                css: importedStyles,
                javascript: importedScripts,
                is_legacy: true
              }, { onConflict: "project_id,page_id,location" });
              if (staged.error) throw staged.error;
            }
          }
          var inserted = await db.from("builder_project_archives").insert({ project_id: projectId, operation: "import", status: "completed", file_name: f.name, manifest: manifest, created_by: A.user.id }).select().single();
          if (inserted.error) throw inserted.error;
          U.audit("design.import", "builder_archives", inserted.data.id, f.name, {});
          A.toast(t("code.imported"), "ok"); file.value = ""; loadHistory();
        } catch (e) {
          await recordArchive("import", f.name, manifest, "failed", e.message);
          U.audit("design.import", "builder_archives", null, f.name, { error: e.message }, "error");
          A.fail(e); loadHistory();
        }
      });

      host2.appendChild(A.card(t("code.import"), [
        h("div", { class: "toolbar", "data-nodirty": "1" }, file, importBtn, exportZip),
        h("p", { class: "muted" }, t("code.noZip")),
        h("h3", null, t("code.zip")),
        history
      ]));
      loadHistory();
    }

    function renderTabs() {
      host.innerHTML = "";
      host.appendChild(A.tabs([
        { key: "code", label: t("code.title"), render: renderCode },
        { key: "archives", label: t("code.zip"), render: renderArchives }
      ]));
    }

    projectSelect.addEventListener("change", loadPages);
    pageSelect.addEventListener("change", function () { /* handled by Code tab listeners */ });
    view.appendChild(h("div", { class: "toolbar", "data-nodirty": "1" }, h("label", null, t("project.projects"), " ", projectSelect), h("label", null, t("manage.pages"), " ", pageSelect)));
    view.appendChild(host);
    return loadProjects();
  } });

  /* ==================================================================== */
  /* STATIC CHECKS (GDF'27 QA)                                            */
  /* ==================================================================== */
  A.register("gdf27-qa", { group: "system", icon: "✓", title: "ucms.qa.title", render: function (view) {
    var projectId = null;
    var projectSelect = h("select");
    var runBtn = h("button", { type: "button", class: "btn btn-gold" }, t("qa.run"));
    var status = h("span", { class: "muted" });
    var integrations = h("div", { class: "rows" });
    var history = h("div", { class: "rows" });

    function loadProjects() {
      db.from("builder_projects").select("id,name,slug").order("name").then(function (r) {
        if (r.error) throw r.error;
        projectSelect.innerHTML = "";
        (r.data || []).forEach(function (p) {
          projectSelect.appendChild(h("option", { value: p.id }, A.tx(p.name) || p.slug));
        });
        if (A.editorProjectId) projectSelect.value = A.editorProjectId;
        if (!projectSelect.value && projectSelect.options.length) projectSelect.value = projectSelect.options[0].value;
        projectId = projectSelect.value;
        loadIntegrations(); loadHistory();
      }).catch(A.fail);
    }

    function loadIntegrations() {
      db.from("builder_project_integrations").select("*").eq("project_id", projectId).order("integration_key").then(function (r) {
        if (r.error) throw r.error;
        integrations.innerHTML = "";
        (r.data || []).forEach(function (x) {
          integrations.appendChild(A.row({
            id: x.id,
            title: x.integration_key,
            sub: x.source_path + " · " + x.integration_type,
            badges: x.is_protected ? A.badge("Protected", "ok") : A.badge("Legacy", "gold")
          }));
        });
        if (!(r.data || []).length) integrations.appendChild(h("div", { class: "empty" }, t("msg.empty")));
      }).catch(A.fail);
    }

    function loadHistory() {
      db.from("builder_project_test_runs").select("*").eq("project_id", projectId).order("started_at", { ascending: false }).then(function (r) {
        if (r.error) throw r.error;
        history.innerHTML = "";
        (r.data || []).forEach(function (x) {
          history.appendChild(A.row({
            id: x.id,
            title: x.test_key,
            sub: (x.completed_at ? A.fmtDateTime(x.completed_at) : "") + " · " + JSON.stringify(x.details || {}),
            badges: x.status === "passed" ? A.badge(t("qa.passed"), "ok") : (x.status === "failed" ? A.badge(t("qa.failed"), "off") : A.badge(t("qa.pending"), "gold"))
          }));
        });
        if (!(r.data || []).length) history.appendChild(h("div", { class: "empty" }, t("msg.empty")));
      }).catch(A.fail);
    }

    async function record(testKey, testStatus, details) {
      var r = await db.from("builder_project_test_runs").insert({
        project_id: projectId,
        test_key: testKey,
        status: testStatus,
        details: details,
        ran_by: A.user.id,
        completed_at: new Date().toISOString()
      });
      if (r.error) throw r.error;
    }

    runBtn.addEventListener("click", async function () {
      runBtn.disabled = true;
      status.textContent = t("qa.running");
      var paths = ["./", "applications/", "committees/", "team/", "faq/", "about/", "president/", "verify/", "certificate/", "admin/"];
      var results = [];
      for (var i = 0; i < paths.length; i++) {
        try {
          var res = await fetch(new URL(paths[i], document.baseURI).href, { cache: "no-store" });
          results.push({ path: paths[i], status: res.status, ok: res.ok });
        } catch (e) {
          results.push({ path: paths[i], status: "network-error", ok: false });
        }
      }
      var failed = results.filter(function (r) { return !r.ok; });
      try {
        await record("gdf27.static.pages", failed.length ? "failed" : "passed", { results: results });
        var rpcSource = await fetch(new URL("verify-common.js", document.baseURI).href, { cache: "no-store" });
        var rpcText = rpcSource.ok ? await rpcSource.text() : "";
        var rpcFixed = rpcText.indexOf("p_certificate_id") >= 0;
        await record("gdf27.certificate.rpc_parameter", rpcFixed ? "passed" : "failed", { p_certificate_id: rpcFixed });
        U.audit("qa.run", "builder_test_runs", projectId, projectId, { failed: failed.length });
        if (failed.length) A.notify("warning", t("qa.failed"), failed.length + " routes failed", "gdf27-qa");
      } catch (e) {
        A.fail(e);
      }
      status.textContent = failed.length ? t("qa.failed") : t("qa.passed");
      runBtn.disabled = false;
      loadHistory();
    });

    projectSelect.addEventListener("change", function () {
      projectId = projectSelect.value;
      A.editorProjectId = projectId;
      loadIntegrations(); loadHistory();
    });
    view.appendChild(h("p", { class: "muted" }, t("ucms.qa.sub")));
    view.appendChild(h("div", { class: "toolbar", "data-nodirty": "1" }, h("label", null, t("manage.selectProject"), " ", projectSelect), runBtn, status));
    view.appendChild(A.card(t("qa.integrations"), integrations));
    view.appendChild(A.card(t("qa.results"), history));
    loadProjects();
  } });
})();
