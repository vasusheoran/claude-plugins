/* visual-plan — comment widget.
 *
 * Lets a reviewer click any [data-block-id] section, leave a comment, and have
 * it persisted to comments.json via serve.py's /api/comments endpoint — the
 * local analog of the hosted get-plan-feedback loop. The agent reads
 * comments.json to revise.
 *
 * If the page is opened as a bare file:// (no server), POST fails; we fall back
 * to localStorage and show an "Export feedback" button that copies a JSON blob
 * the user can paste back into chat. Copied verbatim per plan; not hand-edited.
 */
(function () {
  "use strict";

  var hasServer = location.protocol.startsWith("http");
  var LS_KEY = "visual-plan-comments::" + location.pathname;
  var comments = [];

  /* ---------- storage layer (server or localStorage fallback) ---------- */

  function loadComments() {
    if (hasServer) {
      return fetch("/api/comments")
        .then(function (r) { return r.json(); })
        .then(function (d) { comments = d.comments || []; })
        .catch(function () { comments = lsLoad(); });
    }
    comments = lsLoad();
    return Promise.resolve();
  }

  function lsLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function lsSave() { localStorage.setItem(LS_KEY, JSON.stringify(comments)); }

  function addComment(fields) {
    if (hasServer) {
      return fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      }).then(function (r) { return r.json(); })
        .then(function (c) { comments.push(c); return c; });
    }
    var c = Object.assign({
      id: "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      status: "open", target: "agent", author: "human",
      createdAt: new Date().toISOString(),
    }, fields);
    comments.push(c);
    lsSave();
    return Promise.resolve(c);
  }

  /* ---------- rendering ---------- */

  function blockEl(id) { return document.querySelector('[data-block-id="' + id + '"]'); }
  function openCount() { return comments.filter(function (c) { return c.status !== "resolved"; }).length; }

  function decorateBlocks() {
    document.querySelectorAll("[data-block-id]").forEach(function (el) {
      el.classList.add("block");
      if (!el.querySelector(":scope > .comment-affordance")) {
        var btn = document.createElement("button");
        btn.className = "comment-affordance";
        btn.title = "Comment on this block";
        btn.textContent = "💬";
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          openComposer(el);
        });
        el.appendChild(btn);
      }
      var has = comments.some(function (c) {
        return c.blockId === el.getAttribute("data-block-id") && c.status !== "resolved";
      });
      el.classList.toggle("has-comments", has);
    });
  }

  function openComposer(el) {
    closeComposer();
    var quote = String(window.getSelection ? window.getSelection() : "").trim();
    var box = document.createElement("div");
    box.className = "cmt-composer";
    box.innerHTML =
      (quote ? '<div class="quote">' + escapeHtml(quote.slice(0, 200)) + "</div>" : "") +
      '<textarea placeholder="What should change here?"></textarea>' +
      '<div class="actions">' +
      '<button class="cmt-btn cancel">Cancel</button>' +
      '<button class="cmt-btn primary save">Comment</button></div>';
    el.appendChild(box);
    var ta = box.querySelector("textarea");
    ta.focus();
    box.querySelector(".cancel").addEventListener("click", closeComposer);
    box.querySelector(".save").addEventListener("click", function () {
      var body = ta.value.trim();
      if (!body) return;
      addComment({
        blockId: el.getAttribute("data-block-id"),
        blockLabel: el.getAttribute("data-block-label") || el.getAttribute("data-block-id"),
        quote: quote || null,
        body: body,
      }).then(function () { closeComposer(); decorateBlocks(); renderPanel(); });
    });
  }
  function closeComposer() {
    var c = document.querySelector(".cmt-composer");
    if (c) c.remove();
  }

  function renderLauncher() {
    var b = document.getElementById("cmt-launcher") || document.createElement("button");
    b.id = "cmt-launcher";
    b.className = "cmt-launcher";
    b.innerHTML = "Comments <span class=\"count\">" + openCount() + "</span>";
    b.onclick = function () { document.getElementById("cmt-panel").classList.toggle("open"); };
    if (!b.parentNode) document.body.appendChild(b);
  }

  function renderPanel() {
    var p = document.getElementById("cmt-panel") || document.createElement("aside");
    p.id = "cmt-panel";
    p.className = "cmt-panel" + (p.classList.contains("open") ? " open" : "");
    var items = comments.map(function (c) {
      return '<div class="cmt-item ' + (c.status === "resolved" ? "resolved" : "") +
        '" data-goto="' + c.blockId + '">' +
        '<div class="where"><span class="cmt-status-dot"></span>' +
        escapeHtml(c.blockLabel || c.blockId) + "</div>" +
        (c.quote ? '<div class="meta">“' + escapeHtml(c.quote.slice(0, 120)) + "”</div>" : "") +
        "<div>" + escapeHtml(c.body) + "</div>" +
        '<div class="meta">' + c.status + " · " + (c.createdAt || "").slice(0, 16).replace("T", " ") + "</div>" +
        "</div>";
    }).join("") || '<p style="padding:16px;color:#6b7280">No comments yet. Hover a section and click 💬.</p>';
    p.innerHTML =
      "<header><span>Review comments</span>" +
      '<button class="cmt-btn" id="cmt-close">Close</button></header>' +
      '<div class="list">' + items + "</div>" +
      (hasServer ? "" :
        '<div class="cmt-export-note">Offline (file://). Comments saved in this browser only. ' +
        '<button class="cmt-btn" id="cmt-export">Copy feedback JSON</button></div>');
    if (!p.parentNode) document.body.appendChild(p);
    p.querySelector("#cmt-close").onclick = function () { p.classList.remove("open"); };
    p.querySelectorAll("[data-goto]").forEach(function (it) {
      it.onclick = function () {
        var el = blockEl(it.getAttribute("data-goto"));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
    var ex = p.querySelector("#cmt-export");
    if (ex) ex.onclick = function () {
      navigator.clipboard.writeText(JSON.stringify({ comments: comments }, null, 2));
      ex.textContent = "Copied!";
    };
    renderLauncher();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadComments().then(function () {
      decorateBlocks();
      renderPanel();
      renderLauncher();
    });
  });
})();
