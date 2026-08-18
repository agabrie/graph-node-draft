/* demo/renderer.js — one possible renderer. Nothing here is library code.
 *
 * Reads only: type/label from metadata, containment, and metadata's x/y/
 * collapsed/lockChildren. It never looks inside node.data. No ports exist in
 * lib/, so edges connect box-to-box, not port-to-port.
 *
 * Collapsing a subgraph no longer rewrites any edges (there are no portals
 * in this shape — see docs/domain-shape.md §10.4). Instead, an edge whose
 * endpoint is hidden behind a collapsed ancestor is drawn to that ancestor's
 * box: `anchorFor` walks up the parent chain to find it. This is the
 * renderer-side replacement for what portals used to do structurally.
 *
 * lockChildren defaults to true (docs/domain-shape.md §2): a container's
 * children keep an explicit position relative to it and are individually
 * draggable, so moving the container moves them with it for free — the
 * position is relative, not recomputed. A child with no stored position yet
 * falls back to a small grid. Set lockChildren:false on a container to opt
 * back into the classic auto-stacked column layout.
 *
 * lockLinked is the equivalent for edges rather than containment, and it is
 * opt-in (default off): a node with lockLinked:true drags everything
 * downstream of it — its outgoing edges' targets, and transitively theirs,
 * and so on — along with it, by the same delta. Direction matters, same as
 * containment — a node drags what it points at, never what points at it.
 * The lock is only checked on the node the drag started from; it does not
 * need to be set on every node in between for the chain to keep
 * propagating. Unlike a locked child's position, nothing is stored as
 * "relative to a link" — a link has no single owner the way a child has one
 * parent, so this is purely a drag-time behaviour computed from each node's
 * current box and committed as an ordinary position update to every node
 * that moved.
 */

const NS = 'http://www.w3.org/2000/svg';
const NODE_W = 168, NODE_H = 46, GAP = 26, PAD = 24, HEADER = 24;

