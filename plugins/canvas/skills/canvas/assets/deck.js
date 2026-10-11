/* deck.js — stepper presentation for data-canvas-kind="deck" pages.
 * Layers over the existing question blocks; persistence stays in comments.js.
 * Pure core exported for node tests, same pattern as comments.js. */
(function () {
  "use strict";

  function isAnswered(a) {
    if (!a || a.value == null) return false;
    return Array.isArray(a.value) ? a.value.length > 0 : String(a.value).length > 0;
  }

  function deckModel(questionIds, answers) {
    var byId = {};
    (answers || []).forEach(function (a) { byId[a.questionId] = a; });
    var open = -1;
    var states = questionIds.map(function (id, i) {
      if (isAnswered(byId[id])) return "answered";
      if (open === -1) { open = i; return "current"; }
      return "upcoming";
    });
    return {
      states: states, current: open,
      answered: states.filter(function (s) { return s === "answered"; }).length,
      total: questionIds.length,
      allDone: questionIds.length > 0 && open === -1,
    };
  }

  function shouldPrompt(prevDone, nowDone, alreadyShown) {
    return !prevDone && nowDone && !alreadyShown;
  }

  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = { deckModel: deckModel, isAnswered: isAnswered, shouldPrompt: shouldPrompt };
    return;
  }

  if (document.body.getAttribute("data-canvas-kind") !== "deck") return;

  var answers = [], focusOverride = null, railEl = null;

  function sections() {
    return [].slice.call(
      document.querySelectorAll("section.block.question[data-question-id]"));
  }
  function qids() {
    return sections().map(function (s) { return s.getAttribute("data-question-id"); });
  }
  function answerFor(qid) {
    return answers.filter(function (a) { return a.questionId === qid; })[0];
  }

  function ensureRail() {
    if (railEl || !sections().length) return;
    railEl = document.createElement("div");
    railEl.className = "deck-rail";
    var first = sections()[0];
    first.parentNode.insertBefore(railEl, first);
    var foot = document.createElement("div");
    foot.className = "deck-foot";
    foot.innerHTML =
      '<button class="deck-accept" type="button">Accept Claude’s picks for the rest</button>' +
      '<span class="deck-kbd-hint">1–9 pick · tap a ✓ row to reopen</span>';
    var last = sections()[sections().length - 1];
    last.parentNode.insertBefore(foot, last.nextSibling);
    foot.querySelector(".deck-accept").onclick = acceptRemaining;
  }

  function acceptRemaining() {
    sections().forEach(function (sec) {
      var qid = sec.getAttribute("data-question-id");
      if (isAnswered(answerFor(qid))) return;
      var lean = sec.querySelector(".qopt[data-lean]") || sec.querySelector(".qopt");
      if (lean) lean.click();                 // existing widget saves the answer
    });
  }

  function render() {
    var secs = sections();
    if (!secs.length) return;
    ensureRail();
    var m = deckModel(qids(), answers);
    secs.forEach(function (sec, i) {
      var st = m.states[i];
      if (focusOverride === i && st === "answered") st = "current";
      sec.classList.remove("deck-answered", "deck-current", "deck-upcoming");
      sec.classList.add("deck-" + (st === "answered" ? "answered"
        : st === "current" ? "current" : "upcoming"));
      var h = sec.querySelector("h2, h3");
      if (h && !h.__deckBound) {
        h.__deckBound = true;
        h.style.cursor = "pointer";
        h.addEventListener("click", function () { focusOverride = i; render(); });
      }
    });
    railEl.innerHTML =
      '<span class="deck-count">' + m.answered + " / " + m.total + " answered</span>" +
      m.states.map(function (s) {
        return '<span class="deck-seg ' + s + '"></span>';
      }).join("");
    document.body.classList.toggle("deck-done", m.allDone);
  }

  document.addEventListener("canvas:state", function (e) {
    answers = (e.detail && e.detail.answers) || [];
    focusOverride = null;                     // new data wins over a manual reopen
    render();
    maybeFinishPrompt();                      // defined in Task 9; no-op until then
  });

  document.addEventListener("keydown", function (e) {
    if (!/^[1-9]$/.test(e.key)) return;
    if (e.target.closest && e.target.closest("input,textarea")) return;
    var cur = document.querySelector("section.block.question.deck-current");
    if (!cur) return;
    var opt = cur.querySelectorAll(
      ":scope > .qopt, :scope .qopts > .qopt")[+e.key - 1];
    if (opt) opt.click();
  });

  var _finishShown = false;
  var _prevDone = null;
  function maybeFinishPrompt() {
    var m = deckModel(qids(), answers);
    if (_prevDone === null) { _prevDone = m.allDone; return; }
    if (shouldPrompt(_prevDone, m.allDone, _finishShown)) {
      _finishShown = true;
      if (window.CanvasReview && window.CanvasReview.openSend)
        window.CanvasReview.openSend();
    }
    _prevDone = m.allDone;
  }

  window.CanvasDeck = { refresh: render };
  render();
})();
