/* example.js — the demo application. Wires library + types + renderer + Mermaid IO. */
(function () {
  'use strict';
  var G = window.GraphCore, T = window.DemoTypes, IO = window.MermaidIO;

  var registry = new G.TypeRegistry();
  registry.register.apply(registry, T.all);

  var graph = new G.Graph(G.createDocument({ kind: 'generic', title: 'Scratch map' }), registry);
  var view;   // Renderer
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- logging ---------------- */

  function log(msg, cls) {
    var line = document.createElement('div');
    line.className = 'log-line ' + (cls || '');
    line.textContent = msg;
    var box = $('log');
    box.insertBefore(line, box.firstChild);
    while (box.children.length > 120) box.removeChild(box.lastChild);
  }

  function guard(label, fn) {
    try {
      var before = { n: graph.allNodes().length, e: graph.allEdges().length };
      fn();
      var after = { n: graph.allNodes().length, e: graph.allEdges().length };
      var dn = after.n - before.n, de = after.e - before.e;
      var delta = [];
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
    var nodes = graph.allNodes(), edges = graph.allEdges();
    $('stats').textContent =
      nodes.filter(function (n) { return n.state === 'active'; }).length + ' nodes · ' +
      edges.filter(function (e) { return e.state === 'active'; }).length + ' edges · ' +
      nodes.filter(function (n) { return n.state === 'detached'; }).length + ' detached · rev ' +
      graph.doc.meta.revision + ' · kind ' + graph.doc.kind;
  }

  function renderIssues() {
    var issues = graph.validate();
    var host = $('issues');
    host.innerHTML = '';
    if (!issues.length) {
      host.innerHTML = '<div class="issue ok">No issues. Schema shape and all cross-record rules pass.</div>';
      return;
    }
    issues.forEach(function (i) {
      var d = document.createElement('div');
      d.className = 'issue ' + i.level;
      d.textContent = i.level.toUpperCase() + ': ' + i.message;
      if (i.nodeId) d.addEventListener('click', function () { view.select({ kind: 'node', id: i.nodeId }); });
      host.appendChild(d);
    });
  }

  /* ---------------- inspector ---------------- */

  function renderInspector() {
    var host = $('inspector');
    var sel = view.selection;
    if (!sel) { host.innerHTML = '<p class="muted">Select a node or an edge.</p>'; return; }

    if (sel.kind === 'node') {
      var n = graph.node(sel.id);
      if (!n) { view.selection = null; host.innerHTML = ''; return; }
      var ports = graph.portsOf(n.id);
      host.innerHTML = '';
      host.appendChild(field('Label', n.label || '', function (v) {
        guard('renamed node', function () { G.ops.updateNode(graph, n.id, { label: v }); });
      }));
      host.appendChild(readonly('Type', n.type));
      host.appendChild(readonly('Id', n.id));
      host.appendChild(readonly('State', n.state + (n.parent ? ' · inside ' + (graph.node(n.parent).label || '') : ' · top level')));
      host.appendChild(readonly('Ports', ports.map(function (p) {
        var used = graph.portUsage(n.id, p.id, p.direction === 'in' ? 'in' : 'out');
        return p.id + ' ' + used + '/' + (p.capacity === null ? '∞' : p.capacity);
      }).join('   ')));
      host.appendChild(area('data (JSON)', JSON.stringify(n.data || {}, null, 2), function (v) {
        guard('edited node data', function () {
          G.ops.updateNode(graph, n.id, { data: JSON.parse(v) });
        });
      }));

      host.appendChild(btnRow([
        ['Detach', function () { guard('detached', function () { G.ops.detach(graph, n.id); }); }],
        ['Disconnect', function () { guard('disconnected', function () { G.ops.disconnect(graph, n.id); }); }],
        ['Purge', function () { guard('purged', function () { G.ops.purge(graph, n.id); view.selection = null; }); }]
      ]));

      var moveSel = document.createElement('select');
      moveSel.appendChild(opt('', '— move into —'));
      moveSel.appendChild(opt('__root__', 'top level'));
      graph.allNodes().forEach(function (c) {
        if (c.id === n.id) return;
        var d = registry.describe(c.type);
        if (d && d.allowsChildren === false) return;
        moveSel.appendChild(opt(c.id, (c.label || c.type)));
      });
      moveSel.addEventListener('change', function () {
        if (!moveSel.value) return;
        var target = moveSel.value === '__root__' ? null : moveSel.value;
        guard('reparented', function () { G.ops.reparent(graph, n.id, target); });
      });
      var wrap = document.createElement('div');
      wrap.className = 'row';
      wrap.appendChild(moveSel);
      host.appendChild(wrap);
      return;
    }

    var e = graph.edge(sel.id);
    if (!e) { view.selection = null; host.innerHTML = ''; return; }
    host.innerHTML = '';
    host.appendChild(field('Edge label', e.label || '', function (v) {
      guard('renamed edge', function () { G.ops.setEdge(graph, e.id, { label: v }); });
    }));
    host.appendChild(readonly('From', (graph.node(e.from.node).label || '') + ' . ' + e.from.port));
    host.appendChild(readonly('To', (graph.node(e.to.node).label || '') + ' . ' + e.to.port));
    var lineSel = document.createElement('select');
    ['solid', 'dashed', 'thick'].forEach(function (l) {
      var o = opt(l, l); if ((e.style || {}).line === l) o.selected = true; lineSel.appendChild(o);
    });
    lineSel.addEventListener('change', function () {
      guard('restyled edge', function () { G.ops.setEdge(graph, e.id, { style: { line: lineSel.value } }); });
    });
    var lw = document.createElement('div'); lw.className = 'row';
    lw.appendChild(labelEl('Line')); lw.appendChild(lineSel);
    host.appendChild(lw);
    host.appendChild(area('data (JSON)', JSON.stringify(e.data || {}, null, 2), function (v) {
      guard('edited edge data', function () { G.ops.setEdge(graph, e.id, { data: JSON.parse(v) }); });
    }));
    host.appendChild(btnRow([
      ['Remove edge', function () {
        guard('removed edge', function () { G.ops.disconnectEdge(graph, e.id); view.selection = null; });
      }]
    ]));
  }

  function labelEl(t) { var l = document.createElement('label'); l.textContent = t; return l; }
  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }

  function field(label, value, onCommit) {
    var row = document.createElement('div'); row.className = 'row';
    row.appendChild(labelEl(label));
    var i = document.createElement('input');
    i.value = value;
    i.addEventListener('change', function () { onCommit(i.value); });
    row.appendChild(i);
    return row;
  }

  function readonly(label, value) {
    var row = document.createElement('div'); row.className = 'row';
    row.appendChild(labelEl(label));
    var s = document.createElement('code'); s.textContent = value;
    row.appendChild(s);
    return row;
  }

  function area(label, value, onCommit) {
    var row = document.createElement('div'); row.className = 'row col';
    row.appendChild(labelEl(label));
    var t = document.createElement('textarea');
    t.value = value; t.rows = 5;
    t.addEventListener('change', function () {
      try { onCommit(t.value); } catch (err) { log('bad JSON: ' + err.message, 'err'); }
    });
    row.appendChild(t);
    return row;
  }

  function btnRow(pairs) {
    var row = document.createElement('div'); row.className = 'row buttons';
    pairs.forEach(function (p) {
      var b = document.createElement('button');
      b.textContent = p[0];
      b.addEventListener('click', p[1]);
      row.appendChild(b);
    });
    return row;
  }

  /* ---------------- presets ---------------- */

  function reset(kind, title) {
    graph = new G.Graph(G.createDocument({ kind: kind || 'generic', title: title || 'Scratch map' }), registry);
    view.graph = graph;
    view.selection = null;
    view.pendingPort = null;
  }

  var presets = {
    'single node': function () {
      reset('generic', 'Single node');
      G.ops.addNode(graph, { type: 'demo.step', label: 'The only node' });
      log('One node, no edges. Its out-port shows 0/1 — capacity one.');
    },

    'one of every type': function () {
      reset('generic', 'Every node type');
      T.palette.forEach(function (Type) { G.ops.addNode(graph, { type: Type.type }); });
      log('One node per palette type. The dilemma created its own two children.');
    },

    'linked chain': function () {
      reset('generic', 'Linked chain');
      var a = G.ops.addNode(graph, { type: 'demo.start', label: 'Start' });
      var b = G.ops.addNode(graph, { type: 'demo.step', label: 'Validate' });
      var c = G.ops.addNode(graph, { type: 'demo.step', label: 'Persist' });
      var d = G.ops.addNode(graph, { type: 'demo.end', label: 'Done' });
      G.ops.connect(graph, { node: a, port: 'out' }, { node: b, port: 'in' });
      G.ops.connect(graph, { node: b, port: 'out' }, { node: c, port: 'in' }, { label: 'ok' });
      G.ops.connect(graph, { node: c, port: 'out' }, { node: d, port: 'in' });
      log('Four nodes in a chain. Every out-port is now at 1/1.');
    },

    'branching (auto split)': function () {
      reset('generic', 'Branching');
      var a = G.ops.addNode(graph, { type: 'demo.step', label: 'Choose' });
      var b = G.ops.addNode(graph, { type: 'demo.step', label: 'Path A' });
      var c = G.ops.addNode(graph, { type: 'demo.step', label: 'Path B' });
      G.ops.connect(graph, { node: a, port: 'out' }, { node: b, port: 'in' });
      log('First link is direct.');
      G.ops.connect(graph, { node: a, port: 'out' }, { node: c, port: 'in' });
      log('Second link overflowed the port — the split inserted itself. That is project code, not library code.');
      log('Now delete either branch edge and watch the split remove itself.');
    },

    'subgraph + portal': function () {
      reset('generic', 'Subgraph');
      var outside = G.ops.addNode(graph, { type: 'demo.start', label: 'Ingress' });
      var grp = G.ops.addNode(graph, { type: 'demo.group', label: 'Core services' });
      var x = G.ops.addNode(graph, { type: 'demo.step', label: 'Orders', parent: grp });
      var y = G.ops.addNode(graph, { type: 'demo.step', label: 'Payments', parent: grp });
      var store = G.ops.addNode(graph, { type: 'demo.store', label: 'Postgres' });
      var portal = G.ops.addNode(graph, {
        type: 'core.portal', label: 'in', parent: grp, data: { port: 'in', direction: 'in' }
      });
      G.ops.connect(graph, { node: outside, port: 'out' }, { node: grp, port: 'in' });
      G.ops.connect(graph, { node: portal, port: 'link' }, { node: x, port: 'in' });
      G.ops.connect(graph, { node: x, port: 'out' }, { node: y, port: 'in' });
      G.ops.connect(graph, { node: grp, port: 'out' }, { node: store, port: 'in' });
      log('Every edge joins two siblings. The crossing is expressed by a portal inside the group.');
      log('Collapse the group — no edge is rewritten, because none crosses the boundary.');
    },

    'nested dilemma': function () {
      reset('generic', 'Custom creation logic');
      G.ops.addNode(graph, { type: 'demo.dilemma', label: 'Fight or flee?' });
      log('One node placed. Its onCreate hook built two children and linked them.');
    }
  };

  /* ---------------- mermaid ---------------- */

  var SAMPLES = {
    flowchart:
      'flowchart LR\n' +
      '  start([Request received]) --> validate[Validate payload]\n' +
      '  validate --> decide{Valid?}\n' +
      '  decide -->|no| reject[/Reject notice/]\n' +
      '  decide -->|yes| enrich[[Enrich record]]\n' +
      '  subgraph core [Core services]\n' +
      '    orders[Order service] --> payments[Payment service]\n' +
      '  end\n' +
      '  enrich --> orders\n' +
      '  payments --> db[(Postgres)]\n' +
      '  reject --> db',
    sequence:
      'sequenceDiagram\n' +
      '  autonumber\n' +
      '  actor Reader as Reader\n' +
      '  participant API as Order API\n' +
      '  participant PSP as Stripe\n' +
      '  Reader->>API: POST /checkout\n' +
      '  API->>PSP: create charge\n' +
      '  alt approved\n' +
      '    PSP-->>API: succeeded\n' +
      '    API-->>Reader: 201 Created\n' +
      '  end',
    er:
      'erDiagram\n' +
      '  CUSTOMER ||--o{ ORDER : places\n' +
      '  ORDER ||--|{ LINE_ITEM : contains\n' +
      '  ORDER ||--o| PAYMENT : settled_by\n' +
      '  CUSTOMER {\n' +
      '    bigint id PK\n' +
      '    string email UK\n' +
      '  }\n' +
      '  ORDER {\n' +
      '    bigint id PK\n' +
      '    bigint customer_id FK\n' +
      '    string status\n' +
      '  }'
  };

  function doImport(text) {
    if (!text || !text.trim()) { log('nothing to import', 'err'); return; }
    var fresh = new G.Graph(G.createDocument({}), registry);
    var result;
    try { result = IO.importMermaid(text, fresh); }
    catch (err) { log('import failed: ' + err.message, 'err'); return; }
    graph = fresh;
    view.graph = graph;
    view.selection = null;
    log('imported ' + result.dialect + ': ' + graph.allNodes().length + ' nodes, ' +
      graph.allEdges().length + ' edges', 'ok');
    (result.warnings || []).forEach(function (w) { log('  note: ' + w, 'warn'); });
    refresh();
  }

  function doExport() {
    try {
      var text = IO.exportMermaid(graph);
      $('mermaid-io').value = text;
      $('io-panel').open = true;
      log('exported ' + text.split('\n').length + ' lines of Mermaid', 'ok');
    } catch (err) { log('export failed: ' + err.message, 'err'); }
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- boot ---------------- */

  function boot() {
    view = new window.Renderer($('canvas-host'), graph, {
      onSelect: function () { renderInspector(); },
      onLog: function (m) { log(m); },
      onCollapse: function (id, c) { guard(c ? 'collapsed' : 'expanded', function () { G.ops.collapse(graph, id, c); }); },
      onMove: function (id, pos) { G.ops.setView(graph, id, pos); },
      onReattach: function (id) { guard('reattached', function () { G.ops.attach(graph, id); }); },
      onConnect: function (from, to) {
        guard('connected', function () { G.ops.connect(graph, from, to); });
      }
    });

    // palette
    var pal = $('palette');
    T.palette.forEach(function (Type) {
      var b = document.createElement('button');
      b.textContent = '+ ' + Type.label;
      b.title = Type.type;
      b.addEventListener('click', function () {
        var parent = null;
        if (view.selection && view.selection.kind === 'node') {
          var host = graph.node(view.selection.id);
          var d = registry.describe(host.type);
          if (d && d.allowsChildren !== false) parent = host.id;
        }
        guard('added ' + Type.label + (parent ? ' inside selection' : ''), function () {
          var id = G.ops.addNode(graph, { type: Type.type, parent: parent });
          view.selection = { kind: 'node', id: id };
        });
      });
      pal.appendChild(b);
    });

    // presets
    var pre = $('presets');
    Object.keys(presets).forEach(function (name) {
      var b = document.createElement('button');
      b.textContent = name;
      b.addEventListener('click', function () {
        try { presets[name](); } catch (err) { log('preset failed: ' + err.message, 'err'); }
        refresh();
      });
      pre.appendChild(b);
    });

    // sample loaders
    Object.keys(SAMPLES).forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = k + '.mmd';
      b.addEventListener('click', function () {
        $('mermaid-io').value = SAMPLES[k];
        $('io-panel').open = true;
        log('loaded the ' + k + ' sample into the box — press Import');
      });
      $('samples').appendChild(b);
    });

    $('btn-import').addEventListener('click', function () { doImport($('mermaid-io').value); });
    $('btn-export').addEventListener('click', doExport);
    $('btn-download').addEventListener('click', function () {
      var text = $('mermaid-io').value || IO.exportMermaid(graph);
      download((graph.doc.kind || 'map') + '.mmd', text);
    });
    $('btn-file').addEventListener('change', function (ev) {
      var f = ev.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { $('mermaid-io').value = r.result; doImport(r.result); };
      r.readAsText(f);
      ev.target.value = '';
    });
    $('btn-clear').addEventListener('click', function () {
      reset('generic', 'Empty map');
      log('cleared');
      refresh();
    });
    $('btn-cancel-link').addEventListener('click', function () {
      view.pendingPort = null;
      log('link cancelled');
      refresh();
    });
    $('btn-registry').addEventListener('click', function () {
      $('json-out').value = JSON.stringify(registry.toJSON(), null, 2);
      $('json-panel').open = true;
      log('registry exported as plain data — this is what a non-JS backend consumes');
    });
    $('btn-json').addEventListener('click', function () {
      $('json-out').value = JSON.stringify(graph.toJSON(), null, 2);
      $('json-panel').open = true;
    });
    $('canvas-host').addEventListener('click', function () {
      if (view.pendingPort) { view.pendingPort = null; view.draw(); return; }
      view.select(null);
    });

    presets['branching (auto split)']();
    refresh();
    log('Ready. Click an out-port (right side) then an in-port (left side) to link.');
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
