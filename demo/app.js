/* demo/app.js — the demo application. Wires lib/ + project types + renderer. */
import GraphKit, { ops } from '../lib/index.js';
import { DemoTypes } from './node-types.js';
import { Renderer } from './renderer.js';

const registry = new GraphKit.TypeRegistry();
registry.register(...DemoTypes.all);

let graph = new GraphKit.Graph(GraphKit.createDocument({ meta: { title: 'Scratch map' } }), registry);
let view; // Renderer
const $ = (id) => document.getElementById(id);

// Dev convenience: poke the live graph from the devtools console, e.g.
// graph.ancestorsOf(nodeId), graph.node(id). Re-pointed in reset() too,
// since graph itself gets reassigned there.
window.graph = graph;

/* ---------------- logging ---------------- */

function log(msg, cls) {
  const line = document.createElement('div');
  line.className = 'log-line ' + (cls || '');
  line.textContent = msg;
  const box = $('log');
  box.insertBefore(line, box.firstChild);
  while (box.children.length > 120) box.removeChild(box.lastChild);
}

function guard(label, fn) {
  try {
    const before = { n: graph.allNodes().length, e: graph.allEdges().length };
    fn();
    const after = { n: graph.allNodes().length, e: graph.allEdges().length };
    const dn = after.n - before.n, de = after.e - before.e;
    const delta = [];
    if (dn) delta.push((dn > 0 ? '+' : '') + dn + ' nodes');
    if (de) delta.push((de > 0 ? '+' : '') + de + ' edges');
    log(label + (delta.length ? '  (' + delta.join(', ') + ')' : ''), 'ok');
  } catch (err) {
    log(label + ' — refused: ' + err.message, 'err');
  }
  refresh();
}

/* ---------------- refresh ---------------- */

function refresh() {
  view.draw();
  renderInspector();
  renderIssues();
  renderStats();
  if ($('json-panel').open) $('json-out').value = JSON.stringify(graph.toJSON(), null, 2);
}

function renderStats() {
  const nodes = graph.allNodes(), edges = graph.allEdges();
  $('stats').textContent =
    nodes.filter((n) => n.state === 'active').length + ' nodes · ' +
    edges.filter((e) => e.state === 'active').length + ' edges · ' +
    nodes.filter((n) => n.state === 'detached').length + ' detached · rev ' +
    (graph.doc.meta.revision || 0);
}

function renderIssues() {
  const issues = graph.validate();
  const host = $('issues');
  host.innerHTML = '';
  if (!issues.length) {
    host.innerHTML = '<div class="issue ok">No issues. All structural invariants pass.</div>';
    return;
  }
  issues.forEach((i) => {
    const d = document.createElement('div');
    d.className = 'issue ' + i.level;
    d.textContent = i.level.toUpperCase() + ': ' + i.message;
    if (i.nodeId) d.addEventListener('click', () => view.select({ kind: 'node', id: i.nodeId }));
    host.appendChild(d);
  });
}

/* ---------------- inspector ---------------- */

