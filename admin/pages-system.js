/* =====================================================================
   GDF'27 UCMS — System Administration (group "system"):
   Audit Logs (append-only), Media Library (reference-safe), Users & Roles,
   Permissions matrix, Backups & Restore, Notifications.
   ===================================================================== */
(function () {
  "use strict";
  var A = window.CMSA, h = A.h, t = A.t, db = A.db, U = A.U;

  /* ==================================================================== */
  /* AUDIT LOGS (full list with filters; the dashboard shows a summary)   */
  /* ==================================================================== */
  A.register("audit", { group: "system", icon: "⏱", title: "ucms.nav.audit", render: function (view) {
    var PAGE = 25, offset = 0;
    var fAction = h("input", { type: "search", placeholder: t("ucms.activity.filterAction"), "aria-label": t("ucms.activity.filterAction"), style: { maxWidth: "180px" } });
    var fUser = h("input", { type: "search", placeholder: t("ucms.activity.filterUser"), "aria-label": t("ucms.activity.filterUser"), style: { maxWidth: "180px" } });
    var fResource = h("input", { type: "search", placeholder: t("ucms.activity.filterResource"), "aria-label": t("ucms.activity.filterResource"), style: { maxWidth: "180px" } });
    var fOutcome = h("select", null, [["", t("ucms.activity.allOutcomes")], ["success", "success"], ["error", "error"], ["denied", "denied"]].map(function (o) { return h("option", { value: o[0] }, o[1]); }));
    var fFrom = h("input", { type: "date", "aria-label": t("ucms.activity.from") });
    var fTo = h("input", { type: "date", "aria-label": t("ucms.activity.to") });
    var list = h("div", { class: "rows" });
    var more = h("button", { type: "button", class: "btn", on: { click: function () { offset += PAGE; load(true); } } }, t("ucms.activity.loadMore"));
    var summary = h("span", { class: "muted small" });
    view.appendChild(A.card(t("ucms.audit.title"), [
      h("div", { class: "toolbar", "data-nodirty": "1" }, fAction, fUser, fResource, fOutcome, fFrom, fTo, summary),
      list, h("div", { class: "card-foot" }, more)], { help: t("ucms.audit.sub") }));

    function filters() {
      var q = [];
      var a = fAction.value.trim(); if (a) q.push("action.ilike.*" + a.replace(/[%_,]/g, "") + "*");
      var u = fUser.value.trim(); if (u) q.push("actor_email.ilike.*" + u.replace(/[%_,]/g, "") + "*");
      var r = fResource.value.trim(); if (r) q.push("or(" + ["resource_label", "resource_type", "resource_id"].map(function (c) { return c + ".ilike.*" + r.replace(/[%_,]/g, "") + "*"; }).join(",") + ")");
      var o = fOutcome.value; if (o) q.push("outcome.eq." + o);
      var d1 = fFrom.value; if (d1) q.push("created_at.gte." + d1 + "T00:00:00Z");
      var d2 = fTo.value; if (d2) q.push("created_at.lte." + d2 + "T23:59:59Z");
      return q;
    }
    function load(append) {
      list.innerHTML = append ? "" : '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      more.hidden = true;
      var query = db.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
      var q = filters();
      if (q.length) query = query.or(q.join(","));
      return query.then(function (r) {
        if (r.error) throw r.error;
        var rows = r.data || [];
        if (!append) list.innerHTML = "";
        rows.forEach(function (e) {
          list.appendChild(A.row({ id: e.id, draggable: false,
            title: (e.resource_label || e.resource_type || "—") + " · " + e.action,
            sub: (e.actor_email || "—") + " · " + (e.actor_role || "") + " · " + A.fmtDateTime(e.created_at),
            badges: e.outcome === "success" ? A.badge("✓", "ok") : A.badge(e.outcome, e.outcome === "error" ? "off" : "gold"),
            actions: h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () {
              A.modal({ title: t("ucms.audit.detail"), size: "md", body: h("pre", { class: "code-block" }, JSON.stringify(e, null, 2)) });
            } } }, t("ucms.activity.meta")) }));
        });
        if (!append && !rows.length) list.appendChild(h("div", { class: "empty" }, t("ucms.activity.empty")));
        more.hidden = rows.length < PAGE;
        summary.textContent = total(r.count);
        function total(c) { return c != null ? (offset + rows.length) + " / " + c : ""; }
      }).catch(A.fail);
    }
    [fAction, fUser, fResource].forEach(function (el) { el.addEventListener("input", function () { offset = 0; load(); }); });
    [fOutcome, fFrom, fTo].forEach(function (el) { el.addEventListener("change", function () { offset = 0; load(); }); });
    return load();
  } });

  /* ==================================================================== */
  /* MEDIA LIBRARY — usage-safe                                           */
  /* ==================================================================== */
  A.register("media", { group: "media", icon: "▣", title: "nav.media", render: function (view) {
    var grid = h("div", { class: "media-grid" });
    var filter = "all", sortBy = "date", q = "";
    var files = [];
    var refs = [];            /* [{table, column, id, text}] from successful scans */
    var refFailures = 0;      /* number of failed reference checks */
    var search = h("input", { type: "search", class: "search", placeholder: t("ucms.media.search") });
    var filt = h("div", { class: "toolbar", "data-nodirty": "1" },
      ["all", "inUse", "unused"].map(function (k) {
        return h("button", { type: "button", class: "chip" + (k === "all" ? " on" : ""), "data-f": k, on: { click: function (e) { filter = k; A.$$("[data-f]", filt).forEach(function (b) { b.classList.toggle("on", b === e.currentTarget); }); render(); } } }, t(k === "all" ? "md.all" : "md." + k));
      }),
      h("select", { "aria-label": t("ucms.media.sortDate") }, [["date", t("ucms.media.sortDate")], ["name", t("ucms.media.sortName")], ["size", t("ucms.media.sortSize")]].map(function (o) { return h("option", { value: o[0] }, o[1]); })),
      search);
    var sortSel = filt.querySelector("select");
    sortSel.addEventListener("change", function () { sortBy = sortSel.value; render(); });
    search.addEventListener("input", function () { q = search.value.trim().toLowerCase(); render(); });
    var counts = h("span", { class: "muted small" });
    var up = A.fImage(t("btn.upload"), "", { folder: "library", onChange: function () { load(); } });
    up.setAttribute("data-nodirty", "1");
    view.appendChild(A.card(t("btn.upload"), up));
    view.appendChild(A.card(t("md.title"), [h("div", { class: "toolbar", "data-nodirty": "1" }, filt, counts), grid], { help: t("ucms.media.docsNote") }));

    function listAll(prefix, depth) {
      /* paginated folder walk (storage list caps at 1000 per call) */
      function page(pfx, offset) {
        return db.storage.from("site-media").list(pfx, { limit: 1000, offset: offset, sortBy: { column: "created_at", order: "desc" } }).then(function (r) {
          if (r.error) throw r.error;
          return r.data || [];
        });
      }
      function walk(pfx, offset, depth2, acc) {
        return page(pfx, offset).then(function (data) {
          var jobs = [];
          (data || []).forEach(function (o) {
            var path = pfx ? pfx + "/" + o.name : o.name;
            if (!o.id && depth2 < 5) jobs.push(walk(path, 0, depth2 + 1, acc));
            else if (o.id) acc.push({ path: path, name: o.name, size: o.metadata && o.metadata.size, created: o.created_at });
          });
          if ((data || []).length === 1000 && depth2 >= 0) return walk(pfx, offset + 1000, depth2, acc);
          return Promise.all(jobs).then(function () { return acc; });
        });
      }
      return walk(prefix, 0, depth, []);
    }

    /* Reference sources: (table, column, isJson) — column values are scanned
       for the storage path or its public URL. All checks run with
       Promise.allSettled semantics: failures make usage UNKNOWN, never "unused". */
    var REF_TABLES = [
      ["team_members", "photo_url", false, "team"],
      ["team_groups", "image_url", false, "team"],
      ["sponsors", "logo_url", false, "sponsors"],
      ["applications", "image_url", false, "applications"],
      ["committees", "image_url", false, "committees"],
      ["builder_project_assets", "asset_url", false, "media"],
      ["builder_project_heroes", "background_url", false, "visual-editor"],
      ["builder_project_integrations", "source_path", false, "gdf27-qa"],
      ["page_sections", "settings", true, "home"],
      ["site_settings", "value", true, "settings"],
      ["site_texts", "value", true, "texts"],
      ["builder_editor_documents", "html", true, "visual-editor"],
      ["builder_editor_documents", "css", true, "visual-editor"],
      ["builder_project_components", "html", true, "components"],
      ["builder_project_custom_code", "html", true, "code-archives"]
    ];
    function loadUsage() {
      refs = []; refFailures = 0;
      return Promise.all(REF_TABLES.map(function (rt) {
        return db.from(rt[0]).select((rt[2] ? "id," + rt[1] : "id," + rt[1]))
          .then(function (r) {
            if (r.error) { refFailures++; return; }
            (r.data || []).forEach(function (row) {
              var text = rt[2] ? JSON.stringify(row[rt[1]] || {}) : String(row[rt[1]] || "");
              if (!text) return;
              refs.push({ table: rt[0], column: rt[1], id: row.id, text: text, page: rt[3] });
            });
          }).catch(function () { refFailures++; });
      })).then(function () { return null; });
    }
    function fileRefs(f) {
      var url = A.publicUrl(f.path);
      var enc = encodeURI(f.path);
      return refs.filter(function (r) {
        return r.text.indexOf(f.path) >= 0 || r.text.indexOf(url) >= 0 || (enc !== f.path && r.text.indexOf(enc) >= 0);
      });
    }
    function usageState(f) {
      if (refFailures > 0) return "unknown";
      return fileRefs(f).length ? "used" : "unused";
    }

    function render() {
      grid.innerHTML = "";
      var shown = files.filter(function (f) { return (!q || f.name.toLowerCase().indexOf(q) >= 0 || f.path.toLowerCase().indexOf(q) >= 0) && (filter === "all" || (filter === "inUse") === (usageState(f) === "used")); });
      shown.sort(function (a, b) {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "size") return (b.size || 0) - (a.size || 0);
        return new Date(b.created || 0) - new Date(a.created || 0);
      });
      counts.textContent = shown.length + " " + t("ucms.media.count") + (refFailures ? " · " + refFailures + " " + t("ucms.media.refsFailed") : "");
      if (!shown.length) { grid.appendChild(h("div", { class: "empty", style: { gridColumn: "1/-1" } }, t("md.empty"))); return; }
      shown.forEach(function (f) {
        var url = A.publicUrl(f.path), st = usageState(f);
        var badgeEl = st === "unknown" ? A.badge(t("ucms.media.unknown"), "gold")
          : st === "used" ? A.badge(t("md.inUse"), "ok") : A.badge(t("ucms.media.unused"), "");
        grid.appendChild(h("div", { class: "media-item" },
          h("div", { class: "mi-img" }, h("img", { src: url, alt: "", loading: "lazy" })),
          h("div", { class: "mi-body" },
            h("div", { class: "mi-name", title: f.path }, f.name),
            h("div", null, (f.size ? Math.round(f.size / 1024) + " KB " : ""), badgeEl),
            h("div", { class: "mi-actions" },
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () { showUsage(f); } } }, t("ucms.media.usage")),
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () { renameFile(f); } } }, t("ucms.media.rename")),
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () { copyUrl(url); } } }, t("btn.copy")),
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () { replaceFile(f); } } }, t("ucms.media.replace")),
              h("button", { type: "button", class: "btn btn-sm btn-danger", on: { click: function () { deleteFile(f); } } }, t("btn.delete"))))));
      });
    }
    function copyUrl(url) {
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(function () { A.toast(t("msg.copied"), "ok"); }, function () { window.prompt("URL", url); });
    }
    function showUsage(f) {
      var list = h("div", { class: "rows" });
      var st = usageState(f);
      if (st === "unknown") list.appendChild(h("p", { class: "muted" }, t("ucms.media.unknownHelp")));
      var fr = fileRefs(f);
      if (fr.length) {
        fr.forEach(function (r) {
          list.appendChild(A.row({ id: r.table + ":" + r.id, draggable: false,
            title: r.table + " · " + r.column,
            sub: "id: " + r.id,
            actions: h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { if (A.pages[r.page]) A.go(r.page); } } }, t("btn.edit")) }));
        });
      } else if (st !== "unknown") {
        list.appendChild(h("p", { class: "muted" }, t("ucms.media.noRefs")));
      }
      A.modal({ title: t("ucms.media.usedIn") + " · " + f.name, body: list, size: "md" });
    }
    /* rewrite every reference of an old URL to a new one (replace/rename flows) */
    function rewriteRefs(oldPath, newPath, progress) {
      var oldUrl = A.publicUrl(oldPath), newUrl = A.publicUrl(newPath);
      var changed = 0;
      var targets = refs.filter(function (r) { return r.text.indexOf(oldPath) >= 0 || r.text.indexOf(oldUrl) >= 0; });
      return targets.reduce(function (p, r) {
        return p.then(function () {
          return db.from(r.table).select("id," + r.column).eq("id", r.id).then(function (res) {
            if (res.error || !res.data || !res.data.length) return;
            var row = res.data[0];
            var text = r.text;
            var next = text.split(oldUrl).join(newUrl).split(encodeURI(oldPath)).join(encodeURI(newPath)).split(oldPath).join(newPath);
            if (next === text) return;
            var patch = {};
            if (REF_TABLES.filter(function (x) { return x[0] === r.table && x[1] === r.column; })[0] && REF_TABLES.filter(function (x) { return x[0] === r.table && x[1] === r.column; })[0][2]) {
              /* JSONB column: parse -> replace -> store */
              var val = row[r.column];
              var str = JSON.stringify(val).split(oldUrl).join(newUrl).split(oldPath).join(newPath);
              patch[r.column] = JSON.parse(str);
            } else {
              patch[r.column] = next;
            }
            return db.from(r.table).update(patch).eq("id", r.id).then(function (w) {
              if (!w.error) { changed++; if (progress) progress(changed); }
            });
          });
        });
      }, Promise.resolve()).then(function () { return changed; });
    }
    function renameFile(f) {
      var name = h("input", { type: "text", value: f.name, class: "code-input", "aria-label": t("ucms.media.newName") });
      var note = h("p", { class: "muted small" }, usageState(f) === "unknown" ? t("ucms.media.unknownHelp") : (fileRefs(f).length ? fileRefs(f).length + " " + t("ucms.media.refsFailed") : t("ucms.media.noRefs")));
      A.modal({ title: t("ucms.media.rename") + " · " + f.name, size: "sm", body: h("div", { class: "grid" }, h("label", { class: "field" }, h("span", null, t("ucms.media.newName")), name), note), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("ucms.media.rename"), cls: "btn-gold", onClick: function (m, btn) {
          var newName = name.value.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
          if (!newName || newName === f.name) { m.close(); return; }
          if (!/\.(jpe?g|png|webp)$/i.test(newName)) newName += (f.name.match(/\.[a-z0-9]+$/i) || [""])[0];
          var dir = f.path.split("/").slice(0, -1).join("/");
          var newPath = (dir ? dir + "/" : "") + newName;
          A.busy(btn, true);
          db.storage.from("site-media").move(f.path, newPath).then(function (r) {
            if (r.error) throw r.error;
            return rewriteRefs(f.path, newPath);
          }).then(function () {
            U.audit("media.rename", "storage", newPath, f.name + " → " + newName, {});
            A.busy(btn, false); m.close(); A.toast(t("ucms.media.renamed"), "ok"); load();
          }).catch(function (e) { A.busy(btn, false); A.fail(e); });
        } }] });
    }
    function replaceFile(f) {
      var file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
      var pick = h("button", { type: "button", class: "btn btn-gold", on: { click: function () { file.click(); } } }, t("btn.upload"));
      A.modal({ title: t("ucms.media.replace") + " · " + f.name, size: "sm", body: h("div", { class: "grid" }, pick, file,
        h("p", { class: "muted small" }, t("ucms.media.replaced"))), actions: [
        { label: t("btn.cancel"), cls: "btn-ghost", onClick: function (m) { m.close(); } },
        { label: t("btn.close"), cls: "btn-ghost", onClick: function (m) { m.close(); } }] });
      file.addEventListener("change", function () {
        var nf = file.files[0]; if (!nf) return;
        A.upload(nf, f.path.split("/").slice(0, -1).join("/") || "library").then(function (r) {
          return rewriteRefs(f.path, r.path).then(function () { return r; });
        }).then(function (r) {
          U.audit("media.replace", "storage", r.path, f.name + " → " + nf.name, {});
          A.toast(t("ucms.media.replaced"), "ok");
          return db.storage.from("site-media").remove([f.path]).catch(function () { /* old file may be gone already */ });
        }).then(load).catch(function (e) { A.fail(e); });
        document.querySelectorAll(".modal-backdrop").forEach(function (m) { m.remove(); });
      });
    }
    function deleteFile(f) {
      var st = usageState(f);
      if (st === "unknown") { A.toast(t("ucms.media.deleteBlocked") + " (" + t("ucms.media.unknownHelp") + ")", "error"); return; }
      var fr = fileRefs(f);
      if (fr.length) { A.toast(t("ucms.media.deleteBlocked"), "error"); showUsage(f); return; }
      A.confirm(t("msg.confirmDelete"), t("btn.delete"), true).then(function (ok) {
        if (!ok) return;
        db.storage.from("site-media").remove([f.path]).then(function (r) {
          if (r.error) return A.fail(r.error);
          U.audit("media.delete", "storage", f.path, f.name, {});
          A.toast(t("msg.deleted"), "ok"); load();
        });
      });
    }
    function load() {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="spinner sm"></span></div>';
      return Promise.all([listAll("", 0), loadUsage()]).then(function (r) { files = r[0]; render(); }).catch(A.fail);
    }
    return load();
  } });

  /* ==================================================================== */
  /* USERS & ROLES                                                        */
  /* ==================================================================== */
  A.register("users", { group: "system", icon: "☰", title: "ucms.nav.users", render: function (view) {
    var list = h("div", { class: "rows" });
    view.appendChild(A.card(t("ucms.users.title"), [list], { help: t("ucms.users.sub") }));
    function load() {
      list.innerHTML = '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      return Promise.all([
        db.from("admin_users").select("*").order("created_at"),
        db.from("audit_logs").select("actor_id,actor_email,action,created_at").order("created_at", { ascending: false }).limit(300)
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        var rows = r[0].data || [];
        var lastAct = {};
        (r[1].data || []).forEach(function (e) { if (e.actor_id && !lastAct[e.actor_id]) lastAct[e.actor_id] = e.action + " · " + A.fmtDateTime(e.created_at); });
        list.innerHTML = "";
        if (!A.can.users && !view.querySelector(".banner")) view.insertBefore(h("div", { class: "banner" }, t("ucms.users.adminOnly")), view.firstChild);
        rows.forEach(function (u) {
          var isSelf = A.user && u.user_id === A.user.id;
          var roleSel = h("select", { "aria-label": t("ucms.users.role"), disabled: !A.can.users || isSelf },
            [["super_admin", t("role.super_admin")], ["admin", t("role.admin")], ["publisher", t("role.publisher")], ["editor", t("role.editor")]].map(function (o) { return h("option", { value: o[0] }, o[1]); }));
          roleSel.value = u.role;
          roleSel.addEventListener("change", function () { changeRole(u, roleSel.value, roleSel); });
          list.appendChild(A.row({ id: u.user_id, draggable: false,
            title: (u.user_id === (A.user && A.user.id) ? "★ " : "") + u.user_id.slice(0, 8) + "… " + t("role." + u.role),
            sub: t("ucms.users.created") + ": " + A.fmtDate(u.created_at) + " · " + t("ucms.users.lastLogin") + ": " + t("ucms.users.notAvailable")
              + " · " + t("ucms.users.lastAction") + ": " + (lastAct[u.user_id] || t("ucms.users.noLastAction")),
            actions: h("div", { class: "r-actions" }, roleSel,
              h("button", { type: "button", class: "btn btn-sm btn-danger", disabled: !A.can.users || isSelf, on: { click: function () { revoke(u); } } }, t("ucms.users.revoke"))) }));
        });
        if (!rows.length) list.appendChild(h("div", { class: "empty" }, t("msg.empty")));
        if (A.can.users) {
          view.appendChild(A.card(t("ucms.users.invite"), inviteCard(), { help: t("ucms.users.inviteHelp") }));
        }
      }).catch(A.fail);
    }
    function inviteCard() {
      var sql = "insert into public.admin_users (user_id, role)\nselect id, 'editor' from auth.users where email = 'USER@EXAMPLE.COM'\non conflict (user_id) do update set role = excluded.role;";
      var code = h("pre", { class: "code-block" }, sql);
      var copy = h("button", { type: "button", class: "btn btn-sm", on: { click: function () {
        (navigator.clipboard ? navigator.clipboard.writeText(sql) : Promise.reject())
          .then(function () { A.toast(t("msg.copied"), "ok"); }, function () { window.prompt("", sql); });
      } } }, t("btn.copy"));
      return h("div", null,
        h("p", null, t("ucms.users.inviteStep1")),
        h("p", null, t("ucms.users.inviteStep2")),
        code, copy);
    }
    function changeRole(u, role, selEl) {
      if (u.user_id === (A.user && A.user.id)) { A.toast(t("ucms.users.selfRole"), "error"); if (selEl) selEl.value = u.role; return; }
      A.confirm(t("ucms.users.changeRole") + ": " + u.role + " → " + role + "?", t("btn.confirm"), false).then(function (ok) {
        if (!ok) { if (selEl) selEl.value = u.role; return; }
        db.from("admin_users").update({ role: role }).eq("user_id", u.user_id).then(function (r) {
          if (r.error) { A.fail(r.error); if (selEl) selEl.value = u.role; return; }
          U.audit("users.role_change", "admin_users", u.user_id, u.user_id.slice(0, 8), { from: u.role, to: role });
          A.notify("warning", t("ucms.users.changeRole"), u.user_id.slice(0, 8) + "… " + u.role + " → " + role, "users");
          A.toast(t("msg.saved"), "ok"); load();
        });
      });
    }
    function revoke(u) {
      if (u.user_id === (A.user && A.user.id)) { A.toast(t("ucms.users.selfRevoke"), "error"); return; }
      A.confirm(t("ucms.users.revokeConfirm"), t("ucms.users.revoke"), true).then(function (ok) {
        if (!ok) return;
        db.from("admin_users").delete().eq("user_id", u.user_id).then(function (r) {
          if (r.error) return A.fail(r.error);
          U.audit("users.revoke", "admin_users", u.user_id, u.user_id.slice(0, 8), { former_role: u.role });
          A.notify("warning", t("ucms.users.revoke"), u.user_id.slice(0, 8) + "… (" + u.role + ")", "users");
          A.toast(t("msg.deleted"), "ok"); load();
        });
      });
    }
    return load();
  } });

  /* ==================================================================== */
  /* PERMISSIONS (documented matrix; enforced by RLS / RPC checks)         */
  /* ==================================================================== */
  A.register("permissions", { group: "system", icon: "⛨", title: "ucms.nav.permissions", render: function (view) {
    var ROLES = ["super_admin", "admin", "publisher", "editor"];
    var CAPS = [
      ["ucms.perms.capContent", [1, 1, 1, 1], "ucms.perms.rls"],
      ["ucms.perms.capMedia", [1, 1, 1, 1], "ucms.perms.rls"],
      ["ucms.perms.capDesign", [1, 1, 0, 0], "ucms.perms.rls"],
      ["ucms.perms.capPublish", [1, 1, 1, 0], "ucms.perms.rpc"],
      ["ucms.perms.capBuilder", [1, 1, 1, 1], "ucms.perms.rls"],
      ["ucms.perms.capUsers", [1, 1, 0, 0], "ucms.perms.rls"],
      ["ucms.perms.capBackups", [1, 1, 0, 0], "ucms.perms.rpc"],
      ["ucms.perms.capAudit", [1, 1, 1, 1], "ucms.perms.rls"]
    ];
    var tbl = h("table", { class: "perm-table" },
      h("thead", null, h("tr", null, h("th", null, t("ucms.perms.cap")),
        ROLES.map(function (r) { return h("th", null, t("role." + r)); }),
        h("th", null, t("ucms.perms.enforcedBy")))),
      h("tbody", null, CAPS.map(function (c) {
        return h("tr", null, h("td", null, t(c[0])),
          c[1].map(function (v) { return h("td", { class: v ? "yes" : "no" }, v ? "✓" : "—"); }),
          h("td", { class: "muted" }, t(c[2])));
      })));
    view.appendChild(A.card(t("ucms.perms.title"), [h("div", { class: "table-scroll" }, tbl)], { help: t("ucms.perms.sub") }));
    view.appendChild(h("p", { class: "muted small" }, t("ucms.pages.publishNote")));
    return Promise.resolve();
  } });

  /* ==================================================================== */
  /* BACKUPS & RESTORE                                                    */
  /* ==================================================================== */
  A.register("backups", { group: "system", icon: "🖫", title: "ucms.nav.backups", render: function (view) {
    var list = h("div", { class: "rows" });
    var labelInput = h("input", { type: "text", placeholder: t("ucms.backups.labelPh"), "aria-label": t("ucms.backups.label"), maxlength: 120, style: { maxWidth: "260px" } });
    var createBtn = h("button", { type: "button", class: "btn btn-gold", on: { click: create } }, t("ucms.backups.create"));
    view.appendChild(A.card(t("ucms.backups.title"), [
      h("div", { class: "toolbar", "data-nodirty": "1" }, labelInput, createBtn),
      list], { help: t("ucms.backups.sub") }));

    function load() {
      list.innerHTML = '<div class="empty"><span class="spinner sm"></span> ' + A.esc(t("msg.loading")) + "</div>";
      return db.from("cms_backups").select("*").order("created_at", { ascending: false }).then(function (r) {
        if (r.error) { list.innerHTML = ""; list.appendChild(h("div", { class: "empty" }, r.error.message)); return; }
        list.innerHTML = "";
        (r.data || []).forEach(function (b) {
          var stats = Object.keys(b.stats || {}).length ? Object.keys(b.stats).map(function (k) { return k + ": " + b.stats[k]; }).join(" · ") : "";
          list.appendChild(A.row({ id: b.id, draggable: false,
            title: (b.kind === "pre_restore" ? "⟲ " : "") + b.label,
            sub: t("ucms.backups.createdBy") + ": " + A.fmtDateTime(b.created_at) + (stats ? " · " + stats : ""),
            badges: b.kind === "pre_restore" ? A.badge("safety", "gold") : null,
            actions: h("div", { class: "r-actions" },
              h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: function () { download(b); } } }, t("ucms.backups.download")),
              h("button", { type: "button", class: "btn btn-sm", on: { click: function () { restore(b); } } }, t("ucms.backups.restore"))) }));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("ucms.backups.empty")));
      });
    }
    function create() {
      if (!A.can.backups) { A.toast(t("ucms.users.adminOnly"), "error"); return; }
      createBtn.disabled = true;
      db.rpc("create_cms_backup", { p_label: labelInput.value.trim() || null }).then(function (r) {
        createBtn.disabled = false;
        if (r.error) { A.fail(r.error); A.notify("error", t("ucms.backups.failed"), r.error.message, "backups"); return; }
        U.audit("backup.create", "cms_backups", r.data, labelInput.value || "Backup", {});
        A.toast(t("ucms.backups.created"), "ok");
        load();
      }).catch(function (e) { createBtn.disabled = false; A.fail(e); });
    }
    function download(b) {
      var url = URL.createObjectURL(new Blob([JSON.stringify(b.manifest, null, 2)], { type: "application/json" }));
      var a = h("a", { href: url, download: "gdf27-backup-" + b.id.slice(0, 8) + ".json" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }
    /* restore order respects dependencies (settings -> texts -> sections -> lists -> team -> builder) */
    var RESTORE_ORDER = [
      ["site_settings", "key"], ["site_texts", "key"], ["page_sections", "id"],
      ["committees", "id"], ["faqs", "id"], ["sponsors", "id"], ["applications", "id"],
      ["team_tabs", "id"], ["team_members", "id"], ["team_groups", "id"], ["team_placements", "id"],
      ["builder_projects", "id"], ["builder_project_pages", "id"], ["builder_project_navigation", "id"],
      ["builder_editor_documents", "id"], ["builder_project_components", "id"],
      ["builder_project_custom_code", "id"], ["builder_project_heroes", "id"],
      ["builder_project_responsive", "id"]
    ];
    function restore(b) {
      if (!A.can.backups) { A.toast(t("ucms.users.adminOnly"), "error"); return; }
      A.confirm(t("ucms.backups.confirmRestore"), t("ucms.confirm.restore"), true).then(function (ok) {
        if (!ok) return;
        var steps = h("div", { class: "rows" });
        var dlg = A.modal({ title: t("ucms.backups.restore"), size: "md", body: steps, actions: [] });
        function step(text) { steps.appendChild(h("div", { class: "check", role: "status" }, h("i"), text)); }
        db.rpc("create_cms_backup", { p_label: t("ucms.backups.checkpoint") }).then(function (cp) {
          if (cp.error) throw cp.error;
          step("🔒 " + t("ucms.backups.checkpoint") + " (" + cp.data.slice(0, 8) + "…)");
          var manifest = b.manifest || {};
          return RESTORE_ORDER.reduce(function (p, entry) {
            return p.then(function () {
              var rows = manifest[entry[0]] || [];
              if (!rows.length) return;
              return db.from(entry[0]).upsert(rows, { onConflict: entry[1] }).then(function (r) {
                if (r.error) throw r.error;
                step("✓ " + entry[0] + " (" + rows.length + ")");
              });
            });
          }, Promise.resolve());
        }).then(function () {
          U.audit("backup.restore", "cms_backups", b.id, b.label, { checkpoint: true });
          A.notify("warning", t("ucms.backups.restored"), b.label, "backups");
          dlg.close();
          A.toast(t("ucms.backups.restored"), "ok");
          A.loadCore().then(function () { A.go("backups", true); });
        }).catch(function (e) {
          U.audit("backup.restore", "cms_backups", b.id, b.label, { error: e.message }, "error");
          A.fail(e); dlg.close();
        });
      });
    }
    return load();
  } });

  /* ==================================================================== */
  /* NOTIFICATIONS page                                                   */
  /* ==================================================================== */
  A.register("notifications", { group: "system", icon: "🔔", title: "ucms.nav.notifications", render: function (view) {
    var list = h("div", { class: "rows" });
    view.appendChild(A.card(t("ucms.notif.title"), [
      h("div", { class: "toolbar", "data-nodirty": "1" }, h("button", { type: "button", class: "btn", on: { click: function () {
        db.from("cms_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("is_read", false)
          .then(function (r) { if (r.error) return A.fail(r.error); load(); });
      } } }, t("ucms.notif.markAll"))),
      list]));
    function load() {
      return db.from("cms_notifications").select("*").order("created_at", { ascending: false }).limit(100).then(function (r) {
        if (r.error) { list.innerHTML = ""; list.appendChild(h("div", { class: "empty" }, r.error.message)); return; }
        list.innerHTML = "";
        (r.data || []).forEach(function (n) {
          list.appendChild(A.row({ id: n.id, draggable: false,
            title: n.title, sub: (n.body || "") + " · " + A.fmtDateTime(n.created_at),
            badges: n.is_read ? null : A.badge(t("ucms.notif.unread"), "gold"),
            actions: h("span", { class: "sev sev-" + n.severity, "aria-hidden": "true" }) }));
        });
        if (!(r.data || []).length) list.appendChild(h("div", { class: "empty" }, t("ucms.notif.empty")));
      }).catch(A.fail);
    }
    return load();
  } });
})();