function el(name, attrs, text) {
  const e = document.createElementNS(NS, name);
  if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
  if (text != null) e.textContent = text;
  return e;
}
function trim(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ---------------- layout ---------------- */

/** Default is locked: explicit lockChildren:false is the only way out. */
function isLocked(g, id) {
  const meta = g.metaOf('node', id) || {};
  return meta.lockChildren !== false;
}

/** Opt-in: dragging this node also drags every node it has an edge to or
 *  from. Unlike lockChildren, this defaults to off — a node's links are
 *  unbounded and can reach anywhere in the graph, so making that the
 *  default risked chaining unrelated parts of the graph together the
 *  moment two nodes happened to be connected. */
function isLinkLocked(g, id) {
  const meta = g.metaOf('node', id) || {};
  return !!meta.lockLinked;
}

/** A locked child's position relative to its container's content origin.
 *  Falls back to a small grid when the child has never been positioned. */
function relativePos(g, id, index) {
  const meta = g.metaOf('node', id) || {};
  if (typeof meta.x === 'number' && typeof meta.y === 'number') return { x: meta.x, y: meta.y };
  const col = index % 3, row = Math.floor(index / 3);
  return { x: col * (NODE_W + GAP), y: row * (NODE_H + GAP) };
}

function measure(g, id) {
  const kids = g.childrenOf(id).filter((n) => n.state === 'active');
  if (!kids.length || g.isCollapsed(id)) return { w: NODE_W, h: NODE_H };
  if (isLocked(g, id)) {
    let maxX = 0, maxY = 0;
    kids.forEach((k, i) => {
      const km = measure(g, k.id);
      const p = relativePos(g, k.id, i);
      maxX = Math.max(maxX, p.x + km.w);
      maxY = Math.max(maxY, p.y + km.h);
    });
    return { w: maxX + PAD * 2, h: maxY + HEADER + PAD * 2 };
  }
  let w = 0, h = 0;
  kids.forEach((k) => {
    const m = measure(g, k.id);
    w = Math.max(w, m.w);
    h += m.h + GAP;
  });
  return { w: w + PAD * 2, h: h - GAP + PAD + HEADER + 10 };
}

function layout(g) {
  const boxes = {};
  const roots = g.childrenOf(null).filter((n) => n.state === 'active');
  let cursorX = 40, cursorY = 40, rowH = 0;

  function place(node, x, y) {
    const m = measure(g, node.id);
    boxes[node.id] = { x, y, w: m.w, h: m.h };
    if (g.isCollapsed(node.id)) return;
    const kids = g.childrenOf(node.id).filter((n) => n.state === 'active');
    if (isLocked(g, node.id)) {
      kids.forEach((k, i) => {
        const p = relativePos(g, k.id, i);
        place(k, x + PAD + p.x, y + HEADER + PAD + p.y);
      });
    } else {
      let cy = y + HEADER + PAD - 8;
      kids.forEach((kid) => {
        const km = measure(g, kid.id);
        place(kid, x + PAD, cy);
        cy += km.h + GAP;
      });
    }
  }

  roots.forEach((n) => {
    const meta = g.metaOf('node', n.id);
    const m = measure(g, n.id);
    let x, y;
    if (meta && typeof meta.x === 'number') { x = meta.x; y = typeof meta.y === 'number' ? meta.y : 40; }
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

/** Nearest collapsed ancestor of id, or id itself if fully visible. */
function anchorFor(g, id) {
  let cur = id;
  for (;;) {
    const parent = g.parentOf(cur);
    if (!parent) return id;
    if (g.isCollapsed(parent)) return parent;
    cur = parent;
  }
}

/* ---------------- render ---------------- */

export function Renderer(host, graph, handlers) {
  this.host = host;
  this.graph = graph;
  this.h = handlers || {};
  this.selection = null;   // {kind:'node'|'edge', id}
  this.linkFrom = null;    // node id while a link is pending
  this.boxes = {};
  this._drag = null;
  host.addEventListener('mousemove', (ev) => this._onMove(ev));
  window.addEventListener('mouseup', () => this._onUp());
}

Renderer.prototype.select = function (sel) {
  this.selection = sel;
  if (this.h.onSelect) this.h.onSelect(sel);
  this.draw();
};

Renderer.prototype._svgPoint = function (ev) {
  const r = this.svg.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
};

/** Every containment ancestor of id: parent, grandparent, and so on. */
function ancestorsOf(g, id) {
  const out = new Set();
  let p = g.parentOf(id);
  while (p) { out.add(p); p = g.parentOf(p); }
  return out;
}

/** Everything downstream of id, following outgoing edges transitively —
 *  the candidates a lockLinked drag carries along. Direction matters, same
 *  as containment: a node drags what it points at (and what that points at,
 *  and so on), never what points at it — otherwise dragging one end of a
 *  chain would drag the whole chain backwards too. The lock only needs to
 *  be set on the node being dragged; it is not required on the nodes in
 *  between for the chain to keep propagating. Only nodes that are
 *  themselves individually draggable and currently on screen qualify;
 *  already-visited nodes stop the walk, which also guards against cycles.
 *
 *  One exclusion: an edge can point at one of id's own containment
 *  ancestors (edges cross containment freely — see docs/domain-shape.md
 *  §2), and dragging that ancestor would fight the containment math, which
 *  already repositions id as a side effect of moving its container. That
 *  ancestor is excluded from the drag entirely — it neither moves nor
 *  propagates the drag further through its own downstream links. */
Renderer.prototype._companionsOf = function (id) {
  const g = this.graph;
  const ancestors = ancestorsOf(g, id);
  const seen = new Set([id]);
  const out = [];
  let frontier = [id];
  while (frontier.length) {
    const next = [];
    frontier.forEach((cur) => {
      g.activeEdgesFrom(cur).forEach((e) => {
        const other = e.to;
        if (!other || seen.has(other) || ancestors.has(other)) return;
        seen.add(other);
        const parent = g.parentOf(other);
        const draggable = !parent || isLocked(g, parent);
        const box = this.boxes[other];
        if (draggable && box) {
          out.push({ id: other, startX: box.x, startY: box.y });
          next.push(other);
        }
      });
    });
    frontier = next;
  }
  return out;
};

Renderer.prototype._onMove = function (ev) {
  if (!this._drag) return;
  const d = this._drag;
  const p = this._svgPoint(ev);
  d.moved = true;
  const nx = p.x - d.dx, ny = p.y - d.dy;
  const deltaX = nx - d.startX, deltaY = ny - d.startY;
  const b = this.boxes[d.id];
  if (b) { b.x = nx; b.y = ny; }
  d.companions.forEach((c) => {
    const cb = this.boxes[c.id];
    if (cb) { cb.x = c.startX + deltaX; cb.y = c.startY + deltaY; }
  });
  this.draw(true);
};

Renderer.prototype._onUp = function () {
  if (!this._drag) return;
  const d = this._drag;
  this._drag = null;
  if (!d.moved) return;
  // Top-level nodes store an absolute canvas position; a locked child stores
  // a position relative to its container's content origin (see layout()'s
  // `place`), so moving the container carries its children along for free.
  // A lockLinked drag's companions go through the same conversion, keyed off
  // their own parent — nothing about that logic is specific to the primary
  // node being dragged.
  const g = this.graph;
  const ids = [d.id].concat(d.companions.map((c) => c.id));
  const moves = ids.map((id) => {
    const parent = id === d.id ? d.parent : g.parentOf(id);
    const box = this.boxes[id];
    let pos = { x: Math.round(box.x), y: Math.round(box.y) };
    if (parent) {
      const pb = this.boxes[parent];
      pos = { x: Math.round(box.x - pb.x - PAD), y: Math.round(box.y - pb.y - HEADER - PAD) };
    }
    return { id, pos };
  });
  if (this.h.onMoveMany) this.h.onMoveMany(moves);
};

Renderer.prototype.draw = function (skipLayout) {
  const g = this.graph;
  if (!skipLayout) this.boxes = layout(g);
  const boxes = this.boxes;

  let maxX = 1200, maxY = 480;
  Object.keys(boxes).forEach((k) => {
    maxX = Math.max(maxX, boxes[k].x + boxes[k].w + 60);
    maxY = Math.max(maxY, boxes[k].y + boxes[k].h + 60);
  });

  this.host.innerHTML = '';
  const svg = el('svg', { width: maxX, height: maxY, class: 'canvas' });
  this.svg = svg;

  const defs = el('defs');
  ['arrow', 'arrow-sel'].forEach((id) => {
    const m = el('marker', {
      id, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'
    });
    m.appendChild(el('path', {
      d: 'M1 1L9 5L1 9', fill: 'none',
      stroke: id === 'arrow-sel' ? '#c0392b' : '#5f5e5a', 'stroke-width': '1.6'
    }));
    defs.appendChild(m);
  });
  svg.appendChild(defs);

  const ordered = g.allNodes()
    .filter((n) => n.state === 'active' && boxes[n.id])
    .sort((a, b) => g.depthOf(a.id) - g.depthOf(b.id));

  ordered.forEach((n) => this._node(svg, n));
  g.activeEdges().forEach((e) => this._edge(svg, e));

  const detached = g.allNodes().filter((n) => n.state === 'detached' && !n.parent);
  if (detached.length) {
    const ty = maxY - 46;
    svg.appendChild(el('text', { x: 40, y: ty - 10, class: 'tray-label' },
      'detached (' + detached.length + ') — click to reattach'));
    detached.forEach((n, i) => {
      const gx = 40 + i * 150;
      const label = (g.metaOf('node', n.id) || {}).label || n.id;
      const grp = el('g', { class: 'node detached', 'data-node': n.id });
      grp.appendChild(el('rect', { x: gx, y: ty, width: 140, height: 32, rx: 8 }));
      grp.appendChild(el('text', { x: gx + 10, y: ty + 20 }, trim(label, 18)));
      grp.addEventListener('click', () => { if (this.h.onReattach) this.h.onReattach(n.id); });
      svg.appendChild(grp);
    });
  }

  this.host.appendChild(svg);
};

Renderer.prototype._node = function (svg, n) {
  const g = this.graph, b = this.boxes[n.id];
  const meta = g.metaOf('node', n.id) || {};
  const type = g.typeOf(n.id);
  const hasKids = g.childNodeCount(n.id) > 0;
  const collapsed = g.isCollapsed(n.id);
  const isContainer = hasKids && !collapsed;
  const sel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
  const known = !type || g.registry.has(type);
  const isLinkSource = this.linkFrom === n.id;

  const cls = ['node'];
  if (isContainer) cls.push('container');
  if (sel) cls.push('selected');
  if (!known) cls.push('unknown');
  if (type === 'demo.branchSplit') cls.push('split');
  if (isLinkSource) cls.push('link-source');
  if (isContainer && !isLocked(g, n.id)) cls.push('auto'); // opted out of lockChildren
  if (isLinkLocked(g, n.id)) cls.push('link-locked');

  const grp = el('g', { class: cls.join(' '), 'data-node': n.id });
  grp.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: isContainer ? 14 : 9 }));

  grp.appendChild(el('text', { x: b.x + 12, y: b.y + 19, class: 'label' },
    trim(meta.label || type || n.id.slice(0, 8), isContainer ? 30 : 20)));
  if (type) {
    grp.appendChild(el('text', {
      x: b.x + b.w - 10, y: b.y + 19, class: 'type', 'text-anchor': 'end'
    }, type.replace(/^demo\./, '')));
  }

  if (hasKids) {
    const toggleText = (collapsed ? '▸ expand (' + g.childNodeCount(n.id) + ')' : '▾ collapse') +
      (isLocked(g, n.id) ? '' : ' · auto-layout');
    const t = el('text', { x: b.x + 12, y: b.y + b.h - 10, class: 'toggle' }, toggleText);
    t.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.h.onCollapse) this.h.onCollapse(n.id, !collapsed);
    });
    grp.appendChild(t);
  }

  // Top-level nodes always drag. A nested node drags too when its container
  // is locked (the default) — its position is stored relative to the
  // container, so this is what makes "drag the group, children follow" work
  // without the renderer treating the two cases specially.
  const draggable = !n.parent || isLocked(g, n.parent);
  grp.addEventListener('mousedown', (ev) => {
    if (ev.target.classList.contains('toggle')) return;
    if (!draggable) return;
    const pt = this._svgPoint(ev);
    this._drag = {
      id: n.id, parent: n.parent,
      dx: pt.x - b.x, dy: pt.y - b.y,
      startX: b.x, startY: b.y,
      companions: isLinkLocked(g, n.id) ? this._companionsOf(n.id) : [],
      moved: false
    };
  });
  grp.addEventListener('click', (ev) => {
    if (ev.target.classList.contains('toggle')) return;
    ev.stopPropagation();
    if (this.linkFrom) {
      const from = this.linkFrom;
      this.linkFrom = null;
      if (from !== n.id && this.h.onConnect) this.h.onConnect(from, n.id);
      else this.draw();
      return;
    }
    this.select({ kind: 'node', id: n.id });
  });

  svg.appendChild(grp);
};

