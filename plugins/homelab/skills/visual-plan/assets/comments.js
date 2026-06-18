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
  var state = { comments: [], answers: [], approval: { state: null, note: "" } };
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

  function openComposer(el, anchor) {
    closeComposer();
    var quote = anchor ? null : String(window.getSelection ? window.getSelection() : "").trim();
    var box = document.createElement("div");
    box.className = "cmt-composer";
    box.innerHTML =
      (anchor ? '<div class="quote">📍 pinned point</div>' : "") +
      (quote ? '<div class="quote">“' + escapeHtml(quote.slice(0, 200)) + "”</div>" : "") +
      '<textarea placeholder="What should change here?"></textarea>' +
      '<div class="actions"><button class="cmt-btn cancel">Cancel</button>' +
      '<button class="cmt-btn primary save">Comment</button></div>';
    el.appendChild(box);
    var ta = box.querySelector("textarea"); ta.focus();
    box.querySelector(".cancel").addEventListener("click", closeComposer);
    box.querySelector(".save").addEventListener("click", function () {
      var body = ta.value.trim(); if (!body) return;
      addComment({
        blockId: el.getAttribute("data-block-id"),
        blockLabel: el.getAttribute("data-block-label") || el.getAttribute("data-block-id"),
        quote: quote || null, anchor: anchor || null, body: body,
      }).then(function () { closeComposer(); refreshAll(); });
    });
  }
  function closeComposer() {
    var c = document.querySelector(".cmt-composer"); if (c) c.remove();
  }

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
              .then(function () { renderQuestions(); renderLauncher(); });
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
                .then(function () { renderQuestions(); renderLauncher(); });
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
    return '<div class="cmt-item ' + (resolved ? "resolved" : "") + '" data-cid="' + c.id + '">' +
      '<div class="where"><span class="cmt-status-dot"></span>' +
      escapeHtml(c.blockLabel || c.blockId) +
      (c.anchor ? " · 📍" : c.quote ? " · ❝" : "") + "</div>" +
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
      'select text to quote it, or Alt-click to pin a point.</p>';
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
        var c = byId(cid); var el = blockEl(c.blockId);
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

  function renderApproval() {
    var bar = document.getElementById("cmt-approval") || document.createElement("div");
    bar.id = "cmt-approval"; bar.className = "cmt-approval";
    var s = state.approval && state.approval.state;
    var statusHtml = s
      ? '<span class="appr-state ' + s + '">' +
        (s === "approved" ? "✓ Approved" : "✎ Changes requested") +
        (state.approval.note ? " — " + escapeHtml(state.approval.note) : "") + "</span>"
      : '<span class="appr-state none">Awaiting review</span>';
    bar.innerHTML = statusHtml +
      '<span class="wf-spacer"></span>' +
      '<input class="appr-note" placeholder="optional note" value="' +
        escapeHtml((state.approval && state.approval.note) || "") + '">' +
      '<button class="cmt-btn changes">Request changes</button>' +
      '<button class="cmt-btn primary approve">Approve</button>';
    if (!bar.parentNode) document.body.appendChild(bar);
    var note = function () { return bar.querySelector(".appr-note").value.trim(); };
    bar.querySelector(".approve").onclick = function () { setApproval("approved", note()).then(refreshAll); };
    bar.querySelector(".changes").onclick = function () { setApproval("changes-requested", note()).then(refreshAll); };
  }

  /* ----------------------------- launcher ---------------------------- */

  function renderLauncher() {
    var b = document.getElementById("cmt-launcher") || document.createElement("button");
    b.id = "cmt-launcher"; b.className = "cmt-launcher";
    b.innerHTML = "Comments <span class=\"count\">" + openCount() + "</span>";
    b.onclick = function () { document.getElementById("cmt-panel").classList.toggle("open"); };
    if (!b.parentNode) document.body.appendChild(b);
  }

  function renderAll() {
    decorateBlocks(); renderQuestions(); renderPanel(); renderApproval(); renderLauncher();
  }
  function refreshAll() { return loadAll().then(renderAll); }

  /* --------------------------- live refresh -------------------------- */

  function poll() {
    if (!hasServer) return;
    jget("/api/version").then(function (v) {
      if (v.plan && version.plan && v.plan !== version.plan) {
        location.reload(); return;             // plan body changed → reload
      }
      var changed = ["comments", "answers", "approval"].some(function (k) {
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
