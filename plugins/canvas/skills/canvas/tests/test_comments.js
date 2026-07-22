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
const { apiBase, tabHref } = require("../assets/comments.js");

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
