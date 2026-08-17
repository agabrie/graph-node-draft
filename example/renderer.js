/* renderer.js — one possible renderer. Nothing here is library code.
 *
 * Proves the point that the document is renderer-agnostic: it reads only
 * type, label, resolved ports, the view entry and containment. It never looks
 * inside node.data.
 *
 * Layout: containers size themselves around their children; top-level nodes use
 * view.x / view.y when present and are draggable. Nested nodes are auto-placed.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var NODE_W = 168, NODE_H = 52, GAP = 28, PAD = 26, HEADER = 26;

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------------- layout ---------------- */

  function measure(g, id) {
    var kids = g.childrenOf(id).filter(function (n) { return n.state === 'active'; });
    if (!kids.length || g.isCollapsed(id)) {
      var ports = g.portsOf(id);
      var rows = Math.max(
        ports.filter(function (p) { return p.direction !== 'out'; }).length,
        ports.filter(function (p) { return p.direction !== 'in'; }).length
      );
      return { w: NODE_W, h: Math.max(NODE_H, 22 + rows * 16) };
    }
    var w = 0, h = 0;
    kids.forEach(function (k) {
      var m = measure(g, k.id);
      w = Math.max(w, m.w);
      h += m.h + GAP;
    });
    return { w: w + PAD * 2, h: h - GAP + PAD + HEADER + 10 };
  }

  function layout(g) {
    var boxes = {};
    var roots = g.childrenOf(null).filter(function (n) { return n.state === 'active'; });
    var cursorX = 40, cursorY = 40, rowH = 0;

    function place(node, x, y) {
      var m = measure(g, node.id);
      var box = { x: x, y: y, w: m.w, h: m.h, ports: {} };
      boxes[node.id] = box;

      var ins = g.portsOf(node.id).filter(function (p) { return p.direction !== 'out'; });
      var outs = g.portsOf(node.id).filter(function (p) { return p.direction !== 'in'; });
      ins.forEach(function (p, i) {
        box.ports[p.id] = { x: x, y: y + 18 + i * 16, side: 'in', spec: p };
      });
      outs.forEach(function (p, i) {
        box.ports[p.id] = { x: x + m.w, y: y + 18 + i * 16, side: 'out', spec: p };
      });

      if (!g.isCollapsed(node.id)) {
        var cy = y + HEADER + PAD - 8;
        g.childrenOf(node.id).filter(function (n) { return n.state === 'active'; })
          .forEach(function (kid) {
            var km = measure(g, kid.id);
            place(kid, x + PAD, cy);
            cy += km.h + GAP;
          });
      }
    }

    roots.forEach(function (n) {
      var v = g.viewOf(n.id);
      var m = measure(g, n.id);
      var x, y;
      if (v && typeof v.x === 'number') { x = v.x; y = typeof v.y === 'number' ? v.y : 40; }
      else {
        if (cursorX + m.w > 1180) { cursorX = 40; cursorY += rowH + GAP * 2; rowH = 0; }
        x = cursorX; y = cursorY;
        cursorX += m.w + GAP * 2;
        rowH = Math.max(rowH, m.h);
      }
      place(n, x, y);
    });
    return boxes;
  }

  /* ---------------- render ---------------- */

  function Renderer(host, graph, handlers) {
    this.host = host;
    this.graph = graph;
    this.h = handlers || {};
    this.selection = null;      // {kind:'node'|'edge', id}
    this.pendingPort = null;    // {node, port} while linking
    this.boxes = {};
    this._drag = null;
    var self = this;
    host.addEventListener('mousemove', function (ev) { self._onMove(ev); });
    window.addEventListener('mouseup', function () { self._onUp(); });
  }

  Renderer.prototype.select = function (sel) {
    this.selection = sel;
    if (this.h.onSelect) this.h.onSelect(sel);
    this.draw();
  };

  Renderer.prototype._svgPoint = function (ev) {
    var r = this.svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  Renderer.prototype._onMove = function (ev) {
    if (!this._drag) return;
    var p = this._svgPoint(ev);
    this._drag.moved = true;
    var nx = p.x - this._drag.dx, ny = p.y - this._drag.dy;
    this._drag.pos = { x: Math.round(nx), y: Math.round(ny) };
    var b = this.boxes[this._drag.id];
    if (b) { b.x = nx; b.y = ny; }
    this.draw(true);
  };

  Renderer.prototype._onUp = function () {
    if (!this._drag) return;
    var d = this._drag;
    this._drag = null;
    if (d.moved && this.h.onMove) this.h.onMove(d.id, d.pos);
  };

  Renderer.prototype.draw = function (skipLayout) {
    var g = this.graph, self = this;
    if (!skipLayout) this.boxes = layout(g);
    var boxes = this.boxes;

    var maxX = 1200, maxY = 500;
    Object.keys(boxes).forEach(function (k) {
      maxX = Math.max(maxX, boxes[k].x + boxes[k].w + 60);
      maxY = Math.max(maxY, boxes[k].y + boxes[k].h + 60);
    });

    this.host.innerHTML = '';
    var svg = el('svg', { width: maxX, height: maxY, class: 'canvas' });
    this.svg = svg;

    var defs = el('defs');
    ['arrow', 'arrow-sel'].forEach(function (id) {
      var m = el('marker', {
        id: id, viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'
      });
      m.appendChild(el('path', {
        d: 'M1 1L9 5L1 9', fill: 'none',
        stroke: id === 'arrow-sel' ? '#c0392b' : '#5f5e5a', 'stroke-width': '1.6'
      }));
      defs.appendChild(m);
    });
    svg.appendChild(defs);

    /* containers first, so leaves paint on top */
    var ordered = g.allNodes()
      .filter(function (n) { return n.state === 'active' && boxes[n.id]; })
      .sort(function (a, b) { return g.depthOf(a.id) - g.depthOf(b.id); });

    ordered.forEach(function (n) { self._node(svg, n); });
    g.activeEdges().forEach(function (e) { self._edge(svg, e); });

    /* detached tray */
    var detached = g.allNodes().filter(function (n) { return n.state === 'detached' && !n.parent; });
    if (detached.length) {
      var ty = maxY - 46;
      svg.appendChild(el('text', { x: 40, y: ty - 10, class: 'tray-label' },
        'detached (' + detached.length + ') — click to reattach'));
      detached.forEach(function (n, i) {
        var gx = 40 + i * 150;
        var grp = el('g', { class: 'node detached', 'data-node': n.id });
        grp.appendChild(el('rect', { x: gx, y: ty, width: 140, height: 32, rx: 8 }));
        grp.appendChild(el('text', { x: gx + 10, y: ty + 20 }, trim(n.label || n.id, 18)));
        grp.addEventListener('click', function () { if (self.h.onReattach) self.h.onReattach(n.id); });
        svg.appendChild(grp);
      });
    }

    this.host.appendChild(svg);
  };

  function trim(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  Renderer.prototype._node = function (svg, n) {
    var self = this, g = this.graph, b = this.boxes[n.id];
    var hasKids = g.childNodeCount(n.id) > 0;
    var collapsed = g.isCollapsed(n.id);
    var isContainer = hasKids && !collapsed;
    var sel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
    var known = g.registry.has(n.type);

    var cls = ['node'];
    if (isContainer) cls.push('container');
    if (sel) cls.push('selected');
    if (!known) cls.push('unknown');
    if (n.type === 'demo.branchSplit') cls.push('split');
    if (n.type === 'core.portal') cls.push('portal');

    var grp = el('g', { class: cls.join(' '), 'data-node': n.id });
    grp.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: isContainer ? 14 : 9 }));

    grp.appendChild(el('text', { x: b.x + 12, y: b.y + 19, class: 'label' },
      trim(n.label || n.type, isContainer ? 30 : 20)));
    grp.appendChild(el('text', {
      x: b.x + b.w - 10, y: b.y + 19, class: 'type', 'text-anchor': 'end'
    }, n.type.replace(/^demo\./, '')));

    if (hasKids) {
      var t = el('text', { x: b.x + 12, y: b.y + b.h - 10, class: 'toggle' },
        (collapsed ? '▸ expand (' + g.childNodeCount(n.id) + ')' : '▾ collapse'));
      t.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (self.h.onCollapse) self.h.onCollapse(n.id, !collapsed);
      });
      grp.appendChild(t);
    }

    Object.keys(b.ports).forEach(function (pid) {
      var p = b.ports[pid];
      var used = g.portUsage(n.id, pid, p.side === 'in' ? 'in' : 'out');
      var full = p.spec.capacity !== null && used >= p.spec.capacity;
      var pending = self.pendingPort && self.pendingPort.node === n.id && self.pendingPort.port === pid;
      var pc = el('circle', {
        cx: p.x, cy: p.y, r: pending ? 7 : 5,
        class: 'port ' + p.side + (full ? ' full' : '') + (pending ? ' pending' : '')
      });
      pc.addEventListener('click', function (ev) {
        ev.stopPropagation();
        self._portClick(n.id, pid, p);
      });
      var title = el('title', {}, pid + '  (' + p.spec.direction + ', ' +
        used + '/' + (p.spec.capacity === null ? '∞' : p.spec.capacity) + ')');
      pc.appendChild(title);
      grp.appendChild(pc);
      if (p.spec.label) {
        grp.appendChild(el('text', {
          x: p.side === 'in' ? p.x + 9 : p.x - 9, y: p.y + 4,
          class: 'port-label', 'text-anchor': p.side === 'in' ? 'start' : 'end'
        }, trim(p.spec.label, 12)));
      }
    });

    grp.addEventListener('mousedown', function (ev) {
      if (ev.target.classList.contains('port') || ev.target.classList.contains('toggle')) return;
      if (n.parent) return;                        // only top-level nodes drag
      var pt = self._svgPoint(ev);
      self._drag = { id: n.id, dx: pt.x - b.x, dy: pt.y - b.y, moved: false };
    });
    grp.addEventListener('click', function (ev) {
      if (ev.target.classList.contains('port') || ev.target.classList.contains('toggle')) return;
      ev.stopPropagation();
      self.select({ kind: 'node', id: n.id });
    });

    svg.appendChild(grp);
  };

  Renderer.prototype._portClick = function (nodeId, portId, p) {
    if (!this.pendingPort) {
      if (p.spec.direction === 'in') {
        if (this.h.onLog) this.h.onLog('Start from an out-port (right side).');
        return;
      }
      this.pendingPort = { node: nodeId, port: portId };
      if (this.h.onLog) this.h.onLog('Linking from ' + portId + ' — now click a target in-port.');
      this.draw();
      return;
    }
    var from = this.pendingPort;
    this.pendingPort = null;
    if (from.node === nodeId && from.port === portId) { this.draw(); return; }
    if (this.h.onConnect) this.h.onConnect(from, { node: nodeId, port: portId });
  };

  Renderer.prototype._edge = function (svg, e) {
    var self = this;
    var a = this.boxes[e.from.node], b = this.boxes[e.to.node];
    if (!a || !b) return;
    var p1 = a.ports[e.from.port], p2 = b.ports[e.to.port];
    if (!p1 || !p2) return;

    var sel = this.selection && this.selection.kind === 'edge' && this.selection.id === e.id;
    var dx = Math.max(30, Math.abs(p2.x - p1.x) / 2);
    var d = 'M' + p1.x + ' ' + p1.y +
      ' C' + (p1.x + dx) + ' ' + p1.y + ' ' + (p2.x - dx) + ' ' + p2.y +
      ' ' + p2.x + ' ' + p2.y;

    var grp = el('g', { class: 'edge' + (sel ? ' selected' : ''), 'data-edge': e.id });
    var hit = el('path', { d: d, class: 'hit', fill: 'none' });
    var line = el('path', {
      d: d, fill: 'none',
      class: 'line ' + ((e.style && e.style.line) || 'solid'),
      'marker-end': (e.style && e.style.arrowEnd === 'none') ? '' : 'url(#' + (sel ? 'arrow-sel' : 'arrow') + ')'
    });
    grp.appendChild(hit);
    grp.appendChild(line);

    if (e.label) {
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 - 6;
      var bg = el('rect', {
        x: mx - (e.label.length * 3.3 + 6), y: my - 11,
        width: e.label.length * 6.6 + 12, height: 16, rx: 4, class: 'edge-label-bg'
      });
      grp.appendChild(bg);
      grp.appendChild(el('text', { x: mx, y: my + 1, class: 'edge-label', 'text-anchor': 'middle' },
        trim(e.label, 24)));
    }

    grp.addEventListener('click', function (ev) {
      ev.stopPropagation();
      self.select({ kind: 'edge', id: e.id });
    });
    svg.appendChild(grp);
  };

  root.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
