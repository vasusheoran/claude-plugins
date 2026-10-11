"use strict";
const assert = require("assert");
const { deckModel, isAnswered } = require("../assets/deck.js");
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n     " + e.message); }
}

test("isAnswered: scalars, arrays, empties", () => {
  assert.ok(isAnswered({ value: "a" }));
  assert.ok(isAnswered({ value: ["a"] }));
  assert.ok(isAnswered({ value: "__defer__" }));
  assert.ok(!isAnswered({ value: "" }));
  assert.ok(!isAnswered({ value: [] }));
  assert.ok(!isAnswered({ value: null }));
  assert.ok(!isAnswered(undefined));
});

test("first open question is current, later ones upcoming", () => {
  const m = deckModel(["q1", "q2", "q3"], [{ questionId: "q1", value: "x" }]);
  assert.deepStrictEqual(m.states, ["answered", "current", "upcoming"]);
  assert.strictEqual(m.current, 1);
  assert.strictEqual(m.answered, 1);
  assert.ok(!m.allDone);
});

test("all answered -> allDone, current -1", () => {
  const m = deckModel(["q1"], [{ questionId: "q1", value: "x" }]);
  assert.ok(m.allDone);
  assert.strictEqual(m.current, -1);
});

test("zero questions is NOT allDone (review focus #1)", () => {
  const m = deckModel([], []);
  assert.ok(!m.allDone);
  assert.strictEqual(m.total, 0);
});

test("multi and freeform answers count once non-empty (review focus)", () => {
  assert.deepStrictEqual(
    deckModel(["q"], [{ questionId: "q", value: ["a", "b"] }]).states, ["answered"]);
  assert.deepStrictEqual(
    deckModel(["q"], [{ questionId: "q", value: "typed text" }]).states, ["answered"]);
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
