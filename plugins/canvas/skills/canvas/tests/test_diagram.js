/* Behavior tests for the diagram.js pure core (render(spec, uid) -> SVG string).
 *
 * These define the contract: declarative JSON specs render deterministic,
 * token-styled SVG with stable data-cmt-id anchors on participants/nodes and
 * on messages that declare an id. No DOM — run with:  node tests/test_diagram.js
 */
"use strict";
const assert = require("assert");
const { render } = require("../assets/diagram.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n     " + e.message); }
}

/* ------------------------------ fixtures ------------------------------ */

const SEQ = {
  type: "sequence",
  participants: [
    { id: "p-a", label: "Browser" },
    { id: "p-b", label: "serve.py" },
    { id: "p-c", label: "Claude" },
  ],
  messages: [
    { id: "m-1", from: "p-a", to: "p-b", label: "POST /api/approval" },
    { from: "p-b", to: "p-c", label: "wake" },
    { id: "m-3", from: "p-c", to: "p-a", label: "ack", style: "return" },
  ],
};

const FLOW = {
  type: "flow",
  nodes: [
    { id: "f-start", label: "pointer-up", kind: "start", col: 0, row: 0 },
    { id: "f-alt", label: "Alt held?", kind: "decision", col: 1, row: 0 },
    { id: "f-pin", label: "point pin", kind: "step", col: 2, row: 0 },
    { id: "f-el", label: "element anchor", kind: "step", col: 2, row: 1 },
  ],
  edges: [
    { from: "f-start", to: "f-alt" },
    { from: "f-alt", to: "f-pin", label: "yes" },
    { from: "f-alt", to: "f-el", label: "no" },
  ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------ shared -------------------------------- */

test("returns an <svg> with a viewBox", () => {
  for (const spec of [SEQ, FLOW]) {
    const svg = render(spec);
    assert.match(svg, /^<svg[^>]*viewBox="0 0 \d+ \d+"/);
    assert.ok(svg.trim().endsWith("</svg>"));
  }
});

test("styles come from CSS tokens, never hex", () => {
  for (const spec of [SEQ, FLOW]) {
    const svg = render(spec);
    assert.ok(svg.includes("var(--"), "expected var(--…) tokens");
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(svg), "hard-coded hex found");
  }
});

test("labels are HTML-escaped", () => {
  const s = clone(SEQ);
  s.participants[0].label = '<b>x&y</b>"z"';
  const svg = render(s);
  assert.ok(svg.includes("&lt;b&gt;x&amp;y&lt;/b&gt;"), "escaped label missing");
  assert.ok(!svg.includes("<b>x&y</b>"), "raw label leaked");
});

test("marker ids are namespaced by the uid argument (multi-diagram pages)", () => {
  const svg = render(SEQ, "x7");
  assert.ok(svg.includes('id="arw-x7"'), "marker id not namespaced");
  assert.ok(svg.includes("url(#arw-x7)"), "marker reference not namespaced");
  const first = render(SEQ); // default uid still works and is self-consistent
  const m = first.match(/id="(arw-[\w-]+)"/);
  assert.ok(m && first.includes("url(#" + m[1] + ")"));
});

test("unknown type throws", () => {
  assert.throws(() => render({ type: "gantt" }), /type/i);
});

/* ----------------------------- sequence ------------------------------- */

test("sequence: every participant is a data-cmt-id group with label + lifeline", () => {
  const svg = render(SEQ);
  for (const p of SEQ.participants) {
    assert.ok(svg.includes('data-cmt-id="' + p.id + '"'), p.id + " anchor missing");
    assert.ok(svg.includes('data-cmt-label="' + p.label + '"'), p.id + " label attr missing");
  }
  assert.strictEqual((svg.match(/stroke-dasharray/g) || []).length >= 3, true,
    "expected dashed lifelines");
});

test("sequence: message lines carry class 'msg' and y increases with order", () => {
  const svg = render(SEQ);
  const ys = [...svg.matchAll(/<line class="msg[^"]*"[^>]*y1="(\d+(?:\.\d+)?)"/g)]
    .map((m) => parseFloat(m[1]));
  assert.strictEqual(ys.length, SEQ.messages.length, "one msg line per message");
  for (let i = 1; i < ys.length; i++)
    assert.ok(ys[i] > ys[i - 1], "message y not increasing at index " + i);
});

test("sequence: style 'return' renders dashed with class 'msg return'", () => {
  const svg = render(SEQ);
  const ret = svg.match(/<line class="msg return"[^>]*>/);
  assert.ok(ret, "return message line missing");
  assert.ok(ret[0].includes("stroke-dasharray"), "return message not dashed");
});

test("sequence: message anchors only when the spec declares an id", () => {
  const svg = render(SEQ);
  assert.ok(svg.includes('data-cmt-id="m-1"'));
  assert.ok(svg.includes('data-cmt-id="m-3"'));
  const anchored = (svg.match(/data-cmt-id="m-/g) || []).length;
  assert.strictEqual(anchored, 2, "id-less message must not synthesize an anchor");
});

test("sequence: unknown participant reference throws", () => {
  const s = clone(SEQ);
  s.messages.push({ from: "p-a", to: "p-nope", label: "x" });
  assert.throws(() => render(s), /p-nope/);
});

test("sequence: duplicate participant ids throw", () => {
  const s = clone(SEQ);
  s.participants.push({ id: "p-a", label: "dup" });
  assert.throws(() => render(s), /duplicate/i);
});

test("sequence: participant id is required", () => {
  const s = clone(SEQ);
  delete s.participants[1].id;
  assert.throws(() => render(s), /id/i);
});

/* ------------------------------- flow ---------------------------------- */

test("flow: every node is a data-cmt-id group", () => {
  const svg = render(FLOW);
  for (const n of FLOW.nodes)
    assert.ok(svg.includes('data-cmt-id="' + n.id + '"'), n.id + " anchor missing");
});

test("flow: node kinds map to shapes — step rect, decision diamond path, start pill", () => {
  const svg = render(FLOW);
  assert.match(svg, /<rect class="node step"/);
  assert.match(svg, /<path class="node decision"/);
  const start = svg.match(/<rect class="node start"[^>]*>/);
  assert.ok(start, "start rect missing");
  const rx = parseFloat(start[0].match(/rx="(\d+(?:\.\d+)?)"/)[1]);
  const h = parseFloat(start[0].match(/height="(\d+(?:\.\d+)?)"/)[1]);
  assert.strictEqual(rx, h / 2, "start node must be a pill (rx = height/2)");
});

test("flow: edges render with class 'edge' and labelled edges emit their label", () => {
  const svg = render(FLOW);
  const edges = (svg.match(/<path class="edge"/g) || []).length;
  assert.strictEqual(edges, FLOW.edges.length);
  assert.match(svg, /class="edge-label[^"]*"[^>]*>yes</);
  assert.match(svg, /class="edge-label[^"]*"[^>]*>no</);
});

test("flow: edge to an unknown node throws", () => {
  const f = clone(FLOW);
  f.edges.push({ from: "f-start", to: "f-ghost" });
  assert.throws(() => render(f), /f-ghost/);
});

test("flow: node requires col and row", () => {
  const f = clone(FLOW);
  delete f.nodes[2].row;
  assert.throws(() => render(f), /row/i);
});

test("flow: duplicate node ids throw", () => {
  const f = clone(FLOW);
  f.nodes.push({ id: "f-pin", label: "dup", kind: "step", col: 0, row: 1 });
  assert.throws(() => render(f), /duplicate/i);
});

/* ------------------------------ summary -------------------------------- */

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
