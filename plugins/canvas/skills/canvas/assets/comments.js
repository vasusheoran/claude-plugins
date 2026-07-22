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

  // Review-API base: the directory of the current page, so this one asset
  // works served at root by serve.py (/plan.html -> /api/…) and under a
  // canvasd workspace prefix (/w/<key>/plan.html -> /w/<key>/api/…).
  function apiBase(pathname) {
    var p = pathname || "/";
    var cut = p.lastIndexOf("/");
    return cut < 0 ? "/" : p.slice(0, cut + 1);
  }
  // Sibling-page link: tabs must stay inside the /w/<key>/ prefix — a
  // root-absolute href escapes the workspace and 404s on canvasd.
  function tabHref(pathname, file) { return apiBase(pathname) + file; }
  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = { apiBase: apiBase, tabHref: tabHref };
    return; // node test harness: expose the pure core, skip the DOM widget
  }
  function api(path) { return apiBase(location.pathname) + "api/" + path; }

  var hasServer = location.protocol.startsWith("http");
  var LS = "visual-plan::" + location.pathname;
  var state = { comments: [], answers: [], approval: { state: null, note: "" }, ack: {}, pages: [] };
  var version = {};

  // Current HTML artifact: basename of the path, with "/" meaning plan.html.
  // Comments carry a "page" field; legacy comments (no page) count as plan.html.
  var DEFAULT_PAGE = "plan.html";
  var curPage = (function () {
    var p = (location.pathname || "/").split("/").pop();
    return p || DEFAULT_PAGE;
  })();
  function pageOf(c) { return c.page || DEFAULT_PAGE; }

  // When on, the review panel/nav counts show comments from every page, not
  // just the current one. Off by default so a page reviews only itself.
  var showAllPages = false;

  // Pages may opt out of the approval gate with <body data-approval="off">.
  function approvalOff() {
    return !!(document.body && document.body.getAttribute("data-approval") === "off");
  }

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
      jget(api("comments")).then(function (d) { state.comments = d.comments || []; }),
      jget(api("answers")).then(function (d) { state.answers = d.answers || []; }),
      jget(api("approval")).then(function (d) { state.approval = d; }),
      jget(api("ack")).then(function (d) { state.ack = d || {}; }),
      jget(api("version")).then(function (d) { version = d; }),
      // Multi-page workspace: tabs only appear for 2+ pages; a failure (e.g.
      // an older server) leaves pages empty so the nav is unchanged.
      jget(api("pages")).then(function (d) { state.pages = (d && d.pages) || []; })
        .catch(function () { state.pages = []; }),
    ]);
  }

  function addComment(fields) {
    if (hasServer) {
      return jpost(api("comments"), fields).then(function (c) { state.comments.push(c); return c; });
    }
    var c = Object.assign({
      id: "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      parentId: null, status: "open", target: "agent", author: "human",
      anchor: null, quote: null, page: DEFAULT_PAGE, createdAt: new Date().toISOString(),
    }, fields);
    state.comments.push(c); lsSave(); return Promise.resolve(c);
  }

  function setStatus(id, action) {
    if (hasServer) return jpost(api("comments/" + id + "/" + action));
    var c = byId(id); if (c) c.status = action === "resolve" ? "resolved" : "open";
    lsSave(); return Promise.resolve();
  }

  function upsertAnswer(fields) {
    if (hasServer) {
      return jpost(api("answers"), fields).then(function (a) { mergeAnswer(a); return a; });
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
      return jpost(api("approval"), { state: approvalState, note: note })
        .then(function (d) { state.approval = d; });
    }
    state.approval = { state: approvalState, note: note, decidedAt: new Date().toISOString() };
    lsSave(); return Promise.resolve();
  }

  /* ----------------------------- helpers ----------------------------- */

  function byId(id) { return state.comments.filter(function (c) { return c.id === id; })[0]; }
  function blockEl(id) { return document.querySelector('[data-block-id="' + id + '"]'); }

  // Belongs on this page? Anchors (pins/quotes/targets) always scope to curPage
  // because the DOM they attach to is this page; the panel/nav honor the
  // "all pages" toggle.
  function onCurPage(c) { return pageOf(c) === curPage; }
  function inView(c) { return showAllPages || onCurPage(c); }

  function openCount() {
    return state.comments.filter(function (c) {
      return c.status !== "resolved" && inView(c);
    }).length;
  }
  function repliesOf(id) {
    return state.comments.filter(function (c) { return c.parentId === id; });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------- Comment mode ---------------------------- */

  // The single entry point for creating comments. Toggling it on turns the
  // cursor into an element picker (like the browser inspector): hovering
  // highlights the element under the cursor. Pointer-up then resolves to one of
  // three anchor kinds, in priority order:
  //   Alt held           → a pinned point (x/y % within the enclosing block),
  //   text selection ≥3   → a quote comment on the enclosing block,
  //   otherwise           → an element anchor (cssPath of the picked element).
  // The mode is sticky: posting or cancelling a comment keeps it on; only Esc
  // or re-clicking the nav button exits. Every listener below is a complete
  // no-op while the mode is off — with it off nothing here touches artifact
  // events (no preventDefault / stopPropagation), so the plan's own prototype
  // JS behaves exactly as if this widget weren't present.
  var pickMode = false;
  var pickOverlay = null;

  function setPickMode(on) {
    pickMode = on;
    document.body.classList.toggle("cmt-pick", on);
    if (!on && pickOverlay) pickOverlay.style.display = "none";
    if (on) {
      // First-ever activation clears the nudge pulse forever.
      try {
        if (!localStorage.getItem("cmt-mode-used")) localStorage.setItem("cmt-mode-used", "1");
      } catch (e) {}
    }
    renderNav();
  }

  function isOwnUi(el) {
    return !el || !el.closest || !!el.closest(
      "#cmt-nav, .cmt-composer, .cmt-panel, .cmt-pin, .cmt-chip, #cmt-pick-overlay");
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
    var picked = pickTarget(e.target);
    var r = picked.getBoundingClientRect();
    var o = ensureOverlay();
    o.style.display = "block";
    o.style.left = r.left + "px"; o.style.top = r.top + "px";
    o.style.width = r.width + "px"; o.style.height = r.height + "px";
    // Label the overlay for the CSS ::after tag (display-only). Prefer an
    // explicit component label, then the enclosing block's label, then a
    // trimmed tag/text fallback — the same precedence openComposer uses.
    var host = picked.closest && picked.closest("[data-block-id]");
    var label = (picked.getAttribute && picked.getAttribute("data-cmt-label")) ||
      (host && host.getAttribute && host.getAttribute("data-block-label")) ||
      ((picked.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)) ||
      (picked.tagName ? picked.tagName.toLowerCase() : "element");
    o.setAttribute("data-label", label);
  }, true);

  // Single pointer-up resolver for all three anchor kinds. Runs only in-mode;
  // when off it returns immediately without touching the event, so artifact
  // clicks pass straight through to the plan's own handlers.
  document.addEventListener("mouseup", function (e) {
    if (!pickMode || isOwnUi(e.target)) return;
    swallowNextClick = true;

    // Alt held → pinned point anchored as % of the enclosing block.
    if (e.altKey) {
      var block = e.target.closest && e.target.closest("[data-block-id]");
      if (!block) { swallowNextClick = false; return; }  // unhandled — let the click through
      e.preventDefault(); e.stopPropagation();
      var r = block.getBoundingClientRect();
      var anchor = {
        x: Math.round(((e.clientX - r.left) / r.width) * 100),
        y: Math.round(((e.clientY - r.top) / r.height) * 100),
      };
      openComposer(block, anchor);
      return;
    }

    // Non-collapsed text selection of ≥3 chars → quote comment on its block.
    var sel = window.getSelection ? window.getSelection() : null;
    var selText = sel && !sel.isCollapsed ? String(sel).trim() : "";
    if (selText.length >= 3) {
      var anchorNode = sel.anchorNode;
      var selHost = anchorNode && anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode;
      var qblock = selHost && selHost.closest && selHost.closest("[data-block-id]");
      if (qblock && !isOwnUi(selHost)) {
        e.preventDefault(); e.stopPropagation();
        openComposer(qblock, null, false, selText);
        return;
      }
    }

    // Otherwise → element anchor via the picker.
    e.preventDefault(); e.stopPropagation();
    openComposer(pickTarget(e.target), null, true);
  }, true);

  // preventDefault on mouseup does NOT cancel the click the browser fires
  // next — without this, commenting on a prototype button would also trigger
  // the button. Swallow exactly the click that follows an in-mode mouseup.
  var swallowNextClick = false;
  document.addEventListener("click", function (e) {
    var swallow = swallowNextClick; swallowNextClick = false;
    if (!swallow || !pickMode || isOwnUi(e.target)) return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && pickMode) { setPickMode(false); return; }
    // Bare "c"/"C" toggles the mode: no modifiers, not while typing, and only
    // when the page hasn't opted out via <body data-comment-key="off">.
    if ((e.key === "c" || e.key === "C") &&
        !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      var t = e.target;
      var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
        (t.isContentEditable));
      if (typing) return;
      if (document.body && document.body.getAttribute("data-comment-key") === "off") return;
      e.preventDefault();
      setPickMode(!pickMode);
    }
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
      if (!c.componentId || c.parentId != null || !onCurPage(c)) return;
      var el = resolveComponent(c.componentId);
      if (el) el.classList.toggle("cmt-target", c.status !== "resolved");
    });
  }

  /* ------------------------ blocks, pins, quotes --------------------- */

  // Give annotated-code panes line numbers so margin notes ("L3 …") have
  // something to point at. Display-only, runs once per pre; numbers are
  // unselectable so copied code stays clean.
  function numberAnnotated() {
    document.querySelectorAll(".annotated pre:not(.numbered)").forEach(function (pre) {
      var lines = pre.textContent.replace(/\n$/, "").split("\n");
      // join with "" — the grid rows already stack; a literal \n between them
      // would render as an extra blank line inside the <pre>
      pre.innerHTML = lines.map(function (line, i) {
        return '<span class="ln-row"><span class="num">' + (i + 1) + "</span>" +
          "<span>" + escapeHtml(line) + "</span></span>";
      }).join("");
      pre.classList.add("numbered");
    });
  }

  function decorateBlocks() {
    document.querySelectorAll("[data-block-id]").forEach(function (el) {
      el.classList.add("block");
      var id = el.getAttribute("data-block-id");
      // Count open top-level comments on this block for the current page.
      var openHere = state.comments.filter(function (c) {
        return c.blockId === id && c.parentId == null && c.status !== "resolved" && onCurPage(c);
      });
      el.classList.toggle("has-comments", openHere.length > 0);
      // The count chip is a quiet navigation affordance (not a creation one):
      // clicking it opens the panel at this block's first open comment.
      var chip = el.querySelector(":scope > .cmt-chip");
      if (!openHere.length) {
        if (chip) chip.remove();
      } else {
        if (!chip) {
          chip = document.createElement("button");
          chip.className = "cmt-chip";
          el.appendChild(chip);
        }
        chip.textContent = openHere.length + " ●";
        chip.title = openHere.length + " open comment" + (openHere.length === 1 ? "" : "s") +
          " — click to view";
        var firstId = openHere[0].id;
        chip.onclick = function (e) { e.stopPropagation(); openPanelAt(firstId); };
      }
    });
    renderPins();
    highlightQuotes();
  }

  function renderPins() {
    document.querySelectorAll(".cmt-pin").forEach(function (p) { p.remove(); });
    state.comments.forEach(function (c, i) {
      if (!c.anchor || c.parentId != null || !onCurPage(c)) return;
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
      if (!c.quote || c.anchor || c.parentId != null || !onCurPage(c)) return;
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
  // quoteText, when given, is the selection text for a quote comment — the
  // caller (Comment mode's pointer-up) passes it explicitly; there is no longer
  // a passive getSelection() capture here.
  function openComposer(el, anchor, asComponent, quoteText) {
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
    var quote = (!anchor && !isComponent && quoteText) ? String(quoteText).trim() : null;

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
        target: target, body: body, page: curPage,
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
        // Every choice question gets a synthetic "Decide for me" option —
        // its value "__defer__" tells the agent to apply the recommended
        // default. Authors never write this option themselves.
        if (!el.querySelector('.qopt[data-value="__defer__"]')) {
          var defer = document.createElement("div");
          defer.className = "qopt defer";
          defer.setAttribute("data-value", "__defer__");
          defer.textContent = "Decide for me — go with the recommendation";
          host.appendChild(defer);
        }
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
                if (val === "__defer__") {
                  // defer is exclusive: it replaces any picks, or unselects itself
                  value = value.indexOf("__defer__") === -1 ? ["__defer__"] : [];
                } else {
                  var at = value.indexOf(val);
                  if (at === -1) value.push(val); else value.splice(at, 1);
                  var dat = value.indexOf("__defer__");
                  if (dat !== -1) value.splice(dat, 1);
                }
              } else {
                // clicking the selected option again unselects it
                value = (cur && cur.value === val) ? null : val;
              }
              upsertAnswer({ questionId: qid, questionLabel: label, mode: mode, value: value })
                .then(function () { renderQuestions(); renderNav(); });
            });
          }
        });
      }
      var st = el.querySelector(".qstate");
      if (st) {
        var v = saved && saved.value;
        var answered = v != null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0);
        st.textContent = answered
          ? (v === "__defer__" || (Array.isArray(v) && v[0] === "__defer__")
              ? "Deferred to Claude ✓" : "Answered ✓")
          : "";
      }
    });
  }

  /* ----------------------------- panel ------------------------------- */

  function commentNode(c) {
    var resolved = c.status === "resolved";
    var replies = repliesOf(c.id);
    var isAgent = (c.target || "agent") === "agent";
    // When viewing all pages, badge comments that live on a different page.
    var foreign = showAllPages && !onCurPage(c);
    return '<div class="cmt-item ' + (resolved ? "resolved" : "") + '" data-cid="' + c.id + '">' +
      '<div class="where"><span class="cmt-status-dot"></span>' +
      (foreign ? '<span class="cmt-page-tag">' + escapeHtml(pageOf(c)) + "</span> " : "") +
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
    var tops = state.comments.filter(function (c) {
      return c.parentId == null && inView(c);
    });
    var items = tops.map(commentNode).join("") ||
      '<p style="padding:16px;color:#6b7280">No comments yet. Click <b>💬 Comment</b> ' +
      '(or press <b>C</b>), then click an element, Alt-click to pin a point, or ' +
      'select text to quote it.</p>';
    // "All pages" toggle appears only in a multi-page workspace.
    var multiPage = (state.pages || []).length > 1;
    var toggle = multiPage
      ? '<label class="cmt-allpages"><input type="checkbox" id="cmt-allpages"' +
        (showAllPages ? " checked" : "") + "> all pages</label>"
      : "";
    p.innerHTML =
      "<header><span>Review · " + openCount() + " open</span>" +
      '<button class="cmt-btn" id="cmt-close">Close</button></header>' +
      (toggle ? '<div class="cmt-panel-filter">' + toggle + "</div>" : "") +
      '<div class="list">' + items + "</div>" +
      (hasServer ? "" :
        '<div class="cmt-export-note">Offline (file://) — saved in this browser only. ' +
        '<button class="cmt-btn" id="cmt-export">Copy feedback JSON</button></div>');
    if (!p.parentNode) document.body.appendChild(p);
    p.querySelector("#cmt-close").onclick = function () { p.classList.remove("open"); };
    var allBox = p.querySelector("#cmt-allpages");
    if (allBox) allBox.onchange = function () {
      showAllPages = allBox.checked;
      renderPanel(); renderNav();
    };
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
        parentId: parentId, body: body, page: pageOf(parent) }).then(refreshAll);
    };
  }

  function openPanelAt(cid) {
    var p = document.getElementById("cmt-panel"); if (p) p.classList.add("open");
    var it = p && p.querySelector('[data-cid="' + cid + '"]');
    if (it) it.scrollIntoView({ block: "center" });
  }

  /* --------------------------- approval gate ------------------------- */

  // Open top-level comments addressed to Claude — the implicit "change requests".
  // Deliberately workspace-wide (NOT filtered by page): the approval decision
  // derived from it gates the whole workspace, so a Submit-to-Claude comment on
  // another tab must still turn a Submit review into changes-requested.
  function openAgentCount() {
    return state.comments.filter(function (c) {
      return c.parentId == null && c.status !== "resolved" &&
        (c.target || "agent") === "agent";
    }).length;
  }

  /* ------------------------------- top nav --------------------------- */

  // Whether the first-use nudge pulse should still play on the Comment button.
  function nudgeUnused() {
    try { return !localStorage.getItem("cmt-mode-used"); } catch (e) { return false; }
  }

  // Workspace tabs: one per HTML artifact, current page highlighted. Rendered
  // only for 2+ pages; empty (no tabs, unchanged nav) otherwise or in file://.
  function tabsHtml() {
    var pages = state.pages || [];
    if (pages.length < 2) return "";
    var tabs = pages.map(function (pg) {
      var current = pg.file === curPage;
      return '<a class="cmt-tab' + (current ? " current" : "") + '" href="' +
        escapeHtml(tabHref(location.pathname, pg.file)) + '"' +
        (current ? ' aria-current="page"' : "") + '>' +
        escapeHtml(pg.title || pg.file) + "</a>";
    }).join("");
    return '<nav class="cmt-tabs">' + tabs + "</nav>";
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
    // Pages with data-approval="off" drop the whole approval gate (status,
    // hint, note, submit); Comment mode and comments stay unchanged.
    // Hint state class mirrors the hint-text branches above so plan.css can
    // color/animate each phase (display-only).
    var hintState = !s ? (pending ? "changes" : "ready") : (acked ? "acked" : "awaiting");
    var apprHtml = approvalOff() ? "" :
      statusHtml + '<span class="appr-hint ' + hintState + '">' + hint + "</span>" +
      '<input class="appr-note" placeholder="note (optional)" value="' +
        escapeHtml((state.approval && state.approval.note) || "") + '">' +
      '<button class="cmt-btn primary submit-review">Submit review</button>';
    nav.innerHTML =
      tabsHtml() +
      '<button class="cmt-nav-btn cmt-mode' + (pickMode ? " active" : "") +
        (nudgeUnused() ? " nudge" : "") + '" id="cmt-mark" ' +
        'title="Comment mode — click an element, Alt-click to pin a point, or ' +
        'select text to quote (C to toggle, Esc to exit)">💬 Comment</button>' +
      '<button class="cmt-nav-btn" id="cmt-comments">Comments ' +
        '<span class="count">' + openCount() + "</span></button>" +
      '<span class="cmt-nav-spacer"></span>' +
      apprHtml;
    if (!nav.parentNode) document.body.appendChild(nav);
    nav.querySelector("#cmt-mark").onclick = function () { setPickMode(!pickMode); };
    nav.querySelector("#cmt-comments").onclick = function () {
      var p = document.getElementById("cmt-panel"); if (p) p.classList.toggle("open");
    };
    var submitBtn = nav.querySelector(".submit-review");
    if (submitBtn) {
      var note = function () { return nav.querySelector(".appr-note").value.trim(); };
      submitBtn.onclick = function () {
        setApproval(pending ? "changes-requested" : "approved", note()).then(refreshAll);
      };
    }
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
    jget(api("version")).then(function (v) {
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
    numberAnnotated();
    loadAll().then(function () {
      renderAll();
      if (hasServer) setInterval(poll, 2500);
    });
  });
})();