function renderInspector() {
  const host = $('inspector');
  const sel = view.selection;
  if (!sel) { host.innerHTML = '<p class="muted">Select a node or an edge.</p>'; return; }

  if (sel.kind === 'node') {
    const n = graph.node(sel.id);
    if (!n) { view.selection = null; host.innerHTML = ''; return; }
    const meta = graph.metaOf('node', n.id) || {};
    host.innerHTML = '';
    host.appendChild(field('Label', meta.label || '', (v) => {
      guard('renamed node', () => ops.setNodeMeta(graph, n.id, { label: v }));
    }));
    host.appendChild(readonly('Type', graph.typeOf(n.id) || '(untyped)'));
    host.appendChild(readonly('Id', n.id));
    host.appendChild(readonly('Meta id', n.meta || '(none yet — set on first edit)'));
    host.appendChild(readonly('State', n.state + (n.parent ? ' · inside ' + ((graph.metaOf('node', n.parent) || {}).label || n.parent) : ' · top level')));
    host.appendChild(area('data (JSON)', JSON.stringify(n.data || {}, null, 2), (v) => {
      guard('edited node data', () => ops.setNodeData(graph, n.id, JSON.parse(v)));
    }));

    host.appendChild(btnRow([
      ['Link from here', () => { view.linkFrom = n.id; view.draw(); log('linking from ' + (meta.label || n.id) + ' — click a target node.'); }],
      ['Detach', () => guard('detached', () => ops.detach(graph, n.id))],
      ['Disconnect', () => guard('disconnected', () => ops.disconnect(graph, n.id))],
      ['Purge', () => guard('purged', () => { ops.purge(graph, n.id); view.selection = null; })]
    ]));

    // lockChildren defaults to true (docs/domain-shape.md §2) — only a node
    // that can actually contain children needs this control.
    const type = graph.typeOf(n.id);
    const desc = type ? registry.describe(type) : null;
    if (!desc || desc.allowsChildren !== false) {
      const locked = meta.lockChildren !== false;
      host.appendChild(btnRow([
        [locked ? 'Switch children to auto-layout' : 'Lock children to fixed positions',
          () => guard(locked ? 'switched to auto-layout' : 'locked children to fixed positions',
            () => ops.setNodeMeta(graph, n.id, { lockChildren: !locked }))]
      ]));
    }

    // lockLinked is opt-in (default off) — any node can have edges, so this
    // control is always available, unlike the lockChildren one above.
    const linkLocked = !!meta.lockLinked;
    host.appendChild(btnRow([
      [linkLocked ? 'Unlock linked nodes' : 'Lock linked nodes (drag together)',
        () => guard(linkLocked ? 'unlocked linked nodes' : 'locked linked nodes',
          () => ops.setNodeMeta(graph, n.id, { lockLinked: !linkLocked }))]
    ]));

    const moveSel = document.createElement('select');
    moveSel.appendChild(opt('', '— move into —'));
    moveSel.appendChild(opt('__root__', 'top level'));
    graph.allNodes().forEach((c) => {
      if (c.id === n.id) return;
      const t = graph.typeOf(c.id);
      const d = t ? registry.describe(t) : null;
      if (d && d.allowsChildren === false) return;
      moveSel.appendChild(opt(c.id, (graph.metaOf('node', c.id) || {}).label || t || c.id.slice(0, 8)));
    });
    moveSel.addEventListener('change', () => {
      if (!moveSel.value) return;
      const target = moveSel.value === '__root__' ? null : moveSel.value;
      guard('reparented', () => ops.reparent(graph, n.id, target));
    });
    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.appendChild(moveSel);
    host.appendChild(wrap);
    return;
  }

  const e = graph.edge(sel.id);
  if (!e) { view.selection = null; host.innerHTML = ''; return; }
  const emeta = graph.metaOf('edge', e.id) || {};
  host.innerHTML = '';
  host.appendChild(field('Edge label', emeta.label || '', (v) => {
    guard('renamed edge', () => ops.setEdgeMeta(graph, e.id, { label: v }));
  }));
  host.appendChild(readonly('From', (graph.metaOf('node', e.from) || {}).label || e.from));
  host.appendChild(readonly('To', (graph.metaOf('node', e.to) || {}).label || e.to));
  host.appendChild(area('data (JSON)', JSON.stringify(e.data || {}, null, 2), (v) => {
    guard('edited edge data', () => ops.setEdgeData(graph, e.id, JSON.parse(v)));
  }));
  host.appendChild(btnRow([
    ['Remove edge', () => guard('removed edge', () => { ops.disconnectEdge(graph, e.id); view.selection = null; })]
  ]));
}

function labelEl(t) { const l = document.createElement('label'); l.textContent = t; return l; }
function opt(v, t) { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }

function field(label, value, onCommit) {
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(labelEl(label));
  const i = document.createElement('input');
  i.value = value;
  i.addEventListener('change', () => onCommit(i.value));
  row.appendChild(i);
  return row;
}

function readonly(label, value) {
  const row = document.createElement('div'); row.className = 'row';
  row.appendChild(labelEl(label));
  const s = document.createElement('code'); s.textContent = value;
  row.appendChild(s);
  return row;
}

function area(label, value, onCommit) {
  const row = document.createElement('div'); row.className = 'row col';
  row.appendChild(labelEl(label));
  const t = document.createElement('textarea');
  t.value = value; t.rows = 5;
  t.addEventListener('change', () => {
    try { onCommit(t.value); } catch (err) { log('bad JSON: ' + err.message, 'err'); }
  });
  row.appendChild(t);
  return row;
}

function btnRow(pairs) {
  const row = document.createElement('div'); row.className = 'row buttons';
  pairs.forEach(([text, fn]) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', fn);
    row.appendChild(b);
  });
  return row;
}

/* ---------------- presets ---------------- */

function reset(title) {
  graph = new GraphKit.Graph(GraphKit.createDocument({ meta: { title: title || 'Scratch map' } }), registry);
  window.graph = graph;
  view.graph = graph;
  view.selection = null;
  view.linkFrom = null;
}

