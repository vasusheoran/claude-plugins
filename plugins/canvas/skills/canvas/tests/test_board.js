"use strict";
const assert = require("assert");
const { zoomAt, fitTransform, worldPoint, boundsOf } = require("../assets/board.js");
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n     " + e.message); }
}

test("zoomAt keeps the cursor's world point fixed", () => {
  const t = { s: 1, tx: 0, ty: 0 };
  const t2 = zoomAt(t, 100, 50, 2);
  // world point under (100,50) before: (100,50); after must map back to (100,50)
  assert.strictEqual(Math.round(100 * t2.s + t2.tx), 100);
  assert.strictEqual(Math.round(50 * t2.s + t2.ty), 50);
  assert.strictEqual(t2.s, 2);
});

test("zoomAt clamps to [0.15, 3]", () => {
  assert.strictEqual(zoomAt({ s: 2.9, tx: 0, ty: 0 }, 0, 0, 2).s, 3);
  assert.strictEqual(zoomAt({ s: 0.2, tx: 0, ty: 0 }, 0, 0, 0.1).s, 0.15);
});

test("fitTransform centers the bounds", () => {
  const t = fitTransform(1000, 500, { x: 0, y: 0, w: 500, h: 500 }, 1.6);
  assert.strictEqual(t.s, 1);                       // limited by height
  assert.strictEqual(t.tx, 250);                    // centered horizontally
  assert.strictEqual(t.ty, 0);
});

test("worldPoint inverts the transform", () => {
  const t = { s: 2, tx: 10, ty: -4 };
  const w = worldPoint(110, 96, t);
  assert.deepStrictEqual(w, { x: 50, y: 50 });
});

test("boundsOf wraps frames with margin", () => {
  const b = boundsOf([{ x: 0, y: 0, w: 100, h: 100 },
                      { x: 300, y: 50, w: 100, h: 100 }], 40);
  assert.deepStrictEqual(b, { x: -40, y: -40, w: 480, h: 230 });
});

test("boundsOf of nothing is a unit box (fit never divides by zero)", () => {
  const b = boundsOf([], 40);
  assert.ok(b.w > 0 && b.h > 0);
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
