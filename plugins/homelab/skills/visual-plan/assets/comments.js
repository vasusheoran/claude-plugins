/* visual-plan — interactive review widget (vanilla JS, no deps).
 *
 * Backed by serve.py's review API; persists to comments.json / answers.json /
 * approval.json next to the plan. The agent reads those files to revise — the
 * local analog of the hosted get-plan-feedback loop. Copied verbatim per plan;
 * never hand-edited (fix this shared asset instead).
 *
 * Features: block / text-selection / pinned comments with threaded replies,
 * resolve & reopen, inline question blocks (single/multi/freeform), an
 * approve / request-changes gate, and live auto-refresh.
 *
 * file:// fallback: when opened without a server, everything is kept in
 * localStorage and an "Export feedback" button copies a JSON blob to paste back.
 */
(function () {
  "use strict";

  var hasServer = location.protocol.startsWith("http");
  var LS = "visual-plan::" + location.pathname;
  var state = { comments: [], answers: [], approval: { state: null, note: "" }, ack: {} };
  var version = {};

  /* ----------------------------- storage ----------------------------- */

  function lsLoad() {
    try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; }
  }
  function lsSave() { localStorage.setItem(LS, JSON.stringify(state)); }

  function jget(url) { return fetch(url).then(function (r) { return r.json(); }); }
  function jpost(url, body) {
    return fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function loadAll() {
    if (!hasServer) {
      var saved = lsLoad();
      if (saved) state = saved;
      return Promise.resolve();
    }
    return Promise.all([
      jget("/api/comments").then(function (d) { state.comments = d.comments || []; }),
      jget("/api/answers").then(function (d) { state.answers = d.answers || []; }),
      jget("/api/approval").then(function (d) { state.approval = d; }),
      jget("/api/ack").then(function (d) { state.ack = d || {}; }),
      jget("/api/version").then(function (d) { version = d; }),
    ]);
  }

  function addComment(fields) {
    if (hasServer) {
      return jpost("/api/comments", fields).then(function (c) { state.comments.push(c); return c; });
    }
    var c = Object.assign({
      id: "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      parentId: null, status: "open", target: "agent", author: "human",
      anchor: null, quote: null, createdAt: new Date().toISOString(),
    }, fields);
    state.comments.push(c); lsSave(); return Promise.resolve(c);
  }

  function setStatus(id, action) {
    if (hasServer) return jpost("/api/comments/" + id + "/" + action);
    var c = byId(id); if (c) c.status = action === "resolve" ? "resolved" : "open";
    lsSave(); return Promise.resolve();
  }

  function upsertAnswer(fields) {
    if (hasServer) {
      return jpost("/api/answers", fields).then(function (a) { mergeAnswer(a); return a; });
    }
    var a = Object.assign({ answeredAt: new Date().toISOString() }, fields);
    mergeAnswer(a); lsSave(); return Promise.resolve(a);
  }
  function mergeAnswer(a) {
    state.answers = state.answers.filter(function (x) { return x.questionId !== a.questionId; });
    state.answers.push(a);
  }

  function setApproval(approvalState, note) {
    if (hasServer) {
      return jpost("/api/approval", { state: approvalState, note: note })
        .then(function (d) { state.approval = d; });
    }
    state.approval = { state: approvalState, note: note, decidedAt: new Date().toISOString() };
    lsSave(); return Promise.resolve();
  }

  /* ----------------------------- helpers ----------------------------- */

  function byId(id) { return state.comments.filter(function (c) { return c.id === id; })[0]; }
  function blockEl(id) { return document.querySelector('[data-block-id="' + id + '"]'); }
  function openCount() {
    return state.comments.filter(function (c) { return c.status !== "resolved"; }).length;
  }
  function repliesOf(id) {
    return state.comments.filter(function (c) { return c.parentId === id; });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* --------------------- element picker ("mark" mode) ---------------- */

  // The "mark" toggle turns the cursor into an element picker (like the browser
  // inspector): hovering highlights the element under the cursor and a click
  // anchors a comment to that exact element. Any element is pickable — a tagged
  // [data-cmt-id] simply yields a cleaner, more stable anchor.
  var pickMode = false;
  var pickOverlay = null;

  function setPickMode(on) {
    pickMode = on;
    document.body.classList.toggle("cmt-pick", on);
    if (!on && pickOverlay) pickOverlay.style.display = "none";
    renderNav();
  }

  function isOwnUi(el) {
    return !el || !el.closest || !!el.closest(
      "#cmt-nav, .cmt-composer, .cmt-panel, .cmt-pin, #cmt-pick-overlay");
  }

  function ensureOverlay() {
    if (!pickOverlay) {
      pickOverlay = document.createElement("div");
      pickOverlay.id = "cmt-pick-overlay";
      pickOverlay.style.display = "none";
      document.body.appendChild(pickOverlay);
    }
    return pickOverlay;
  }

  // Snap to the nearest tagged component (data-cmt-id) so its comments get a
  // stable anchor; otherwise the exact element under the cursor.
  function pickTarget(el) {
    return (el && el.closest && el.closest("[data-cmt-id]")) || el;
  }

  document.addEventListener("mousemove", function (e) {
    if (!pickMode) return;
    if (isOwnUi(e.target)) { if (pickOverlay) pickOverlay.style.display = "none"; return; }
    var r = pickTarget(e.target).getBoundingClientRect();
    var o = ensureOverlay();
    o.style.display = "block";
    o.style.left = r.left + "px"; o.style.top = r.top + "px";
    o.style.width = r.width + "px"; o.style.height = r.height + "px";
  }, true);

  document.addEventListener("click", function (e) {
    if (!pickMode || e.altKey || isOwnUi(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    openComposer(pickTarget(e.target), null, true);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && pickMode) setPickMode(false);
  });

  // A querySelector-able path for an arbitrary element, scoped to its nearest
  // block. Prefers a stable id / data-cmt-id so anchors survive plan edits.
  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");
  }
  function cssPath(el) {
    if (el.id) return "#" + cssEsc(el.id);
    if (el.hasAttribute("data-cmt-id"))
      return '[data-cmt-id="' + el.getAttribute("data-cmt-id") + '"]';
    var parts = [];
    while (el && el.nodeType === 1 && el.tagName !== "BODY") {
      if (el.hasAttribute("data-block-id")) {
        parts.unshift('[data-block-id="' + el.getAttribute("data-block-id") + '"]');
        break;
      }
      var sel = el.tagName.toLowerCase();
      var parent = el.parentElement;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === el.tagName;
        });
        if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(el) + 1) + ")";
      }
      parts.unshift(sel);
      el = parent;
    }
    return parts.join(" > ");
  }
  function resolveComponent(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function renderTargets() {                      // outline elements that HAVE comments
    document.querySelectorAll(".cmt-target").forEach(function (el) {
      el.classList.remove("cmt-target");
    });
    state.comments.forEach(function (c) {
      if (!c.componentId || c.parentId != null) return;
      var el = resolveComponent(c.componentId);
      if (el) el.classList.toggle("cmt-target", c.status !== "resolved");
    });
  }

  /* ------------------------ blocks, pins, quotes --------------------- */

  function decorateBlocks() {
    document.querySelectorAll("[data-block-id]").forEach(function (el) {
      el.classList.add("block");
      if (!el.querySelector(":scope > .comment-affordance")) {
        var btn = document.createElement("button");
        btn.className = "comment-affordance";
        btn.title = "Comment on this block (or Alt-click anywhere in it to pin a point)";
        btn.textContent = "💬";
        btn.addEventListener("click", function (e) { e.stopPropagation(); openComposer(el, null); });
        el.appendChild(btn);
      }
      var id = el.getAttribute("data-block-id");
      var has = state.comments.some(function (c) {
        return c.blockId === id && c.parentId == null && c.status !== "resolved";
      });
      el.classList.toggle("has-comments", has);
    });
    renderPins();
    highlightQuotes();
  }

  // Alt-click anywhere inside a block drops a pinned comment at that point.
  document.addEventListener("click", function (e) {
    if (!e.altKey) return;
    var el = e.target.closest("[data-block-id]");
    if (!el || e.target.closest(".cmt-composer, .comment-affordance, .cmt-pin")) return;
    e.preventDefault();
    var r = el.getBoundingClientRect();
    var anchor = {
      x: Math.round(((e.clientX - r.left) / r.width) * 100),
      y: Math.round(((e.clientY - r.top) / r.height) * 100),
    };
    openComposer(el, anchor);
  });

  function renderPins() {
    document.querySelectorAll(".cmt-pin").forEach(function (p) { p.remove(); });
    state.comments.forEach(function (c, i) {
      if (!c.anchor || c.parentId != null) return;
      var el = blockEl(c.blockId); if (!el) return;
      var pin = document.createElement("button");
      pin.className = "cmt-pin" + (c.status === "resolved" ? " resolved" : "");
      pin.style.left = c.anchor.x + "%";
      pin.style.top = c.anchor.y + "%";
      pin.textContent = String(i + 1);
      pin.title = c.body;
      pin.addEventListener("click", function (ev) {
        ev.stopPropagation(); openPanelAt(c.id);
      });
      el.appendChild(pin);
    });
  }

  // Best-effort: wrap a quoted selection in <mark> when it sits in one text node.
  function highlightQuotes() {
    state.comments.forEach(function (c) {
      if (!c.quote || c.anchor || c.parentId != null) return;
      var el = blockEl(c.blockId); if (!el || el.querySelector('mark[data-q="' + c.id + '"]')) return;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var idx = node.nodeValue.indexOf(c.quote);
        if (idx === -1) continue;
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + c.quote.length);
        var mark = document.createElement("mark");
        mark.setAttribute("data-q", c.id);
        mark.className = "cmt-quote" + (c.status === "resolved" ? " resolved" : "");
        try { range.surroundContents(mark); } catch (e) { /* spans nodes; skip */ }
        mark.addEventListener("click", function () { openPanelAt(c.id); });
        break;
      }
    });
  }

  /* ----------------------------- composer ---------------------------- */

  var activeComposer = null;

  // Drafts: unsubmitted text is kept (per anchor) in localStorage so clicking
  // away never loses it; it is restored when the same spot is reopened.
  function draftKey(i) {
    return "visual-plan-draft::" + location.pathname + "::" +
      (i.componentId ? "c:" + i.componentId
        : i.anchor ? "p:" + i.blockId + ":" + i.anchor.x + "," + i.anchor.y
        : i.quote ? "q:" + i.blockId + ":" + i.quote.slice(0, 40)
        : "b:" + i.blockId);
  }
  function loadDraft(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function saveDraft(k, v) {
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {}
  }

  // el is a [data-block-id] section, or any element when asComponent is true.
  function openComposer(el, anchor, asComponent) {
    closeComposer(true);                          // stash any in-progress draft
    var isComponent = !!asComponent && el && el.nodeType === 1 && el.tagName !== "BODY";
    var host = (el.closest && el.closest("[data-block-id]")) || el;
    var blockId = (host.getAttribute && host.getAttribute("data-block-id")) || "";
    var blockLabel = (host.getAttribute && host.getAttribute("data-block-label")) || blockId;
    var componentId = isComponent ? cssPath(el) : null;
    var componentLabel = isComponent
      ? (el.getAttribute("data-cmt-label")
         || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)
         || el.tagName.toLowerCase())
      : null;
    var quote = (!anchor && !isComponent)
      ? String(window.getSelection ? window.getSelection() : "").trim() : null;

    var dkey = draftKey({ componentId: componentId, anchor: anchor, quote: quote, blockId: blockId });
    var ctx = componentLabel ? "◉ " + escapeHtml(componentLabel)
      : anchor ? "📍 pinned point"
      : quote ? "❝ " + escapeHtml(quote.slice(0, 200))
      : escapeHtml(blockLabel);

    var box = document.createElement("div");
    box.className = "cmt-composer";
    box.innerHTML =
      '<div class="quote">' + ctx + "</div>" +
      '<textarea placeholder="What should change here?"></textarea>' +
      '<div class="actions">' +
        '<button class="cmt-btn add">Add comment</button>' +
        '<button class="cmt-btn primary submit">Submit</button>' +
      "</div>";
    (host.appendChild ? host : document.body).appendChild(box);
    var ta = box.querySelector("textarea");
    ta.value = loadDraft(dkey); ta.focus();
    activeComposer = { box: box, ta: ta, dkey: dkey };

    function save(target) {
      var body = ta.value.trim(); if (!body) return;
      activeComposer = null; saveDraft(dkey, ""); box.remove();
      addComment({
        blockId: blockId, blockLabel: blockLabel,
        componentId: componentId, componentLabel: componentLabel,
        quote: quote || null, anchor: anchor || null,
        target: target, body: body,
      }).then(refreshAll);
    }
    box.querySelector(".add").addEventListener("click", function () { save("human"); });
    box.querySelector(".submit").addEventListener("click", function () { save("agent"); });
  }

  // Close the composer; with save=true, an unsubmitted body is kept as a draft.
  function closeComposer(save) {
    if (!activeComposer) {
      var stray = document.querySelector(".cmt-composer"); if (stray) stray.remove();
      return;
    }
    var ac = activeComposer; activeComposer = null;
    if (save) saveDraft(ac.dkey, ac.ta.value.trim());
    ac.box.remove();
  }

  // Clicking anywhere outside the composer closes it (keeping a draft).
  document.addEventListener("mousedown", function (e) {
    if (!activeComposer || activeComposer.box.contains(e.target)) return;
    closeComposer(true);
  }, true);

  /* -------------------------- question blocks ------------------------ */

  function answerFor(qid) {
    return state.answers.filter(function (a) { return a.questionId === qid; })[0];
  }

  function renderQuestions() {
    if (document.activeElement && document.activeElement.closest("[data-question-id] textarea")) return;
    document.querySelectorAll("[data-question-id]").forEach(function (el) {
      var qid = el.getAttribute("data-question-id");
      var mode = el.getAttribute("data-question-mode") || "single";
      var label = el.getAttribute("data-block-label") || qid;
      var saved = answerFor(qid);
      var host = el.querySelector(":scope > .qopts");
      if (!host) {
        host = document.createElement("div"); host.className = "qopts";
        el.appendChild(host);
      }
      el.classList.add("question");
      if (mode === "freeform") {
        if (!host.querySelector("textarea")) {
          host.innerHTML = '<textarea class="qfree" placeholder="Your answer / constraints…"></textarea>' +
            '<div><button class="cmt-btn primary qsave">Save answer</button> ' +
            '<span class="qstate"></span></div>';
          host.querySelector(".qsave").addEventListener("click", function () {
            var v = host.querySelector("textarea").value.trim();
            upsertAnswer({ questionId: qid, questionLabel: label, mode: mode, value: v })
              .then(function () { renderQuestions(); renderNav(); });
          });
        }
        if (saved && document.activeElement !== host.querySelector("textarea")) {
          host.querySelector("textarea").value = saved.value || "";
        }
      } else {
        var opts = el.querySelectorAll(":scope > .qopt, :scope .qopts > .qopt");
        opts.forEach(function (opt) {
          var val = opt.getAttribute("data-value");
          var selected = saved && (mode === "multi"
            ? (saved.value || []).indexOf(val) !== -1
            : saved.value === val);
          opt.classList.toggle("selected", !!selected);
          if (!opt._wired) {
            opt._wired = true;
            opt.addEventListener("click", function () {
              var cur = answerFor(qid);
              var value;
              if (mode === "multi") {
                value = (cur && cur.value) ? cur.value.slice() : [];
                var at = value.indexOf(val);
                if (at === -1) value.push(val); else value.splice(at, 1);
              } else { value = val; }
              upsertAnswer({ questionId: qid, questionLabel: label, mode: mode, value: value })
                .then(function () { renderQuestions(); renderNav(); });
            });
          }
        });
      }
      var st = el.querySelector(".qstate");
      if (st) st.textContent = saved ? "Answered ✓" : "";
    });
  }

  /* ----------------------------- panel ------------------------------- */

  function commentNode(c) {
    var resolved = c.status === "resolved";
    var replies = repliesOf(c.id);
    var isAgent = (c.target || "agent") === "agent";
    return '<div class="cmt-item ' + (resolved ? "resolved" : "") + '" data-cid="' + c.id + '">' +
      '<div class="where"><span class="cmt-status-dot"></span>' +
      escapeHtml(c.blockLabel || c.blockId) +
      (c.componentLabel ? " › " + escapeHtml(c.componentLabel) : "") +
      (c.componentId ? " · ◉" : c.anchor ? " · 📍" : c.quote ? " · ❝" : "") + "</div>" +
      (c.parentId == null
        ? '<span class="cmt-tag ' + (isAgent ? "agent" : "human") + '">' +
          (isAgent ? "→ Claude" : "note") + "</span>"
        : "") +
      (c.quote ? '<div class="meta">“' + escapeHtml(c.quote.slice(0, 120)) + "”</div>" : "") +
      "<div>" + escapeHtml(c.body) + "</div>" +
      '<div class="meta">' + escapeHtml((c.createdAt || "").slice(0, 16).replace("T", " ")) + "</div>" +
      replies.map(function (r) {
        return '<div class="cmt-reply">↳ ' + escapeHtml(r.body) + "</div>";
      }).join("") +
      '<div class="cmt-actions">' +
      '<button class="cmt-link reply">Reply</button>' +
      '<button class="cmt-link toggle">' + (resolved ? "Reopen" : "Resolve") + "</button>" +
      "</div></div>";
  }

  function renderPanel() {
    var p = document.getElementById("cmt-panel") || document.createElement("aside");
    p.id = "cmt-panel";
    p.className = "cmt-panel" + (p.classList.contains("open") ? " open" : "");
    var tops = state.comments.filter(function (c) { return c.parentId == null; });
    var items = tops.map(commentNode).join("") ||
      '<p style="padding:16px;color:#6b7280">No comments yet. Hover a section and click 💬, ' +
      'select text to quote it, Alt-click to pin a point, or click <b>mark</b> then any element.</p>';
    p.innerHTML =
      "<header><span>Review · " + openCount() + " open</span>" +
      '<button class="cmt-btn" id="cmt-close">Close</button></header>' +
      '<div class="list">' + items + "</div>" +
      (hasServer ? "" :
        '<div class="cmt-export-note">Offline (file://) — saved in this browser only. ' +
        '<button class="cmt-btn" id="cmt-export">Copy feedback JSON</button></div>');
    if (!p.parentNode) document.body.appendChild(p);
    p.querySelector("#cmt-close").onclick = function () { p.classList.remove("open"); };
    p.querySelectorAll(".cmt-item").forEach(function (it) {
      var cid = it.getAttribute("data-cid");
      it.querySelector(".toggle").onclick = function (e) {
        e.stopPropagation();
        var c = byId(cid);
        setStatus(cid, c.status === "resolved" ? "reopen" : "resolve").then(refreshAll);
      };
      it.querySelector(".reply").onclick = function (e) {
        e.stopPropagation(); openReply(it, cid);
      };
      it.onclick = function () {
        var c = byId(cid);
        var el = (c.componentId && resolveComponent(c.componentId)) || blockEl(c.blockId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
    var ex = p.querySelector("#cmt-export");
    if (ex) ex.onclick = function () {
      navigator.clipboard.writeText(JSON.stringify(state, null, 2));
      ex.textContent = "Copied!";
    };
  }

  function openReply(itemEl, parentId) {
    if (itemEl.querySelector(".cmt-replybox")) return;
    var box = document.createElement("div");
    box.className = "cmt-replybox";
    box.innerHTML = '<textarea placeholder="Reply…"></textarea>' +
      '<button class="cmt-btn primary send">Send</button>';
    itemEl.appendChild(box);
    var ta = box.querySelector("textarea"); ta.focus();
    box.querySelector(".send").onclick = function (e) {
      e.stopPropagation();
      var body = ta.value.trim(); if (!body) return;
      var parent = byId(parentId);
      addComment({ blockId: parent.blockId, blockLabel: parent.blockLabel,
        parentId: parentId, body: body }).then(refreshAll);
    };
  }

  function openPanelAt(cid) {
    var p = document.getElementById("cmt-panel"); if (p) p.classList.add("open");
    var it = p && p.querySelector('[data-cid="' + cid + '"]');
    if (it) it.scrollIntoView({ block: "center" });
  }

  /* --------------------------- approval gate ------------------------- */

  // Open top-level comments addressed to Claude — the implicit "change requests".
  function openAgentCount() {
    return state.comments.filter(function (c) {
      return c.parentId == null && c.status !== "resolved" &&
        (c.target || "agent") === "agent";
    }).length;
  }

  /* ------------------------------- top nav --------------------------- */

  function markIcon() {                            // small pin glyph for "mark"
    return '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
      '<path d="M8 1.4a4.2 4.2 0 0 0-4.2 4.2c0 3 4.2 8.8 4.2 8.8s4.2-5.8 4.2-8.8' +
      'A4.2 4.2 0 0 0 8 1.4Z" fill="currentColor"/>' +
      '<circle cx="8" cy="5.6" r="1.6" fill="#fff"/></svg>';
  }

  function renderNav() {
    // don't clobber the note field mid-typing
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("appr-note")) return;
    var nav = document.getElementById("cmt-nav") || document.createElement("div");
    nav.id = "cmt-nav"; nav.className = "cmt-nav";
    var appr = state.approval || {};
    var s = appr.state;
    var ack = state.ack || {};
    // the agent's ack counts only if it acknowledges THIS submission
    var acked = !!(ack.ackedAt && appr.decidedAt && ack.decidedAt === appr.decidedAt);
    var pending = openAgentCount();
    var statusHtml = s
      ? '<span class="appr-state ' + s + '">' +
        (s === "approved" ? "✓ Approved" : "✎ Changes requested") + "</span>"
      : '<span class="appr-state none">Not submitted</span>';
    var hint = !s
      ? (pending ? pending + " for Claude → changes requested" : "no open items → approved")
      : acked
        ? "✓ acknowledged by " + escapeHtml(ack.by || "Claude") +
          (ack.message ? " — " + escapeHtml(ack.message) : "")
        : "submitted · awaiting Claude…";
    nav.innerHTML =
      '<button class="cmt-nav-btn mark' + (pickMode ? " active" : "") + '" id="cmt-mark" ' +
        'title="mark" aria-label="mark">' + markIcon() + "</button>" +
      '<button class="cmt-nav-btn" id="cmt-comments">Comments ' +
        '<span class="count">' + openCount() + "</span></button>" +
      '<span class="cmt-nav-spacer"></span>' +
      statusHtml + '<span class="appr-hint' + (acked ? " acked" : "") + '">' + hint + "</span>" +
      '<input class="appr-note" placeholder="note (optional)" value="' +
        escapeHtml((state.approval && state.approval.note) || "") + '">' +
      '<button class="cmt-btn primary submit-review">Submit review</button>';
    if (!nav.parentNode) document.body.appendChild(nav);
    nav.querySelector("#cmt-mark").onclick = function () { setPickMode(!pickMode); };
    nav.querySelector("#cmt-comments").onclick = function () {
      var p = document.getElementById("cmt-panel"); if (p) p.classList.toggle("open");
    };
    var note = function () { return nav.querySelector(".appr-note").value.trim(); };
    nav.querySelector(".submit-review").onclick = function () {
      setApproval(pending ? "changes-requested" : "approved", note()).then(refreshAll);
    };
  }

  function renderAll() {
    decorateBlocks(); renderQuestions();
    renderPanel(); renderNav();
    renderTargets();
  }
  function refreshAll() { return loadAll().then(renderAll); }

  /* --------------------------- live refresh -------------------------- */

  function poll() {
    if (!hasServer) return;
    jget("/api/version").then(function (v) {
      if (v.plan && version.plan && v.plan !== version.plan) {
        location.reload(); return;             // plan body changed → reload
      }
      var changed = ["comments", "answers", "approval", "ack"].some(function (k) {
        return v[k] !== version[k];
      });
      version = v;
      if (changed) refreshAll();
    }).catch(function () { /* server gone; ignore */ });
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadAll().then(function () {
      renderAll();
      if (hasServer) setInterval(poll, 2500);
    });
  });
})();