const presets = {
  'single node': () => {
    reset('Single node');
    ops.addNode(graph, { meta: { type: 'demo.step', label: 'The only node' } });
    log('One node, no edges, no type-driven behaviour triggered yet.');
  },

  'one of every type': () => {
    reset('Every node type');
    DemoTypes.palette.forEach((T) => ops.addNode(graph, { meta: { type: T.type, label: T.label } }));
    log('One node per palette type. The scene auto-attached its own label block.');
  },

  'linked chain': () => {
    reset('Linked chain');
    const a = ops.addNode(graph, { meta: { type: 'demo.start', label: 'Start' } });
    const b = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Validate' } });
    const c = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Persist' } });
    const d = ops.addNode(graph, { meta: { type: 'demo.end', label: 'Done' } });
    ops.connect(graph, a, b);
    ops.connect(graph, b, c, { meta: { label: 'ok' } });
    ops.connect(graph, c, d);
    log('Four nodes in a straight chain — no node has more than one outgoing edge, so nothing splits.');
  },

  'branching (auto split)': () => {
    reset('Branching');
    const a = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Choose' } });
    const b = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Path A' } });
    const c = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Path B' } });
    ops.connect(graph, a, b);
    log('First link is direct.');
    ops.connect(graph, a, c);
    log('Second link from the same step — its own onEdgeAdded hook inserted a split. The library has no concept of ports or capacity; this is entirely demo/node-types.js.');
    log('Now remove either branch edge (select it, "Remove edge") and watch the split collapse itself.');
  },

  'subgraph, crossing edges allowed': () => {
    reset('Subgraph');
    const outside = ops.addNode(graph, { meta: { type: 'demo.start', label: 'Ingress' } });
    const grp = ops.addNode(graph, { meta: { type: 'demo.group', label: 'Core services' } });
    const x = ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'Orders' } });
    const y = ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'Payments' } });
    const store = ops.addNode(graph, { meta: { type: 'demo.end', label: 'Postgres' } });
    ops.connect(graph, outside, x); // straight into a node inside the group — no portal needed
    ops.connect(graph, x, y);
    ops.connect(graph, y, store); // straight out of the group
    log('Edges connect straight to nodes inside the group — no boundary machinery needed.');
    log('Collapse the group: the edges are redrawn to the group\'s own box (see demo/renderer.js anchorFor), and the data never changes.');
    log('lockChildren was never set on the group, so it defaults to locked — drag Orders or Payments and it repositions on its own.');
  },

  'fixed layout, drag the group': () => {
    reset('Fixed layout');
    const grp = ops.addNode(graph, { meta: { type: 'demo.group', label: 'Fixed layout', x: 80, y: 60 } });
    ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'Top-left', x: 20, y: 20 } });
    ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'Offset', x: 220, y: 90 } });
    log('lockChildren was never set — subgraphs default to locked, fixed-position children.');
    log('Drag the group and both children move with it (their position is stored relative to it). Drag a child on its own and only it moves.');
  },

  'auto-stacked subgraph (opt out)': () => {
    reset('Auto-stacked, opted out');
    const grp = ops.addNode(graph, { meta: { type: 'demo.group', label: 'Auto-stacked', lockChildren: false } });
    ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'First' } });
    ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'Second' } });
    ops.addNode(graph, { parent: grp, meta: { type: 'demo.step', label: 'Third' } });
    log('This group explicitly sets lockChildren: false — children go back to the auto-stacked column and are not individually draggable.');
  },

  'scene auto-attaches a label block': () => {
    reset('Custom creation logic');
    ops.addNode(graph, { meta: { type: 'demo.scene', label: 'Opening scene' } });
    log('One node placed. Its onCreate hook built the label-block child — ordinary consumer code, nothing library-side.');
  },

  'shared metadata': () => {
    reset('Shared metadata');
    const a = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Style A' } });
    const b = ops.addNode(graph, { parent: null, meta: { type: 'demo.step' } });
    ops.linkMeta(graph, 'node', b, graph.node(a).meta);
    ops.setNodeMeta(graph, b, { x: 260, y: 40 });
    log('Two nodes share one metadata record. Edit either one\'s label in the inspector — both change, because it is one record.');
  },

  'linked nodes locked together': () => {
    reset('Linked, locked together');
    const a = ops.addNode(graph, { meta: { type: 'demo.start', label: 'Anchor', lockLinked: true, x: 20, y: 40 } });
    const b = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Downstream 1', x: 260, y: 40 } });
    const c = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Downstream 2', x: 500, y: 40 } });
    const upstream = ops.addNode(graph, { meta: { type: 'demo.step', label: 'Upstream (stays put)', x: 260, y: 200 } });
    const unrelated = ops.addNode(graph, { meta: { type: 'demo.end', label: 'Unrelated (stays put)', x: 500, y: 200 } });
    ops.connect(graph, a, b); // Anchor points at Downstream 1
    ops.connect(graph, b, c); // ...which points at Downstream 2 — neither b nor c has lockLinked set
    ops.connect(graph, upstream, a); // this one points at Anchor — the reverse direction
    log('Only "Anchor" has lockLinked set. Dragging it carries the whole downstream chain — "Downstream 1" and "Downstream 2" — even though neither of them has the flag.');
    log('"Upstream" stays put (direction matters — it points at Anchor, not the other way round), and so does "Unrelated".');
  },

  'linked node points at its own container': () => {
    reset('Link crosses back to its own container');
    const p = ops.addNode(graph, { meta: { type: 'demo.group', label: 'Container', x: 80, y: 40 } });
    // demo.start (not demo.step) deliberately — a step auto-splits on its
    // second outgoing edge, which would obscure the thing this preset
    // actually demonstrates.
    const a = ops.addNode(graph, { parent: p, meta: { type: 'demo.start', label: 'Child (locked)', lockLinked: true, x: 20, y: 20 } });
    const b = ops.addNode(graph, { meta: { type: 'demo.end', label: 'Downstream (still follows)', x: 420, y: 60 } });
    ops.connect(graph, a, p); // the child links back to its own container — edges cross containment freely
    ops.connect(graph, a, b); // and also to something unrelated downstream
    log('"Child" links to both its own "Container" and to "Downstream". Dragging "Child" still moves "Downstream" with it.');
    log('"Container" never moves as part of that drag, even though "Child" points at it — dragging your own ancestor would fight the containment math that already repositions you when it moves.');
  }
};

