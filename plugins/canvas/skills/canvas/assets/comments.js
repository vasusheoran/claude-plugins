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

  // A comment's page: an explicit "page", else legacy comments (written before
  // pages existed) count as plan.html — mirrored in groupComments below.
  var DEFAULT_PAGE = "plan.html";

  // Lifecycle state of a comment. The server field "state" (pending|sent|
  // resolved) wins; legacy entries carry only "status", where "resolved" maps
  // to resolved and everything else (incl. the old "open") to sent. A brand-new
  // comment with neither field is treated as sent (safe: it shows in the panel).
  function normalizeState(c) {
    c = c || {};
    if (c.state === "pending" || c.state === "sent" || c.state === "resolved") return c.state;
    return c.status === "resolved" ? "resolved" : "sent";
  }

  // Split top-level comments (parentId == null) into pending / sent / resolved
  // buckets. Filtered to `page` unless showAll; a comment with no page counts
  // as plan.html so legacy entries land on the default page.
  function groupComments(comments, page, showAll) {
    var out = { pending: [], sent: [], resolved: [] };
    (comments || []).forEach(function (c) {
      if (c.parentId != null) return;
      if (!showAll && (c.page || DEFAULT_PAGE) !== page) return;
      out[normalizeState(c)].push(c);
    });
    return out;
  }

  // Activity-feed glyph for an event kind ("•" when unrecognized).
  function feedIcon(kind) {
    return {
      submitted: "↑", "picked-up": "✓", replied: "↩",
      resolved: "✔", "page-updated": "✎", acked: "★",
    }[kind] || "•";
  }

  // Count of open pending top-level drafts across ALL pages — the N in the
  // "Send to Claude (N)" button (pending drafts are never resolved).
  function sendCount(comments) {
    return (comments || []).filter(function (c) {
      return c.parentId == null && normalizeState(c) === "pending";
    }).length;
  }

  // Notification chip for a single comment: pending drafts stay "pending"; a
  // sent comment flips to "seen" once the workspace ack covers its sentAt,
  // otherwise "awaiting". (Callers layer resolved/replied on top.)
  function seenChip(c, ack) {
    c = c || {}; ack = ack || {};
    if (normalizeState(c) === "pending") return "pending";
    if (ack.decidedAt && c.sentAt && ack.decidedAt >= c.sentAt) return "seen";
    return "awaiting";
  }

  // Typed-tab kind → glyph (unknown kinds show the neutral doc glyph).
  function tabIcon(kind) {
    return { plan: "📋", mockup: "🧩", diagram: "⇄", decision: "◆", doc: "📄" }[kind] || "📄";
  }

  // A page entry's kind: explicit "kind" from /api/pages, else a fallback for
  // old servers — plan.html is a plan, anything else a doc.
  function pageKind(pg) {
    pg = pg || {};
    if (pg.kind) return pg.kind;
    return pg.file === DEFAULT_PAGE ? "plan" : "doc";
  }

  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = {
      apiBase: apiBase, tabHref: tabHref,
      normalizeState: normalizeState, groupComments: groupComments,
      feedIcon: feedIcon, sendCount: sendCount, seenChip: seenChip,
      tabIcon: tabIcon, pageKind: pageKind,
    };
    return; // node test harness: expose the pure core, skip the DOM widget
  }
  function api(path) { return apiBase(location.pathname) + "api/" + path; }

  var hasServer = location.protocol.startsWith("http");
  var LS = "visual-plan::" + location.pathname;
  var state = {
    comments: [], answers: [], approval: { state: null, note: "" },
    ack: {}, pages: [], activity: [],
  };
  var version = {};

  // Current HTML artifact: basename of the path, with "/" meaning plan.html.
  // Comments carry a "page" field; legacy comments (no page) count as plan.html.
  // (DEFAULT_PAGE is defined once, above the node-export boundary.)
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
  // Prose pages opt out of the no-mode selection bubble with
  // <body data-select-comment="off"> (mirrors data-comment-key="off").
  function selectCommentOff() {
    return !!(document.body && document.body.getAttribute("data-select-comment") === "off");
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
      // Tabs render for every page (even one), so pages is always fetched; an
      // older server without the endpoint just leaves it empty and we
      // synthesize a single tab for the current page.
      jget(api("pages")).then(function (d) { state.pages = (d && d.pages) || []; })
        .catch(function () { state.pages = []; }),
      // Activity feed; absent on older servers → empty, feed stays quiet.
      jget(api("activity")).then(function (d) { state.activity = (d && d.events) || []; })
        .catch(function () { state.activity = []; }),
    ]);
  }

  // New comments are pending drafts (author human) — nothing reaches Claude
  // until Send. Replies (parentId set) post as sent so the thread updates live.
  function addComment(fields) {
    if (hasServer) {
      return jpost(api("comments"), fields).then(function (c) { state.comments.push(c); return c; });
    }
    var c = Object.assign({
      id: "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      parentId: null, state: fields.parentId ? "sent" : "pending",
      author: "human", quote: null, page: DEFAULT_PAGE,
      createdAt: new Date().toISOString(),
    }, fields);
    state.comments.push(c); lsSave(); return Promise.resolve(c);
  }

  // Pending drafts are editable / deletable until Send.
  function editComment(id, body) {
    if (hasServer) {
      return jpost(api("comments/" + id + "/edit"), { body: body })
        .then(function (c) { mergeComment(c); return c; });
    }
    var c = byId(id);
    if (c) { c.body = body; c.editedAt = new Date().toISOString(); }
    lsSave(); return Promise.resolve(c);
  }
  function deleteComment(id) {
    if (hasServer) return jpost(api("comments/" + id + "/delete"));
    state.comments = state.comments.filter(function (c) {
      return c.id !== id && c.parentId !== id;
    });
    lsSave(); return Promise.resolve();
  }
  function mergeComment(c) {
    if (!c || !c.id) return;
    var found = false;
    state.comments = state.comments.map(function (x) {
      if (x.id === c.id) { found = true; return c; }
      return x;
    });
    if (!found) state.comments.push(c);
  }

  // Send: pending → sent, record the gate decision, notify Claude once.
  // decision is "approved" | "changes-requested" | null (ungated pages).
  function submit(decision, note) {
    if (hasServer) return jpost(api("submit"), { decision: decision, note: note });
    // file:// fallback: mark drafts sent locally, stamp approval if gated.
    var now = new Date().toISOString();
    state.comments.forEach(function (c) {
      if (c.parentId == null && normalizeState(c) === "pending") { c.state = "sent"; c.sentAt = now; }
    });
    if (decision) state.approval = { state: decision, note: note || "", decidedAt: now };
    lsSave(); return Promise.resolve();
  }

  // resolve / reopen a sent comment.
  function setStatus(id, action) {
    if (hasServer) return jpost(api("comments/" + id + "/" + action));
    var c = byId(id); if (c) c.state = action === "resolve" ? "resolved" : "sent";
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

  /* ----------------------------- helpers ----------------------------- */

  function byId(id) { return state.comments.filter(function (c) { return c.id === id; })[0]; }
  function blockEl(id) { return document.querySelector('[data-block-id="' + id + '"]'); }

  // Belongs on this page? Anchors (quotes/targets) always scope to curPage
  // because the DOM they attach to is this page; the panel/nav honor the
  // "all pages" toggle.
  function onCurPage(c) { return pageOf(c) === curPage; }
  function inView(c) { return showAllPages || onCurPage(c); }

  // Open (non-resolved) top-level comments in view — the nav "Comments" badge.
  function openCount() {
    return state.comments.filter(function (c) {
      return c.parentId == null && normalizeState(c) !== "resolved" && inView(c);
    }).length;
  }
  // Open sent comments on a given page — the per-tab badge.
  function sentOpenOnPage(file) {
    return state.comments.filter(function (c) {
      return c.parentId == null && pageOf(c) === file && normalizeState(c) === "sent";
    }).length;
  }
  function repliesOf(id) {
    return state.comments.filter(function (c) { return c.parentId === id; });
  }
  function claudeReply(id) {
    return repliesOf(id).some(function (r) { return (r.author || "") === "claude"; });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------- Comment mode ---------------------------- */

  // Element-pick mode: one of the two remaining anchor kinds (the other, text
  // quoting, works with no mode at all via the selection bubble below).
  // Toggling it on turns the cursor into an element picker (like the browser
  // inspector): hovering highlights the element under the cursor. Pointer-up
  // resolves to one of two anchor kinds, in priority order:
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
      "#cmt-nav, .cmt-composer, .cmt-panel, .cmt-chip, #cmt-pick-overlay, " +
      "#cmt-bubble, #cmt-feed, #cmt-sendpop, #cmt-toasts");
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

  // Single pointer-up resolver for the two anchor kinds. Runs only in-mode;
  // when off it returns immediately without touching the event, so artifact
  // clicks pass straight through to the plan's own handlers.
  document.addEventListener("mouseup", function (e) {
    if (!pickMode || isOwnUi(e.target)) return;
    swallowNextClick = true;

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
    setPickMode(false);
  }, true);

  /* ---------------------- no-mode selection bubble ------------------- */

  // Text quoting works WITHOUT Comment mode: selecting ≥3 chars inside a
  // [data-block-id] (and not our own UI) floats a "💬 Comment" bubble by the
  // selection; clicking it opens the quote composer. This listener never
  // preventDefault/stopPropagation-s, so with no selection it touches nothing
  // the artifact does — the prototype-safety invariant. Off while Comment mode
  // is on (that handler owns selection) and on pages with data-select-comment="off".
  var selBubble = null, bubbleQuote = null, bubbleBlock = null;

  function ensureBubble() {
    if (!selBubble) {
      selBubble = document.createElement("button");
      selBubble.id = "cmt-bubble";
      selBubble.className = "cmt-bubble";
      selBubble.type = "button";
      selBubble.textContent = "💬 Comment";
      selBubble.style.display = "none";
      // Keep the selection alive through the click.
      selBubble.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      selBubble.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (bubbleBlock && bubbleQuote) openComposer(bubbleBlock, null, false, bubbleQuote);
        hideBubble();
      });
      document.body.appendChild(selBubble);
    }
    return selBubble;
  }
  function hideBubble() { if (selBubble) selBubble.style.display = "none"; }

  document.addEventListener("mouseup", function (e) {
    if (pickMode || selectCommentOff() || isOwnUi(e.target)) return;
    // Defer a tick so the browser has finalized the selection.
    setTimeout(function () {
      var sel = window.getSelection ? window.getSelection() : null;
      var txt = sel && !sel.isCollapsed ? String(sel).trim() : "";
      if (txt.length < 3) { hideBubble(); return; }
      var node = sel.anchorNode;
      var host = node && node.nodeType === 3 ? node.parentElement : node;
      var block = host && host.closest && host.closest("[data-block-id]");
      if (!block || isOwnUi(host)) { hideBubble(); return; }
      var rect;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e2) { hideBubble(); return; }
      bubbleQuote = txt; bubbleBlock = block;
      var b = ensureBubble();
      b.style.display = "block";
      b.style.left = Math.max(8, rect.left + rect.width / 2 - 55) + "px";
      b.style.top = (rect.bottom + 8) + "px";
    }, 0);
  });
  // Dismiss the bubble the moment a new interaction starts elsewhere.
  document.addEventListener("mousedown", function (e) {
    if (selBubble && selBubble.style.display !== "none" && !selBubble.contains(e.target)) hideBubble();
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
    if (e.key === "Escape") {
      // Composer open → one Esc dismisses it (mode already exited on pick).
      if (activeComposer) { closeComposer(true); return; }
      if (pickMode) { setPickMode(false); return; }
      return;                        // nothing active: don't swallow the key
    }
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
      if (el) el.classList.toggle("cmt-target", normalizeState(c) !== "resolved");
    });
  }

  /* ------------------------ blocks & quotes ------------------------- */

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
        return c.blockId === id && c.parentId == null &&
          normalizeState(c) !== "resolved" && onCurPage(c);
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
    highlightQuotes();
  }

  // Best-effort: wrap a quoted selection in <mark> when it sits in one text node.
  function highlightQuotes() {
    state.comments.forEach(function (c) {
      if (!c.quote || c.parentId != null || !onCurPage(c)) return;
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
        mark.className = "cmt-quote" + (normalizeState(c) === "resolved" ? " resolved" : "");
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
        : i.quote ? "q:" + i.blockId + ":" + i.quote.slice(0, 40)
        : "b:" + i.blockId);
  }
  function loadDraft(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function saveDraft(k, v) {
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {}
  }

  // el is a [data-block-id] section, or any element when asComponent is true.
  // quoteText, when given, is the selection text for a quote comment. There is
  // one action — "Add" (plus Cancel): every new comment is a pending draft,
  // editable and deletable from the panel until Send. (The legacy `anchor`
  // parameter is retained for call-site compatibility but is always null.)
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
    var quote = (!isComponent && quoteText) ? String(quoteText).trim() : null;

    var dkey = draftKey({ componentId: componentId, quote: quote, blockId: blockId });
    var ctx = componentLabel ? "◉ " + escapeHtml(componentLabel)
      : quote ? "❝ " + escapeHtml(quote.slice(0, 200))
      : escapeHtml(blockLabel);

    var box = document.createElement("div");
    box.className = "cmt-composer";
    box.innerHTML =
      '<div class="quote">' + ctx + "</div>" +
      '<textarea placeholder="What should change here?  (Shift+Enter to add)"></textarea>' +
      '<div class="actions">' +
        '<button class="cmt-btn cancel">Cancel</button>' +
        '<button class="cmt-btn primary add">Add</button>' +
      "</div>";
    (host.appendChild ? host : document.body).appendChild(box);
    var ta = box.querySelector("textarea");
    ta.value = loadDraft(dkey); ta.focus();
    activeComposer = { box: box, ta: ta, dkey: dkey };
    // Enter inserts a newline (default textarea behavior); Shift+Enter submits.
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); save(); }
    });

    function save() {
      var body = ta.value.trim(); if (!body) return;
      activeComposer = null; saveDraft(dkey, ""); box.remove();
      addComment({
        blockId: blockId, blockLabel: blockLabel,
        componentId: componentId, componentLabel: componentLabel,
        quote: quote || null, body: body, page: curPage,
      }).then(function () { toast("Draft added — edit or delete it until you Send."); refreshAll(); });
    }
    box.querySelector(".add").addEventListener("click", save);
    box.querySelector(".cancel").addEventListener("click", function () { closeComposer(false); });
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
        // Two synthetic rows the widget always appends (authors never write
        // them): "✎ Other…" (free-text answer) and "◇ You decide, Claude"
        // (defer). Options render fully neutral — no recommendation styling.
        if (!el.querySelector('.qopt.other[data-value="__other__"]')) {
          var other = document.createElement("div");
          other.className = "qopt other";
          other.setAttribute("data-value", "__other__");
          other.innerHTML = '<span class="qopt-label">✎ Other…</span>' +
            '<div class="qother"><textarea placeholder="Type your own answer…"></textarea>' +
            '<div class="qother-actions"><button class="cmt-btn primary qother-save">Save</button></div></div>';
          host.appendChild(other);
        }
        if (!el.querySelector('.qopt.defer[data-value="__defer__"]')) {
          var defer = document.createElement("div");
          defer.className = "qopt defer";
          defer.setAttribute("data-value", "__defer__");
          defer.textContent = "◇ You decide, Claude";
          host.appendChild(defer);
        }
        // Current "other" text, restored so the row shows the saved answer.
        var otherRow = el.querySelector('.qopt.other[data-value="__other__"]');
        var otherTa = otherRow.querySelector("textarea");
        var isOther = saved && (mode === "multi"
          ? (saved.value || []).indexOf("__other__") !== -1
          : saved.value === "__other__");
        if (isOther && document.activeElement !== otherTa) {
          otherTa.value = saved.otherText || "";
          otherRow.classList.add("expanded");
        }

        function saveOther() {
          var txt = otherTa.value.trim(); if (!txt) return;
          var cur = answerFor(qid);
          var value;
          if (mode === "multi") {
            value = (cur && Array.isArray(cur.value)) ? cur.value.slice() : [];
            // __other__ coexists with picks but drops any defer.
            if (value.indexOf("__other__") === -1) value.push("__other__");
            var d0 = value.indexOf("__defer__"); if (d0 !== -1) value.splice(d0, 1);
          } else {
            value = "__other__";
          }
          upsertAnswer({ questionId: qid, questionLabel: label, mode: mode, value: value, otherText: txt })
            .then(function () { renderQuestions(); renderNav(); });
        }
        if (!otherRow._wired) {
          otherRow._wired = true;
          otherRow.querySelector(".qother-save").addEventListener("click", function (e) {
            e.stopPropagation(); saveOther();
          });
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
            opt.addEventListener("click", function (e) {
              // Clicking inside the Other textarea/Save must not toggle the row.
              if (val === "__other__") {
                if (e.target.closest(".qother")) return;
                otherRow.classList.toggle("expanded");
                if (otherRow.classList.contains("expanded")) otherTa.focus();
                return;
              }
              var cur = answerFor(qid);
              var value;
              if (mode === "multi") {
                value = (cur && Array.isArray(cur.value)) ? cur.value.slice() : [];
                if (val === "__defer__") {
                  // defer is exclusive: it replaces any picks, or unselects itself
                  value = value.indexOf("__defer__") === -1 ? ["__defer__"] : [];
                } else {
                  var at = value.indexOf(val);
                  if (at === -1) value.push(val); else value.splice(at, 1);
                  var dat = value.indexOf("__defer__");
                  if (dat !== -1) value.splice(dat, 1);
                  var ot = value.indexOf("__other__");
                  if (ot !== -1) value.splice(ot, 1);   // a concrete pick drops Other
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
        var isDefer = v === "__defer__" || (Array.isArray(v) && v.indexOf("__defer__") !== -1);
        var isOtherAns = v === "__other__" || (Array.isArray(v) && v.indexOf("__other__") !== -1);
        st.textContent = !answered ? ""
          : isDefer ? "Deferred to Claude ✓"
          : isOtherAns && saved.otherText ? 'Answered ✓ — "' + saved.otherText + '"'
          : "Answered ✓";
      }
    });
  }

  /* ----------------------------- panel ------------------------------- */

  // Per-comment notification chip. Pending drafts stay Pending; a Claude reply
  // makes a sent comment "Replied"; otherwise the ack rule (seenChip) decides
  // Seen ✓ vs Sent · awaiting. Resolved comments live in their own group.
  function statusChip(c) {
    var s = normalizeState(c);
    if (s === "pending") return { cls: "pend", label: "Pending" };
    if (s === "resolved") return { cls: "resolved", label: "Resolved" };
    if (claudeReply(c.id)) return { cls: "repl", label: "Replied" };
    return seenChip(c, state.ack) === "seen"
      ? { cls: "seen", label: "Seen ✓" }
      : { cls: "sent", label: "Sent · awaiting" };
  }

  // group is "pending" | "sent" | "resolved" — it selects the controls.
  function commentNode(c, group) {
    var replies = repliesOf(c.id);
    var foreign = showAllPages && !onCurPage(c);
    var chip = statusChip(c);
    var anchorGlyph = c.componentId ? " · ◉" : c.quote ? " · ❝" : "";
    var acts = group === "pending"
      ? '<button class="cmt-link edit">✎ Edit</button>' +
        '<button class="cmt-link danger delete">🗑 Delete</button>'
      : group === "resolved"
        ? '<button class="cmt-link toggle">Reopen</button>'
        : '<button class="cmt-link reply">Reply</button>' +
          '<button class="cmt-link toggle">Resolve</button>';
    var editBox = group === "pending"
      ? '<div class="cmt-editbox" hidden><textarea>' + escapeHtml(c.body) + "</textarea>" +
        '<div class="cmt-editbox-actions">' +
        '<button class="cmt-btn ecancel">Cancel</button>' +
        '<button class="cmt-btn primary esave">Save</button></div></div>'
      : "";
    return '<div class="cmt-item ' + group + '" data-cid="' + c.id + '">' +
      '<div class="where"><span class="cmt-status-dot"></span>' +
      (foreign ? '<span class="cmt-page-tag">' + escapeHtml(pageOf(c)) + "</span> " : "") +
      escapeHtml(c.blockLabel || c.blockId) +
      (c.componentLabel ? " › " + escapeHtml(c.componentLabel) : "") +
      anchorGlyph + "</div>" +
      '<span class="cmt-chip-status ' + chip.cls + '">' + escapeHtml(chip.label) + "</span>" +
      (c.quote ? '<div class="meta">“' + escapeHtml(c.quote.slice(0, 120)) + "”</div>" : "") +
      '<div class="cmt-body">' + escapeHtml(c.body) + "</div>" + editBox +
      '<div class="meta">' + escapeHtml((c.createdAt || "").slice(0, 16).replace("T", " ")) + "</div>" +
      replies.map(function (r) {
        var isClaude = (r.author || "") === "claude";
        return '<div class="cmt-reply' + (isClaude ? " claude" : "") + '">' +
          (isClaude ? '<span class="cmt-reply-who">Claude</span> ' : "↳ ") +
          escapeHtml(r.body) + "</div>";
      }).join("") +
      '<div class="cmt-actions">' + acts + "</div></div>";
  }

  function renderPanel() {
    var p = document.getElementById("cmt-panel") || document.createElement("aside");
    p.id = "cmt-panel";
    p.className = "cmt-panel" + (p.classList.contains("open") ? " open" : "");
    var g = groupComments(state.comments, curPage, showAllPages);

    function group(title, arr, kind) {
      if (!arr.length) return "";
      return '<h5 class="cmt-group">' + escapeHtml(title) + "</h5>" +
        arr.map(function (c) { return commentNode(c, kind); }).join("");
    }
    var pendingHtml = group("Pending — yours to edit", g.pending, "pending");
    var sentHtml = group("Sent to Claude", g.sent, "sent");
    var resolvedHtml = g.resolved.length
      ? '<details class="cmt-resolved-fold"><summary>Resolved (' + g.resolved.length + ")</summary>" +
        g.resolved.map(function (c) { return commentNode(c, "resolved"); }).join("") + "</details>"
      : "";
    var empty = !g.pending.length && !g.sent.length && !g.resolved.length;
    var items = empty
      ? '<p class="cmt-empty">No comments yet. Select text to quote it, or press ' +
        "<b>C</b> and click an element.</p>"
      : pendingHtml + sentHtml + resolvedHtml;
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
      var toggleBtn = it.querySelector(".toggle");
      if (toggleBtn) toggleBtn.onclick = function (e) {
        e.stopPropagation();
        var c = byId(cid);
        setStatus(cid, normalizeState(c) === "resolved" ? "reopen" : "resolve").then(refreshAll);
      };
      var replyBtn = it.querySelector(".reply");
      if (replyBtn) replyBtn.onclick = function (e) { e.stopPropagation(); openReply(it, cid); };
      var delBtn = it.querySelector(".delete");
      if (delBtn) delBtn.onclick = function (e) {
        e.stopPropagation(); deleteComment(cid).then(refreshAll);
      };
      var editBtn = it.querySelector(".edit");
      if (editBtn) editBtn.onclick = function (e) {
        e.stopPropagation();
        it.querySelector(".cmt-editbox").hidden = false;
        it.querySelector(".cmt-body").style.display = "none";
        it.querySelector(".cmt-actions").style.display = "none";
        var t = it.querySelector(".cmt-editbox textarea"); if (t) t.focus();
      };
      var esave = it.querySelector(".esave");
      if (esave) esave.onclick = function (e) {
        e.stopPropagation();
        var v = it.querySelector(".cmt-editbox textarea").value.trim(); if (!v) return;
        editComment(cid, v).then(refreshAll);
      };
      var ecancel = it.querySelector(".ecancel");
      if (ecancel) ecancel.onclick = function (e) { e.stopPropagation(); refreshAll(); };
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

  /* ------------------------------- top nav --------------------------- */

  // Whether the first-use nudge pulse should still play on the Comment button.
  function nudgeUnused() {
    try { return !localStorage.getItem("cmt-mode-used"); } catch (e) { return false; }
  }

  // Workspace tabs: one per HTML artifact, current page highlighted. Renders
  // ALWAYS — even a single page shows one tab (it doubles as a title bar). When
  // the server gives no pages (older server / file://) we synthesize one for
  // the current page. Each tab carries a kind icon and a badge of that page's
  // open sent comments.
  function tabsHtml() {
    var pages = state.pages || [];
    if (!pages.length) pages = [{ file: curPage, title: document.title || curPage }];
    var tabs = pages.map(function (pg) {
      var current = pg.file === curPage;
      var badge = sentOpenOnPage(pg.file);
      return '<a class="cmt-tab' + (current ? " current" : "") + '" href="' +
        escapeHtml(tabHref(location.pathname, pg.file)) + '"' +
        (current ? ' aria-current="page"' : "") + '>' +
        '<span class="cmt-tab-icon">' + tabIcon(pageKind(pg)) + "</span>" +
        '<span class="cmt-tab-title">' + escapeHtml(pg.title || pg.file) + "</span>" +
        (badge ? '<span class="cmt-tab-badge">' + badge + "</span>" : "") +
        "</a>";
    }).join("");
    return '<nav class="cmt-tabs">' + tabs + "</nav>";
  }

  // The newest activity entry's text — the small muted line the nav shows in
  // place of the old static "submitted · awaiting Claude…" hint.
  function latestFeedText() {
    var ev = state.activity || [];
    return ev.length ? (ev[ev.length - 1].summary || "") : "";
  }
  // Answered questions (non-empty value) — for the Send popover summary.
  function answeredCount() {
    return (state.answers || []).filter(function (a) {
      var v = a.value;
      return v != null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0);
    }).length;
  }

  function renderNav() {
    var nav = document.getElementById("cmt-nav") || document.createElement("div");
    nav.id = "cmt-nav"; nav.className = "cmt-nav";
    var appr = state.approval || {};
    var s = appr.state;
    var gated = !approvalOff();
    var n = sendCount(state.comments);

    // Approval-state badge stays on gated pages (approved / changes requested).
    var apprBadge = gated
      ? (s
          ? '<span class="appr-state ' + s + '">' +
            (s === "approved" ? "✓ Approved" : "✎ Changes requested") + "</span>"
          : '<span class="appr-state none">Not submitted</span>')
      : "";
    var latest = latestFeedText();
    var latestHtml = latest
      ? '<span class="cmt-feed-latest" title="' + escapeHtml(latest) + '">' +
        escapeHtml(latest) + "</span>"
      : "";
    // Send disabled only when there is nothing to send AND no gate to exercise;
    // on gated pages "approve with zero comments" is legitimate, so keep it live.
    var sendDisabled = (!gated && n === 0) ? " disabled" : "";
    var sendBtn = '<button class="cmt-btn primary cmt-send" id="cmt-send"' + sendDisabled +
      '>Send to Claude' + (n ? " (" + n + ")" : "") + "</button>";

    nav.innerHTML =
      tabsHtml() +
      '<button class="cmt-nav-btn cmt-mode' + (pickMode ? " active" : "") +
        (nudgeUnused() ? " nudge" : "") + '" id="cmt-mark" ' +
        'title="Comment mode — click an element (C to toggle, Esc to exit). ' +
        'Text quoting needs no mode: just select.">💬 Comment</button>' +
      '<button class="cmt-nav-btn" id="cmt-comments">Comments ' +
        '<span class="count">' + openCount() + "</span></button>" +
      '<span class="cmt-nav-spacer"></span>' +
      latestHtml +
      '<button class="cmt-nav-btn cmt-bell" id="cmt-bell" title="Activity">🔔' +
        '<span class="cmt-bell-dot"></span></button>' +
      apprBadge + sendBtn;
    if (!nav.parentNode) document.body.appendChild(nav);

    var bell = nav.querySelector("#cmt-bell");
    bell.classList.toggle("has-unread", unreadCount() > 0);
    bell.onclick = function (e) { e.stopPropagation(); toggleFeed(); };
    nav.querySelector("#cmt-mark").onclick = function () { setPickMode(!pickMode); };
    nav.querySelector("#cmt-comments").onclick = function () {
      var p = document.getElementById("cmt-panel"); if (p) p.classList.toggle("open");
    };
    var sendEl = nav.querySelector("#cmt-send");
    if (sendEl) sendEl.onclick = function (e) { e.stopPropagation(); openSendPopover(); };
  }

  /* --------------------------- send popover -------------------------- */

  function closeSendPopover() {
    var p = document.getElementById("cmt-sendpop"); if (p) p.remove();
  }
  function openSendPopover() {
    closeSendPopover();
    var n = sendCount(state.comments);
    var gated = !approvalOff();
    var ans = answeredCount();
    var summary = n + " comment" + (n === 1 ? "" : "s") +
      (ans ? " · " + ans + " question" + (ans === 1 ? "" : "s") + " answered" : "");
    var radios = gated
      ? '<div class="cmt-sendpop-decision">' +
        '<label><input type="radio" name="cmt-dec" value="changes-requested"' +
          (n > 0 ? " checked" : "") + "> ✎ Request changes</label>" +
        '<label><input type="radio" name="cmt-dec" value="approved"' +
          (n === 0 ? " checked" : "") + "> ✓ Approve</label></div>"
      : "";
    var pop = document.createElement("div");
    pop.id = "cmt-sendpop"; pop.className = "cmt-sendpop";
    pop.innerHTML =
      '<div class="cmt-sendpop-sum">' + escapeHtml(summary) + "</div>" + radios +
      '<div class="cmt-sendpop-actions">' +
      '<button class="cmt-btn cmt-send-cancel">Cancel</button>' +
      '<button class="cmt-btn primary cmt-send-go">Send</button></div>';
    document.body.appendChild(pop);
    var btn = document.getElementById("cmt-send");
    if (btn) {
      var r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + "px";
      pop.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    }
    pop.querySelector(".cmt-send-cancel").onclick = closeSendPopover;
    pop.querySelector(".cmt-send-go").onclick = function () {
      var decision = null;
      if (gated) {
        var checked = pop.querySelector('input[name="cmt-dec"]:checked');
        decision = checked ? checked.value : (n > 0 ? "changes-requested" : "approved");
      }
      submit(decision, null).then(function () { closeSendPopover(); refreshAll(); });
    };
  }

  /* ------------------------ activity feed & toasts ------------------- */

  var FEED_SEEN_KEY = "cmt-feed-seen::" + location.pathname;
  function feedSeenCount() {
    try { return parseInt(localStorage.getItem(FEED_SEEN_KEY) || "0", 10) || 0; } catch (e) { return 0; }
  }
  function unreadCount() { return Math.max(0, (state.activity || []).length - feedSeenCount()); }
  function markFeedRead() {
    try { localStorage.setItem(FEED_SEEN_KEY, String((state.activity || []).length)); } catch (e) {}
    clearTitleDot();
    var bell = document.getElementById("cmt-bell");
    if (bell) bell.classList.remove("has-unread");
  }

  function hhmm(at) {
    if (!at) return "";
    var d = new Date(at);
    return isNaN(d.getTime())
      ? String(at).slice(11, 16)
      : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function renderFeed(open) {
    var f = document.getElementById("cmt-feed");
    if (!open) { if (f) f.remove(); return; }
    if (!f) { f = document.createElement("div"); f.id = "cmt-feed"; f.className = "cmt-feed"; }
    var ev = (state.activity || []).slice().reverse();     // newest first
    f.innerHTML = ev.length
      ? ev.map(function (e) {
          return '<div class="cmt-feed-ev"><span class="cmt-feed-t">' + escapeHtml(hhmm(e.at)) +
            '</span><span class="cmt-feed-ic">' + feedIcon(e.kind) + '</span>' +
            '<span class="cmt-feed-s">' + escapeHtml(e.summary || e.kind || "") + "</span></div>";
        }).join("")
      : '<div class="cmt-feed-ev cmt-feed-empty">No activity yet.</div>';
    if (!f.parentNode) document.body.appendChild(f);
    var bell = document.getElementById("cmt-bell");
    if (bell) {
      var r = bell.getBoundingClientRect();
      f.style.top = (r.bottom + 6) + "px";
      f.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    }
  }
  function toggleFeed() {
    if (document.getElementById("cmt-feed")) { renderFeed(false); return; }
    renderFeed(true);
    markFeedRead();
  }

  function ensureToasts() {
    var t = document.getElementById("cmt-toasts");
    if (!t) {
      t = document.createElement("div"); t.id = "cmt-toasts"; t.className = "cmt-toasts";
      document.body.appendChild(t);
    }
    return t;
  }
  function toast(msg) {
    var el = document.createElement("div");
    el.className = "cmt-toast"; el.textContent = msg;
    ensureToasts().appendChild(el);
    setTimeout(function () { el.classList.add("out"); }, 3000);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 3400);
  }

  // Title dot when new activity lands on a hidden tab; cleared on focus/open.
  function setTitleDot() { if (document.title.indexOf("● ") !== 0) document.title = "● " + document.title; }
  function clearTitleDot() { if (document.title.indexOf("● ") === 0) document.title = document.title.slice(2); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) clearTitleDot(); });
  window.addEventListener("focus", clearTitleDot);

  // Diff the activity list between loads: toast each fresh event (skipping the
  // initial page load), raise the bell dot, and dot the title if the tab's hidden.
  var prevActivityLen = null;
  function onActivityChanged() {
    var ev = state.activity || [];
    if (prevActivityLen === null) { prevActivityLen = ev.length; return; }   // skip initial load
    if (ev.length > prevActivityLen) {
      ev.slice(prevActivityLen).forEach(function (e) {
        toast(feedIcon(e.kind) + " " + (e.summary || e.kind || ""));
      });
      if (document.hidden) setTitleDot();
      if (document.getElementById("cmt-feed")) markFeedRead();   // dropdown open → mark seen
    }
    prevActivityLen = ev.length;
  }

  /* --------------------- changed-block highlight --------------------- */

  // djb2 over a block's authored innerHTML, kept in localStorage; on the load
  // that follows a page revision, blocks whose hash changed get a brief tint.
  function djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  var BLOCK_HASH_KEY = "cmt-blockhash::" + location.pathname;
  function highlightChangedBlocks() {
    var stored;
    try { stored = JSON.parse(localStorage.getItem(BLOCK_HASH_KEY) || "{}"); } catch (e) { stored = {}; }
    var next = {};
    document.querySelectorAll("[data-block-id]").forEach(function (el) {
      var id = el.getAttribute("data-block-id");
      var h = djb2(el.innerHTML);
      next[id] = h;
      if (stored[id] && stored[id] !== h) {
        el.classList.add("cmt-updated");
        setTimeout(function () { el.classList.remove("cmt-updated"); }, 2200);
      }
    });
    try { localStorage.setItem(BLOCK_HASH_KEY, JSON.stringify(next)); } catch (e) {}
  }

  /* -------------------- outside-click dismissals --------------------- */

  document.addEventListener("mousedown", function (e) {
    var t = e.target;
    var pop = document.getElementById("cmt-sendpop");
    if (pop && !pop.contains(t) && !(t.closest && t.closest("#cmt-send"))) closeSendPopover();
    var feed = document.getElementById("cmt-feed");
    if (feed && !feed.contains(t) && !(t.closest && t.closest("#cmt-bell"))) renderFeed(false);
  }, true);

  /* ----------------------------- lifecycle --------------------------- */

  function renderAll() {
    decorateBlocks(); renderQuestions();
    renderPanel(); renderNav();
    renderTargets();
    onActivityChanged();
    if (document.getElementById("cmt-feed")) renderFeed(true);   // keep it in sync
  }
  function refreshAll() { return loadAll().then(renderAll); }

  /* --------------------------- live refresh -------------------------- */

  function poll() {
    if (!hasServer) return;
    jget(api("version")).then(function (v) {
      // Current page's content digest changed → reload to pick up the revision.
      if (v.pages) {
        var cur = v.pages[curPage], prev = version.pages && version.pages[curPage];
        if (cur !== undefined && prev !== undefined && cur !== prev) { location.reload(); return; }
      } else if (v.plan && version.plan && v.plan !== version.plan) {
        location.reload(); return;                 // legacy fallback
      }
      var changed = ["comments", "answers", "approval", "ack", "activity"].some(function (k) {
        return v[k] !== version[k];
      });
      version = v;
      if (changed) refreshAll();
    }).catch(function () { /* server gone; ignore */ });
  }

  document.addEventListener("DOMContentLoaded", function () {
    highlightChangedBlocks();          // hash authored HTML before we decorate it
    numberAnnotated();
    loadAll().then(function () {
      renderAll();
      if (hasServer) setInterval(poll, 2500);
    });
  });
})();