Renderer.prototype._edge = function (svg, e) {
  const g = this.graph;
  const fromId = anchorFor(g, e.from), toId = anchorFor(g, e.to);
  if (fromId === toId) return; // both ends hidden behind the same collapsed ancestor
  const a = this.boxes[fromId], b = this.boxes[toId];
  if (!a || !b) return;
  const p1 = { x: a.x + a.w, y: a.y + a.h / 2 };
  const p2 = { x: b.x, y: b.y + b.h / 2 };

  const meta = g.metaOf('edge', e.id) || {};
  const sel = this.selection && this.selection.kind === 'edge' && this.selection.id === e.id;
  const dx = Math.max(30, Math.abs(p2.x - p1.x) / 2);
  const d = 'M' + p1.x + ' ' + p1.y +
    ' C' + (p1.x + dx) + ' ' + p1.y + ' ' + (p2.x - dx) + ' ' + p2.y +
    ' ' + p2.x + ' ' + p2.y;

  const grp = el('g', { class: 'edge' + (sel ? ' selected' : ''), 'data-edge': e.id });
  grp.appendChild(el('path', { d, class: 'hit', fill: 'none' }));
  grp.appendChild(el('path', {
    d, fill: 'none',
    class: 'line ' + ((meta.style && meta.style.line) || 'solid'),
    'marker-end': 'url(#' + (sel ? 'arrow-sel' : 'arrow') + ')'
  }));

  if (meta.label) {
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 - 6;
    grp.appendChild(el('rect', {
      x: mx - (meta.label.length * 3.3 + 6), y: my - 11,
      width: meta.label.length * 6.6 + 12, height: 16, rx: 4, class: 'edge-label-bg'
    }));
    grp.appendChild(el('text', { x: mx, y: my + 1, class: 'edge-label', 'text-anchor': 'middle' },
      trim(meta.label, 24)));
  }

  grp.addEventListener('click', (ev) => {
    ev.stopPropagation();
    this.select({ kind: 'edge', id: e.id });
  });
  svg.appendChild(grp);
};
