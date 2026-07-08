/**
 * diagram.js — Renders sequence diagrams and flowcharts from declarative JSON
 * specs into self-contained SVG strings.
 *
 * Supported spec shapes:
 *   { type:"sequence", participants:[{id,label}], messages:[{from,to,label,id?,style?}] }
 *   { type:"flow", nodes:[{id,label,kind?,col,row}], edges:[{from,to,label?}] }
 *
 * Auto-mount (browser only): on DOMContentLoaded, finds every
 *   <script type="application/json" data-diagram> tag, renders its JSON,
 *   and replaces it with <div class="diagram-svg">…svg…</div> (or
 *   <div class="diagram-error">…message…</div> on failure). Never throws.
 *
 * Usage (script tag):  CanvasDiagram.render(spec, uid?) → SVG string
 * Usage (node):        const { render } = require('./diagram.js')
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ utils */

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------------------------------------------------------- marker */

  function markerDef(uid) {
    return (
      '<defs>' +
      '<marker id="arw-' + uid + '" viewBox="0 0 10 10" refX="9" refY="5"' +
      ' markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="var(--line-strong)"/>' +
      '</marker>' +
      '</defs>'
    );
  }

  /* ------------------------------------------------------------ sequence */

  /*
   * Layout constants (sequence):
   *   PARTICIPANT_W = 100, PARTICIPANT_H = 34, rx = 7
   *   PITCH = 120 (center-to-center spacing)
   *   MARGIN_X = 20 (left offset to first center)
   *   HEADER_Y = 20 (top of participant box)
   *   FIRST_MSG_Y = 80 (y of first message line, below box bottom at 54)
   *   MSG_PITCH = 36 (vertical spacing between messages)
   *   DIAGRAM_BOTTOM_MARGIN = 20 (extra below last message)
   */
  var SEQ = {
    PW: 100, PH: 34, RX: 7,
    PITCH: 120,
    MARGIN_X: 20,
    HEADER_Y: 20,
    FIRST_MSG_Y: 80,
    MSG_PITCH: 36,
    BOTTOM_MARGIN: 20
  };

  function renderSequence(spec, uid) {
    var participants = spec.participants || [];
    var messages = spec.messages || [];

    // Validate participants
    var idSet = Object.create(null);
    for (var pi = 0; pi < participants.length; pi++) {
      var p = participants[pi];
      if (!p.id) throw new Error("participant at index " + pi + " is missing an id");
      if (idSet[p.id]) throw new Error("duplicate participant id: " + p.id);
      idSet[p.id] = true;
    }

    // Build index: id -> center x
    var cx = Object.create(null);
    for (var i = 0; i < participants.length; i++) {
      cx[participants[i].id] = SEQ.MARGIN_X + i * SEQ.PITCH;
    }

    // Validate messages
    for (var mi = 0; mi < messages.length; mi++) {
      var msg = messages[mi];
      if (msg.from === msg.to) {
        throw new Error("self-messages are not supported (participant: " + msg.from + ")");
      }
      if (!(msg.from in cx)) throw new Error("unknown participant ref: " + msg.from);
      if (!(msg.to in cx)) throw new Error("unknown participant ref: " + msg.to);
    }

    // Compute diagram dimensions
    var totalWidth = SEQ.MARGIN_X * 2 + (participants.length - 1) * SEQ.PITCH + SEQ.PW;
    var lastMsgY = SEQ.FIRST_MSG_Y + (messages.length - 1) * SEQ.MSG_PITCH;
    var diagramBottom = lastMsgY + SEQ.MSG_PITCH + SEQ.BOTTOM_MARGIN;
    var totalHeight = diagramBottom + SEQ.BOTTOM_MARGIN;

    // Add 20px margin on all sides for viewBox
    var vbW = totalWidth + 40;
    var vbH = totalHeight + 20;

    var arwRef = "url(#arw-" + uid + ")";
    var parts = [];

    parts.push(
      '<svg viewBox="0 0 ' + vbW + ' ' + vbH + '" role="img"' +
      ' xmlns="http://www.w3.org/2000/svg"' +
      ' style="font-family:var(--sans);font-size:13px">'
    );
    parts.push(markerDef(uid));

    // Participant boxes + lifelines (with offset for 20px left margin in viewBox)
    var offsetX = 20;
    var offsetY = 20;

    for (var pi2 = 0; pi2 < participants.length; pi2++) {
      var pt = participants[pi2];
      var centerX = cx[pt.id] + offsetX;
      var boxX = centerX - SEQ.PW / 2;
      var boxY = SEQ.HEADER_Y + offsetY;
      var boxBottom = boxY + SEQ.PH;

      parts.push(
        '<g data-cmt-id="' + esc(pt.id) + '" data-cmt-label="' + esc(pt.label) + '">'
      );
      // Header box
      parts.push(
        '<rect x="' + boxX + '" y="' + boxY + '" width="' + SEQ.PW + '" height="' + SEQ.PH + '"' +
        ' rx="' + SEQ.RX + '" fill="var(--bg-soft)" stroke="var(--line)"/>'
      );
      parts.push(
        '<text x="' + centerX + '" y="' + (boxY + SEQ.PH / 2 + 5) + '"' +
        ' text-anchor="middle" fill="var(--ink)">' + esc(pt.label) + '</text>'
      );
      // Dashed lifeline from box bottom to diagram bottom
      parts.push(
        '<line x1="' + centerX + '" y1="' + boxBottom + '"' +
        ' x2="' + centerX + '" y2="' + (diagramBottom + offsetY) + '"' +
        ' stroke="var(--line)" stroke-dasharray="4 4"/>'
      );
      parts.push('</g>');
    }

    // Messages
    for (var mi2 = 0; mi2 < messages.length; mi2++) {
      var msg2 = messages[mi2];
      var msgY = SEQ.FIRST_MSG_Y + mi2 * SEQ.MSG_PITCH + offsetY;
      var fromX = cx[msg2.from] + offsetX;
      var toX = cx[msg2.to] + offsetX;
      var isReturn = msg2.style === "return";

      // Direction: stop ~2px short of target lifeline
      var dir = toX > fromX ? 1 : -1;
      var lineEndX = toX - dir * 2;

      var lineClass = isReturn ? 'msg return' : 'msg';
      var dashAttr = isReturn ? ' stroke-dasharray="6 3"' : '';

      var wrapGroup = !!msg2.id;
      if (wrapGroup) {
        var cmtLabel = msg2.label != null ? msg2.label : msg2.id;
        parts.push(
          '<g data-cmt-id="' + esc(msg2.id) + '" data-cmt-label="' + esc(cmtLabel) + '">'
        );
      }

      // Message line
      parts.push(
        '<line class="' + lineClass + '"' +
        ' x1="' + fromX + '" y1="' + msgY + '"' +
        ' x2="' + lineEndX + '" y2="' + msgY + '"' +
        ' stroke="var(--line-strong)"' + dashAttr +
        ' marker-end="' + arwRef + '"/>'
      );

      // Label above line, centered
      var labelX = (fromX + toX) / 2;
      if (msg2.label) {
        parts.push(
          '<text x="' + labelX + '" y="' + (msgY - 4) + '"' +
          ' text-anchor="middle" fill="var(--ink)">' + esc(msg2.label) + '</text>'
        );
      }

      if (wrapGroup) parts.push('</g>');
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  /* --------------------------------------------------------------- flow */

  /*
   * Layout constants (flow):
   *   NODE_W = 170, NODE_H = 48
   *   COL_PITCH = 215 (center-to-center)
   *   ROW_PITCH = 100 (center-to-center)
   *   MARGIN = 20
   *   Decision rhombus: ±85 x, ±28 y around center
   */
  var FLOW = {
    NW: 170, NH: 48,
    COL_PITCH: 215,
    ROW_PITCH: 100,
    MARGIN: 20
  };

  function nodeCenter(node) {
    return {
      x: FLOW.MARGIN + node.col * FLOW.COL_PITCH + FLOW.NW / 2,
      y: FLOW.MARGIN + node.row * FLOW.ROW_PITCH + FLOW.NH / 2
    };
  }

  function renderFlow(spec, uid) {
    var nodes = spec.nodes || [];
    var edges = spec.edges || [];

    // Validate nodes
    var nodeMap = Object.create(null);
    for (var ni = 0; ni < nodes.length; ni++) {
      var n = nodes[ni];
      if (!n.id) throw new Error("node at index " + ni + " is missing an id");
      if (nodeMap[n.id]) throw new Error("duplicate node id: " + n.id);
      if (n.col == null) throw new Error("node '" + n.id + "' is missing col");
      if (n.row == null) throw new Error("node '" + n.id + "' is missing row");
      var kind = n.kind || "step";
      nodeMap[n.id] = { id: n.id, label: n.label || "", kind: kind, col: n.col, row: n.row };
    }

    // Validate edges
    for (var ei = 0; ei < edges.length; ei++) {
      var e = edges[ei];
      if (!nodeMap[e.from]) throw new Error("unknown node ref in edge: " + e.from);
      if (!nodeMap[e.to]) throw new Error("unknown node ref in edge: " + e.to);
    }

    // Compute extents
    var maxCol = 0, maxRow = 0;
    for (var ni2 = 0; ni2 < nodes.length; ni2++) {
      if (nodes[ni2].col > maxCol) maxCol = nodes[ni2].col;
      if (nodes[ni2].row > maxRow) maxRow = nodes[ni2].row;
    }
    var totalW = FLOW.MARGIN * 2 + maxCol * FLOW.COL_PITCH + FLOW.NW + 20;
    var totalH = FLOW.MARGIN * 2 + maxRow * FLOW.ROW_PITCH + FLOW.NH + 20;
    // Add 20px viewBox margin
    var vbW = totalW + 40;
    var vbH = totalH + 40;

    var arwRef = "url(#arw-" + uid + ")";
    var parts = [];

    parts.push(
      '<svg viewBox="0 0 ' + vbW + ' ' + vbH + '" role="img"' +
      ' xmlns="http://www.w3.org/2000/svg"' +
      ' style="font-family:var(--sans);font-size:13px">'
    );
    parts.push(markerDef(uid));

    var offsetX = 20;
    var offsetY = 20;

    // Render edges first (behind nodes)
    for (var ei2 = 0; ei2 < edges.length; ei2++) {
      var edge = edges[ei2];
      var fromNode = nodeMap[edge.from];
      var toNode = nodeMap[edge.to];
      var fc = nodeCenter(fromNode);
      var tc = nodeCenter(toNode);
      var fX = fc.x + offsetX, fY = fc.y + offsetY;
      var tX = tc.x + offsetX, tY = tc.y + offsetY;

      var pathD;
      var labelX, labelY, labelAnchor;

      if (fromNode.row === toNode.row) {
        // Same row — straight horizontal from source right edge to target left edge
        var srcRight = fX + FLOW.NW / 2;
        var tgtLeft = tX - FLOW.NW / 2;
        pathD = "M" + srcRight + "," + fY + " L" + tgtLeft + "," + tY;
        labelX = srcRight + 8;
        labelY = fY - 8;
        labelAnchor = "start";
      } else if (fromNode.col === toNode.col) {
        // Same column — straight vertical
        var srcBottom = fY + FLOW.NH / 2;
        var tgtTop = tY - FLOW.NH / 2;
        pathD = "M" + fX + "," + srcBottom + " L" + tX + "," + tgtTop;
        labelX = fX + 8;
        labelY = srcBottom + 16;
        labelAnchor = "start";
      } else {
        // Different row + col — orthogonal L: down from source, then across to target
        var srcEdgeY = fY + FLOW.NH / 2;
        var tgtEdgeX = tX - FLOW.NW / 2;
        // Route: go down to target row center, then across
        pathD = "M" + fX + "," + srcEdgeY + " L" + fX + "," + tY + " L" + tgtEdgeX + "," + tY;
        labelX = fX + 8;
        labelY = srcEdgeY + 16;
        labelAnchor = "start";
      }

      parts.push(
        '<path class="edge" d="' + pathD + '"' +
        ' fill="none" stroke="var(--line-strong)" marker-end="' + arwRef + '"/>'
      );

      if (edge.label) {
        parts.push(
          '<text class="edge-label" x="' + labelX + '" y="' + labelY + '"' +
          ' text-anchor="' + labelAnchor + '" fill="var(--muted)">' + esc(edge.label) + '</text>'
        );
      }
    }

    // Render nodes
    for (var ni3 = 0; ni3 < nodes.length; ni3++) {
      var node = nodes[ni3];
      var nd = nodeMap[node.id];
      var c = nodeCenter(nd);
      var cx2 = c.x + offsetX;
      var cy = c.y + offsetY;
      var kind = nd.kind;

      parts.push(
        '<g data-cmt-id="' + esc(nd.id) + '" data-cmt-label="' + esc(nd.label) + '">'
      );

      if (kind === "step") {
        parts.push(
          '<rect class="node step"' +
          ' x="' + (cx2 - FLOW.NW / 2) + '" y="' + (cy - FLOW.NH / 2) + '"' +
          ' width="' + FLOW.NW + '" height="' + FLOW.NH + '"' +
          ' rx="8" fill="var(--bg-soft)" stroke="var(--line)"/>'
        );
      } else if (kind === "start") {
        var rx2 = FLOW.NH / 2;
        parts.push(
          '<rect class="node start"' +
          ' x="' + (cx2 - FLOW.NW / 2) + '" y="' + (cy - FLOW.NH / 2) + '"' +
          ' width="' + FLOW.NW + '" height="' + FLOW.NH + '"' +
          ' rx="' + rx2 + '" fill="var(--bg-soft)" stroke="var(--line-strong)"/>'
        );
      } else if (kind === "decision") {
        var dx = 85, dy = 28;
        var pathPts =
          (cx2) + "," + (cy - dy) + " " +
          (cx2 + dx) + "," + cy + " " +
          cx2 + "," + (cy + dy) + " " +
          (cx2 - dx) + "," + cy;
        parts.push(
          '<path class="node decision" d="M' +
          cx2 + "," + (cy - dy) + " L" +
          (cx2 + dx) + "," + cy + " L" +
          cx2 + "," + (cy + dy) + " L" +
          (cx2 - dx) + "," + cy + " Z" +
          '" fill="var(--bg)" stroke="var(--line-strong)"/>'
        );
      }

      // Label: split on \n for multi-line
      var lines = nd.label.split("\n");
      var lineH = 16;
      var totalTextH = lines.length * lineH;
      var startTextY = cy - totalTextH / 2 + lineH * 0.8;
      for (var li = 0; li < lines.length; li++) {
        parts.push(
          '<text x="' + cx2 + '" y="' + (startTextY + li * lineH) + '"' +
          ' text-anchor="middle" fill="var(--ink)">' + esc(lines[li]) + '</text>'
        );
      }

      parts.push('</g>');
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  /* --------------------------------------------------------------- render */

  function render(spec, uid) {
    if (uid == null) uid = "d0";
    var type = spec && spec.type;
    if (type === "sequence") return renderSequence(spec, uid);
    if (type === "flow") return renderFlow(spec, uid);
    throw new Error("unknown diagram type: " + type);
  }

  /* --------------------------------------------------------- auto-mount */

  var api = { render: render };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CanvasDiagram = api;

    // Browser auto-mount: DOMContentLoaded
    if (typeof document !== "undefined") {
      document.addEventListener("DOMContentLoaded", function () {
        var counter = 0;
        var scripts = document.querySelectorAll('script[type="application/json"][data-diagram]');
        for (var i = 0; i < scripts.length; i++) {
          var scriptEl = scripts[i];
          var wrapper;
          try {
            var specParsed = JSON.parse(scriptEl.textContent);
            var svgStr = render(specParsed, "auto" + counter++);
            wrapper = document.createElement("div");
            wrapper.className = "diagram-svg";
            wrapper.innerHTML = svgStr;
          } catch (err) {
            wrapper = document.createElement("div");
            wrapper.className = "diagram-error";
            wrapper.textContent = err.message;
          }
          scriptEl.parentNode.replaceChild(wrapper, scriptEl);
        }
      });
    }
  }
})(this);
