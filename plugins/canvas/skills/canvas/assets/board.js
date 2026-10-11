/* board.js — pan/zoom spatial surface for data-canvas-kind="board" pages. */
(function () {
  "use strict";
  var SMIN = 0.15, SMAX = 3;

  function zoomAt(t, mx, my, factor) {
    var ns = Math.min(SMAX, Math.max(SMIN, t.s * factor));
    return { s: ns, tx: mx - (mx - t.tx) * (ns / t.s),
             ty: my - (my - t.ty) * (ns / t.s) };
  }
  function fitTransform(vw, vh, b, maxScale) {
    var s = Math.min(vw / b.w, vh / b.h, maxScale || 1.6);
    return { s: s, tx: (vw - b.w * s) / 2 - b.x * s,
             ty: (vh - b.h * s) / 2 - b.y * s };
  }
  function worldPoint(sx, sy, t) {
    return { x: (sx - t.tx) / t.s, y: (sy - t.ty) / t.s };
  }
  function boundsOf(frames, margin) {
    margin = margin || 0;
    if (!frames.length) return { x: -margin, y: -margin,
      w: Math.max(1, 2 * margin), h: Math.max(1, 2 * margin) };
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    frames.forEach(function (f) {
      x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y);
      x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h);
    });
    return { x: x0 - margin, y: y0 - margin,
             w: (x1 - x0) + 2 * margin, h: (y1 - y0) + 2 * margin };
  }

  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = { zoomAt: zoomAt, fitTransform: fitTransform,
                       worldPoint: worldPoint, boundsOf: boundsOf };
    return;
  }

  if (document.body.getAttribute("data-canvas-kind") !== "board") return;
  var vp = document.getElementById("viewport");
  var world = document.getElementById("world");
  if (!vp || !world) return;

  var t = { s: 1, tx: 0, ty: 0 };
  function frames() {
    return [].slice.call(world.querySelectorAll("[data-frame-id]")).map(function (el) {
      return { el: el, x: el.offsetLeft, y: el.offsetTop,
               w: el.offsetWidth, h: el.offsetHeight };
    });
  }
  function apply() {
    world.style.transform =
      "translate(" + t.tx + "px," + t.ty + "px) scale(" + t.s + ")";
    var z = document.getElementById("board-zlvl");
    if (z) z.textContent = Math.round(t.s * 100) + "%";
  }
  function fit() {
    var r = vp.getBoundingClientRect();
    t = fitTransform(r.width, r.height, boundsOf(frames(), 60), 1.6);
    apply();
  }
  function focusFrame(id) {
    var f = frames().filter(function (x) {
      return x.el.getAttribute("data-frame-id") === id; })[0];
    if (!f) { fit(); return; }                    // unknown id → fit (review focus #2)
    var r = vp.getBoundingClientRect();
    t = fitTransform(r.width, r.height,
      { x: f.x - 80, y: f.y - 80, w: f.w + 160, h: f.h + 160 }, 2);
    apply();
    f.el.classList.add("board-focus");
  }

  var bar = document.createElement("div");
  bar.className = "board-toolbar";
  bar.innerHTML = '<button type="button" id="board-fit">⛶ Fit</button>' +
    '<button type="button" id="board-zo">−</button>' +
    '<span id="board-zlvl">100%</span>' +
    '<button type="button" id="board-zi">+</button>' +
    '<button type="button" id="board-z100">100%</button>';
  vp.appendChild(bar);
  bar.querySelector("#board-fit").onclick = fit;
  bar.querySelector("#board-z100").onclick = function () { t.s = 1; apply(); };
  function center(f) {
    var r = vp.getBoundingClientRect();
    t = zoomAt(t, r.width / 2, r.height / 2, f); apply();
  }
  bar.querySelector("#board-zi").onclick = function () { center(1.25); };
  bar.querySelector("#board-zo").onclick = function () { center(0.8); };

  vp.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = vp.getBoundingClientRect();
    t = zoomAt(t, e.clientX - r.left, e.clientY - r.top,
               Math.exp(-e.deltaY * 0.0015));
    apply();
  }, { passive: false });

  var drag = null;
  vp.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".board-toolbar, .board-pin")) return;
    drag = { x: e.clientX, y: e.clientY };
    vp.classList.add("panning");
    vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener("pointermove", function (e) {
    if (!drag) return;
    t.tx += e.clientX - drag.x; t.ty += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    apply();
  });
  vp.addEventListener("pointerup", function () {
    drag = null; vp.classList.remove("panning");
  });

  window.CanvasBoard = {
    getTransform: function () { return t; },
    worldFromClient: function (cx, cy) {
      var r = vp.getBoundingClientRect();
      return worldPoint(cx - r.left, cy - r.top, t);
    },
    refresh: apply, fit: fit,
  };

  if (location.hash) focusFrame(location.hash.slice(1)); else fit();
})();
