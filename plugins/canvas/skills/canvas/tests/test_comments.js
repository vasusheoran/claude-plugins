/* Behavior tests for the comments.js pure core (apiBase(pathname) -> string).
 *
 * Contract: the review API is addressed relative to the directory of the
 * current page, so one shared asset works both served at root by serve.py
 * (/plan.html -> /api/…) and under a canvasd workspace prefix
 * (/w/<key>/plan.html -> /w/<key>/api/…). No DOM — run with:
 *   node tests/test_comments.js
 */
"use strict";
const assert = require("assert");
const {
  apiBase, tabHref,
  normalizeState, groupComments, feedIcon, sendCount, seenChip,
  tabIcon, pageKind,
} = require("../assets/comments.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n     " + e.message); }
}

test("root-served page (standalone serve.py) resolves to /", () => {
  assert.strictEqual(apiBase("/plan.html"), "/");
});

test("workspace-prefixed page resolves to its workspace dir", () => {
  assert.strictEqual(apiBase("/w/canvas-mcp-a1b2/plan.html"), "/w/canvas-mcp-a1b2/");
});

test("other artifacts in a workspace share the same base", () => {
  assert.strictEqual(apiBase("/w/k/mockup-a.html"), "/w/k/");
});

test("directory URL keeps its own path", () => {
  assert.strictEqual(apiBase("/w/k/"), "/w/k/");
});

test("bare root", () => {
  assert.strictEqual(apiBase("/"), "/");
});

test("degenerate inputs fall back to root", () => {
  assert.strictEqual(apiBase(""), "/");
  assert.strictEqual(apiBase(null), "/");
  assert.strictEqual(apiBase(undefined), "/");
});

test("base always ends with a slash (api paths append cleanly)", () => {
  ["/plan.html", "/w/x/plan.html", "/", ""].forEach((p) => {
    assert.ok(apiBase(p).endsWith("/"), p);
  });
});

// Tab links must stay inside the workspace prefix — a root-absolute
// href ("/mockup-a.html") escapes /w/<key>/ and 404s on canvasd.
test("tab links keep the canvasd workspace prefix", () => {
  assert.strictEqual(tabHref("/w/k/plan.html", "mockup-a.html"), "/w/k/mockup-a.html");
});

test("tab links from a workspace directory URL", () => {
  assert.strictEqual(tabHref("/w/k/", "plan.html"), "/w/k/plan.html");
});

test("tab links on a root-served page (standalone serve.py)", () => {
  assert.strictEqual(tabHref("/plan.html", "mockup-a.html"), "/mockup-a.html");
});

/* ---- v2 review-state helpers ---------------------------------------- */

// normalizeState: the server "state" field wins; legacy entries (no state)
// map by status — "resolved" → resolved, anything else → sent.
test("normalizeState: explicit state wins", () => {
  assert.strictEqual(normalizeState({ state: "pending" }), "pending");
  assert.strictEqual(normalizeState({ state: "sent" }), "sent");
  assert.strictEqual(normalizeState({ state: "resolved" }), "resolved");
});

test("normalizeState: state beats a stale legacy status", () => {
  assert.strictEqual(normalizeState({ state: "pending", status: "resolved" }), "pending");
});

test("normalizeState: legacy status maps (open→sent, resolved→resolved)", () => {
  assert.strictEqual(normalizeState({ status: "open" }), "sent");
  assert.strictEqual(normalizeState({ status: "resolved" }), "resolved");
});

test("normalizeState: neither state nor status → sent", () => {
  assert.strictEqual(normalizeState({}), "sent");
  assert.strictEqual(normalizeState(null), "sent");
});

test("normalizeState: unknown state value falls back to legacy mapping", () => {
  assert.strictEqual(normalizeState({ state: "bogus", status: "resolved" }), "resolved");
  assert.strictEqual(normalizeState({ state: "bogus" }), "sent");
});

// groupComments: top-level only, page-filtered unless showAll, split by state.
const SAMPLE = [
  { id: "a", parentId: null, state: "pending", page: "plan.html" },
  { id: "b", parentId: null, state: "sent", page: "plan.html", sentAt: "2026-01-01T00:00:00Z" },
  { id: "c", parentId: null, status: "resolved", page: "plan.html" },
  { id: "d", parentId: "a", state: "pending", page: "plan.html" },        // reply
  { id: "e", parentId: null, state: "pending", page: "mockup.html" },     // other page
  { id: "f", parentId: null },                                            // legacy → sent, plan.html
];