/* ---------------- boot ---------------- */

function boot() {
  view = new Renderer($('canvas-host'), graph, {
    onSelect: () => renderInspector(),
    onCollapse: (id, c) => guard(c ? 'collapsed' : 'expanded', () => ops.collapse(graph, id, c)),
    // A full refresh (not just the live drag preview) is what makes a
    // locked container's children, or a lockLinked node's neighbours,
    // visually follow it — their position is only recomputed on the next
    // real layout pass. moves is [{id, pos}, ...]: the dragged node plus
    // any companions a lockLinked drag carried along.
    onMoveMany: (moves) => {
      moves.forEach(({ id, pos }) => ops.setNodeMeta(graph, id, pos));
      refresh();
    },
    onReattach: (id) => guard('reattached', () => ops.attach(graph, id)),
    onConnect: (from, to) => guard('connected', () => ops.connect(graph, from, to))
  });

  const pal = $('palette');
  DemoTypes.palette.forEach((T) => {
    const b = document.createElement('button');
    b.textContent = '+ ' + T.label;
    b.title = T.type;
    b.addEventListener('click', () => {
      let parent = null;
      if (view.selection && view.selection.kind === 'node') {
        const hostId = view.selection.id;
        const t = graph.typeOf(hostId);
        const d = t ? registry.describe(t) : null;
        if (!t || (d && d.allowsChildren !== false)) parent = hostId;
      }
      guard('added ' + T.label + (parent ? ' inside selection' : ''), () => {
        const id = ops.addNode(graph, { parent, meta: { type: T.type, label: T.label } });
        view.selection = { kind: 'node', id };
      });
    });
    pal.appendChild(b);
  });

  const pre = $('presets');
  Object.keys(presets).forEach((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      try { presets[name](); } catch (err) { log('preset failed: ' + err.message, 'err'); }
      refresh();
    });
    pre.appendChild(b);
  });

  $('btn-clear').addEventListener('click', () => {
    reset('Empty map');
    log('cleared');
    refresh();
  });
  $('btn-cancel-link').addEventListener('click', () => {
    view.linkFrom = null;
    log('link cancelled');
    refresh();
  });
  $('btn-registry').addEventListener('click', () => {
    $('json-out').value = JSON.stringify(registry.toJSON(), null, 2);
    $('json-panel').open = true;
    log('registry exported as plain data — this is what a non-JS backend consumes');
  });
  $('btn-json').addEventListener('click', () => {
    $('json-out').value = JSON.stringify(graph.toJSON(), null, 2);
    $('json-panel').open = true;
  });
  $('canvas-host').addEventListener('click', () => {
    if (view.linkFrom) { view.linkFrom = null; view.draw(); return; }
    view.select(null);
  });

  presets['branching (auto split)']();
  refresh();
  log('Ready. Click a node, then "Link from here", then click another node to connect them.');
}

if (document.readyState !== 'loading') boot();
else document.addEventListener('DOMContentLoaded', boot);