test("groupComments: current page only, replies excluded, split by state", () => {
  const g = groupComments(SAMPLE, "plan.html", false);
  assert.deepStrictEqual(g.pending.map((c) => c.id), ["a"]);
  assert.deepStrictEqual(g.sent.map((c) => c.id), ["b", "f"]);
  assert.deepStrictEqual(g.resolved.map((c) => c.id), ["c"]);
});

test("groupComments: showAll pulls in other pages' top-level comments", () => {
  const g = groupComments(SAMPLE, "plan.html", true);
  assert.deepStrictEqual(g.pending.map((c) => c.id), ["a", "e"]);
  assert.deepStrictEqual(g.sent.map((c) => c.id), ["b", "f"]);
});

test("groupComments: legacy comment with no page counts as plan.html", () => {
  const g = groupComments([{ id: "f", parentId: null }], "plan.html", false);
  assert.deepStrictEqual(g.sent.map((c) => c.id), ["f"]);
  const none = groupComments([{ id: "f", parentId: null }], "mockup.html", false);
  assert.deepStrictEqual(none.sent, []);
});

test("groupComments: empty / missing input yields empty groups", () => {
  assert.deepStrictEqual(groupComments(null, "plan.html", false), { pending: [], sent: [], resolved: [] });
});

// feedIcon: activity-event kind → glyph, "•" fallback.
test("feedIcon: known kinds map to their glyphs", () => {
  assert.strictEqual(feedIcon("submitted"), "↑");
  assert.strictEqual(feedIcon("picked-up"), "✓");
  assert.strictEqual(feedIcon("replied"), "↩");
  assert.strictEqual(feedIcon("resolved"), "✔");
  assert.strictEqual(feedIcon("page-updated"), "✎");
  assert.strictEqual(feedIcon("acked"), "★");
});

test("feedIcon: unknown kind falls back to a bullet", () => {
  assert.strictEqual(feedIcon("whatever"), "•");
  assert.strictEqual(feedIcon(undefined), "•");
});

// sendCount: open pending top-level drafts across ALL pages.
test("sendCount: counts pending top-level drafts on every page", () => {
  assert.strictEqual(sendCount(SAMPLE), 2);   // a (plan) + e (mockup); d is a reply
});

test("sendCount: none pending → 0", () => {
  assert.strictEqual(sendCount([{ parentId: null, state: "sent" }, { parentId: null, status: "resolved" }]), 0);
  assert.strictEqual(sendCount([]), 0);
  assert.strictEqual(sendCount(null), 0);
});

// seenChip: pending drafts stay "pending"; sent ones flip to "seen" once the
// workspace ack covers their sentAt, else "awaiting".
test("seenChip: pending draft reports pending", () => {
  assert.strictEqual(seenChip({ state: "pending", sentAt: null }, {}), "pending");
});

test("seenChip: sent + ack.decidedAt >= sentAt → seen", () => {
  const c = { state: "sent", sentAt: "2026-01-01T00:00:00Z" };
  assert.strictEqual(seenChip(c, { decidedAt: "2026-01-02T00:00:00Z" }), "seen");
  assert.strictEqual(seenChip(c, { decidedAt: "2026-01-01T00:00:00Z" }), "seen");
});

test("seenChip: sent + stale-or-missing ack → awaiting", () => {
  const c = { state: "sent", sentAt: "2026-01-02T00:00:00Z" };
  assert.strictEqual(seenChip(c, { decidedAt: "2026-01-01T00:00:00Z" }), "awaiting");
  assert.strictEqual(seenChip(c, {}), "awaiting");
  assert.strictEqual(seenChip(c, null), "awaiting");
});

// tabIcon / pageKind: typed-tab kind → glyph, and the kind fallback for old
// servers whose /api/pages entries carry no "kind".
test("tabIcon: known kinds map, unknown falls back to doc glyph", () => {
  assert.strictEqual(tabIcon("plan"), "📋");
  assert.strictEqual(tabIcon("mockup"), "🧩");
  assert.strictEqual(tabIcon("diagram"), "⇄");
  assert.strictEqual(tabIcon("decision"), "◆");
  assert.strictEqual(tabIcon("doc"), "📄");
  assert.strictEqual(tabIcon("weird"), "📄");
});

test("pageKind: explicit kind wins; else plan.html→plan, other→doc", () => {
  assert.strictEqual(pageKind({ file: "x.html", kind: "diagram" }), "diagram");
  assert.strictEqual(pageKind({ file: "plan.html" }), "plan");
  assert.strictEqual(pageKind({ file: "mockup-a.html" }), "doc");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
