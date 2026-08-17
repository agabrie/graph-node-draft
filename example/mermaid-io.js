/* mermaid-io.js — the import/export adapter.
 *
 * This is the only file that knows Mermaid exists. It translates between Mermaid
 * text and a graph document; nothing it knows leaks into the library or the types.
 *
 * Deliberately a small line-based parser, not a full grammar. It handles the
 * constructs listed in each section and reports everything else as a warning
 * rather than dropping it silently.
 */


/* ---------------- shape and arrow tables ---------------- */

// Longest delimiters first, or '[[' is misread as '[' and the label keeps a bracket.
var SHAPES = [
  { open: '[[', close: ']]', type: 'demo.step' },
  { open: '[(', close: ')]', type: 'demo.store' },
  { open: '([', close: '])', type: 'demo.start' },
  { open: '[/', close: '/]', type: 'demo.step' },
  { open: '{{', close: '}}', type: 'demo.step' },
  { open: '((', close: '))', type: 'demo.start' },
  { open: '{', close: '}', type: 'demo.decision' },
  { open: '(', close: ')', type: 'demo.step' },
  { open: '[', close: ']', type: 'demo.step' }
];

var ARROWS = [
  { token: '-.->', line: 'dashed', arrowEnd: 'arrow' },
  { token: '==>', line: 'thick', arrowEnd: 'arrow' },
  { token: '-->', line: 'solid', arrowEnd: 'arrow' },
  { token: '--o', line: 'solid', arrowEnd: 'circle' },
  { token: '--x', line: 'solid', arrowEnd: 'cross' },
  { token: '---', line: 'solid', arrowEnd: 'none' }
];

var SEQ_ARROWS = [
  { token: '-->>', line: 'dashed', arrowEnd: 'arrow' },
  { token: '->>', line: 'solid', arrowEnd: 'arrow' },
  { token: '-->', line: 'dashed', arrowEnd: 'none' },
  { token: '->', line: 'solid', arrowEnd: 'none' }
];

var CARD_L = { '||': 'one', '|o': 'zeroOrOne', '}o': 'zeroOrMany', '}|': 'oneOrMany' };
var CARD_R = { '||': 'one', 'o|': 'zeroOrOne', 'o{': 'zeroOrMany', '|{': 'oneOrMany' };

/* ---------------- helpers ---------------- */

function lines(text) {
  return text.split(/\r?\n/)
    .map(function (l) { return l.replace(/%%.*$/, '').trim(); })
    .filter(function (l) { return l.length > 0; });
}

function parseNodeToken(tok) {
  tok = tok.trim();
  for (var i = 0; i < SHAPES.length; i++) {
    var s = SHAPES[i];
    var o = tok.indexOf(s.open);
    if (o > 0 && tok.slice(-s.close.length) === s.close) {
      return {
        key: tok.slice(0, o).trim(),
        label: tok.slice(o + s.open.length, tok.length - s.close.length).replace(/^"|"$/g, '').trim(),
        type: s.type
      };
    }
  }
  return { key: tok, label: null, type: 'demo.step' };
}

/* ---------------- flowchart import ---------------- */

function importFlowchart(text, graph) {
  var warnings = [];
  var byKey = {};
  var stack = [];      // subgraph containment
  var pendingEdges = [];
  var direction = 'LR';

  var ls = lines(text);
  var first = ls.shift() || '';
  var dm = first.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)/i);
  if (dm) direction = dm[1].toUpperCase();

  graph.apply(function (ctx) {
    ctx.doc.kind = 'flowchart';
    ctx.doc.meta.layout = { direction: direction };
    ctx.doc.title = 'Imported flowchart';

    function ensure(tok) {
      var p = parseNodeToken(tok);
      var scope = stack.length ? stack[stack.length - 1] : null;
      if (byKey[p.key]) {
        if (p.label) ctx.updateNode(byKey[p.key], { label: p.label, type: p.type });
        return byKey[p.key];
      }
      var id = ctx.createNode({
        type: p.type, key: p.key, label: p.label || p.key, parent: scope
      });
      byKey[p.key] = id;
      return id;
    }

    ls.forEach(function (line) {
      var sg = line.match(/^subgraph\s+(\S+)(?:\s*\[(.+)\])?\s*$/i);
      if (sg) {
        var scope = stack.length ? stack[stack.length - 1] : null;
        var gid = ctx.createNode({
          type: 'demo.group', key: sg[1], label: sg[2] || sg[1], parent: scope
        });
        byKey[sg[1]] = gid;
        stack.push(gid);
        return;
      }
      if (/^end$/i.test(line)) { stack.pop(); return; }
      if (/^direction\s+/i.test(line)) return;
      if (/^(classDef|class|linkStyle|click|style)\b/.test(line)) {
        warnings.push('skipped: ' + line);
        return;
      }

      for (var i = 0; i < ARROWS.length; i++) {
        var a = ARROWS[i];
        var idx = line.indexOf(a.token);
        if (idx === -1) continue;
        var lhs = line.slice(0, idx);
        var rhs = line.slice(idx + a.token.length);
        var label = '';
        var lm = rhs.match(/^\s*\|([^|]*)\|/);
        if (lm) { label = lm[1].trim(); rhs = rhs.slice(lm[0].length); }
        pendingEdges.push({
          from: ensure(lhs), to: ensure(rhs), label: label, style: a,
          scope: stack.length ? stack[stack.length - 1] : null
        });
        return;
      }
      // a bare node declaration
      if (/^[A-Za-z_]/.test(line)) ensure(line);
      else warnings.push('unparsed: ' + line);
    });
  });

  // Second pass: wire edges, inserting portals where they cross a boundary.
  graph.apply(function (ctx) {
    pendingEdges.forEach(function (pe) {
      var a = ctx.parentOf(pe.from), b = ctx.parentOf(pe.to);
      var fromPort = pickOut(ctx, pe.from, pe.label), toPort = firstIn(ctx, pe.to);
      if (!toPort) {
        warnings.push('dropped an edge into ' + (ctx.node(pe.to).label || pe.to) +
          ' — that node type has no input');
        return;
      }
      if ((a || null) === (b || null)) {
        ctx.createEdge({
          from: { node: pe.from, port: fromPort }, to: { node: pe.to, port: toPort },
          label: pe.label, style: { line: pe.style.line, arrowEnd: pe.style.arrowEnd }
        });
        return;
      }
      // crossing: source outside, target inside a container (or vice versa)
      if (b && (a || null) !== b) {
        var portal = ctx.createNode({
          type: 'core.portal', key: null, label: 'in', parent: b, data: { port: 'in', direction: 'in' }
        });
        ctx.createEdge({
          from: { node: pe.from, port: fromPort }, to: { node: b, port: 'in' },
          label: pe.label, style: { line: pe.style.line, arrowEnd: pe.style.arrowEnd }
        });
        ctx.createEdge({ from: { node: portal, port: 'link' }, to: { node: pe.to, port: toPort } });
        warnings.push('inserted a boundary portal for an edge into ' + (ctx.node(b).label || b));
      } else if (a) {
        var portalOut = ctx.createNode({
          type: 'core.portal', key: null, label: 'out', parent: a, data: { port: 'out', direction: 'out' }
        });
        ctx.createEdge({ from: { node: pe.from, port: fromPort }, to: { node: portalOut, port: 'link' } });
        ctx.createEdge({
          from: { node: a, port: 'out' }, to: { node: pe.to, port: toPort },
          label: pe.label, style: { line: pe.style.line, arrowEnd: pe.style.arrowEnd }
        });
        warnings.push('inserted a boundary portal for an edge out of ' + (ctx.node(a).label || a));
      }
    });
  });

  return warnings;
}

var LABEL_TO_PORT = {
  yes: 'true', y: 'true', 'true': 'true', ok: 'true',
  no: 'false', n: 'false', 'false': 'false'
};

/**
 * Choose an out-port with room left, preferring one the edge label names.
 * Without this, a decision's two labelled branches both land on its first
 * port and immediately breach that port's capacity of one.
 */
function pickOut(ctx, id, label) {
  var ps = ctx.portsOf(id).filter(function (p) { return p.direction !== 'in'; });
  if (!ps.length) return 'out';

  var free = ps.filter(function (p) {
    if (p.capacity === null) return true;
    return ctx.activeEdgesFromPort(id, p.id).length < p.capacity;
  });

  var wanted = LABEL_TO_PORT[(label || '').trim().toLowerCase()];
  if (wanted) {
    var named = free.filter(function (p) { return p.id === wanted; })[0];
    if (named) return named.id;
  }
  if (label) {
    var byLabel = free.filter(function (p) {
      return (p.label || '').toLowerCase() === label.trim().toLowerCase();
    })[0];
    if (byLabel) return byLabel.id;
  }
  return (free[0] || ps[0]).id;
}

/** Null when the node has no port able to receive an edge. */
function firstIn(ctx, id) {
  var ps = ctx.portsOf(id).filter(function (p) { return p.direction !== 'out'; });
  return ps.length ? ps[0].id : null;
}

/* ---------------- sequence import ---------------- */

function importSequence(text, graph) {
  var warnings = [];
  var byKey = {};
  var blockStack = [];
  var ls = lines(text);
  ls.shift(); // sequenceDiagram

  graph.apply(function (ctx) {
    ctx.doc.kind = 'sequence';
    ctx.doc.title = 'Imported sequence';

    function lane(key) {
      if (byKey[key]) return byKey[key];
      var id = ctx.createNode({ type: 'demo.lane', key: key, label: key, parent: null });
      byKey[key] = id;
      return id;
    }

    ls.forEach(function (line) {
      var p = line.match(/^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i);
      if (p) {
        var id = lane(p[2]);
        if (p[3]) ctx.updateNode(id, { label: p[3].trim() });
        return;
      }
      if (/^autonumber/i.test(line)) { ctx.doc.meta.sequence = { autonumber: true }; return; }
      var blk = line.match(/^(alt|opt|loop|par|critical)\s*(.*)$/i);
      if (blk) {
        var gid = ctx.createNode({ type: 'demo.group', label: blk[1] + ' ' + (blk[2] || ''), parent: null });
        blockStack.push(gid);
        return;
      }
      if (/^else\b/i.test(line) || /^and\b/i.test(line)) return;
      if (/^end$/i.test(line)) { blockStack.pop(); return; }
      if (/^note\b/i.test(line)) { warnings.push('skipped note: ' + line); return; }

      for (var i = 0; i < SEQ_ARROWS.length; i++) {
        var a = SEQ_ARROWS[i];
        var idx = line.indexOf(a.token);
        if (idx === -1) continue;
        var lhs = line.slice(0, idx).trim();
        var rest = line.slice(idx + a.token.length);
        var colon = rest.indexOf(':');
        var rhs = (colon === -1 ? rest : rest.slice(0, colon)).trim().replace(/[+-]$/, '');
        var msg = colon === -1 ? '' : rest.slice(colon + 1).trim();
        ctx.createEdge({
          type: 'demo.message',
          from: { node: lane(lhs.replace(/[+-]$/, '')), port: 'lane' },
          to: { node: lane(rhs), port: 'lane' },
          parent: blockStack.length ? blockStack[blockStack.length - 1] : null,
          label: msg,
          style: { line: a.line, arrowEnd: a.arrowEnd }
        });
        return;
      }
      warnings.push('unparsed: ' + line);
    });
  });
  return warnings;
}

/* ---------------- ER import ---------------- */

function importEr(text, graph) {
  var warnings = [];
  var byKey = {};
  var ls = lines(text);
  ls.shift(); // erDiagram
  var current = null;

  graph.apply(function (ctx) {
    ctx.doc.kind = 'er';
    ctx.doc.title = 'Imported ER diagram';

    function entity(key) {
      if (byKey[key]) return byKey[key];
      var id = ctx.createNode({
        type: 'demo.entity', key: key, label: key, parent: null, data: { attributes: [] }
      });
      byKey[key] = id;
      return id;
    }

    ls.forEach(function (line) {
      if (current) {
        if (line === '}') { current = null; return; }
        var parts = line.replace(/"/g, '').split(/\s+/);
        if (parts.length >= 2) {
          var node = ctx.node(current);
          var attrs = (node.data.attributes || []).slice();
          attrs.push({
            type: parts[0], name: parts[1],
            keys: parts.slice(2).filter(function (k) { return /^(PK|FK|UK)$/.test(k); })
          });
          ctx.updateNode(current, { data: { attributes: attrs } });
        }
        return;
      }
      var open = line.match(/^(\S+)\s*\{$/);
      if (open) { current = entity(open[1]); return; }

      var rel = line.match(/^(\S+)\s+([|}o][|o{]?)(--|\.\.)([|}o][|o{]?)\s+(\S+)\s*:\s*(.+)$/);
      if (rel) {
        ctx.createEdge({
          type: 'demo.relationship',
          from: { node: entity(rel[1]), port: 'rel' },
          to: { node: entity(rel[5]), port: 'rel' },
          label: rel[6].replace(/"/g, '').trim(),
          style: { line: 'solid', arrowEnd: 'none' },
          data: {
            from: { cardinality: CARD_L[rel[2]] || 'one' },
            to: { cardinality: CARD_R[rel[4]] || 'zeroOrMany' },
            identifying: rel[3] === '--'
          }
        });
        return;
      }
      warnings.push('unparsed: ' + line);
    });
  });
  return warnings;
}

/* ---------------- import dispatch ---------------- */

function importMermaid(text, graph) {
  var head = (lines(text)[0] || '').toLowerCase();
  if (head.indexOf('sequencediagram') === 0) return { dialect: 'sequenceDiagram', warnings: importSequence(text, graph) };
  if (head.indexOf('erdiagram') === 0) return { dialect: 'erDiagram', warnings: importEr(text, graph) };
  if (head.indexOf('flowchart') === 0 || head.indexOf('graph') === 0) {
    return { dialect: 'flowchart', warnings: importFlowchart(text, graph) };
  }
  throw new Error('unsupported diagram type: "' + head + '"');
}

/* ---------------- export ---------------- */

var SHAPE_FOR = {
  'demo.start': ['([', '])'],
  'demo.end': ['([', '])'],
  'demo.step': ['[', ']'],
  'demo.store': ['[(', ')]'],
  'demo.decision': ['{', '}'],
  'demo.dilemma': ['[[', ']]'],
  'demo.branchSplit': ['{', '}']
};

function safeKey(n, used) {
  var base = (n.key || n.label || 'n').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, 'n$1') || 'n';
  if (base.toLowerCase() === 'end') base = 'end_';
  var k = base, i = 2;
  while (used[k]) k = base + '_' + (i++);
  used[k] = 1;
  return k;
}

function exportMermaid(graph) {
  var kind = graph.doc.kind;
  if (kind === 'sequence') return exportSequence(graph);
  if (kind === 'er') return exportEr(graph);
  return exportFlowchart(graph);
}

function exportFlowchart(graph) {
  var dir = (graph.doc.meta.layout || {}).direction || 'LR';
  var out = ['flowchart ' + dir];
  var used = {}, keys = {};

  graph.allNodes().forEach(function (n) { keys[n.id] = safeKey(n, used); });

  function emitNode(n, indent) {
    var sh = SHAPE_FOR[n.type] || ['[', ']'];
    var label = (n.label || keys[n.id]).replace(/"/g, '#quot;');
    out.push(indent + keys[n.id] + sh[0] + '"' + label + '"' + sh[1]);
  }

  function emitLevel(parentId, indent) {
    graph.childrenOf(parentId).forEach(function (n) {
      if (n.state !== 'active') return;
      if (n.type === 'core.portal') return;   // machinery, not part of the source
      if (graph.childNodeCount(n.id) > 0) {
        out.push(indent + 'subgraph ' + keys[n.id] + ' ["' + (n.label || '') + '"]');
        emitLevel(n.id, indent + '  ');
        out.push(indent + 'end');
      } else {
        emitNode(n, indent);
      }
    });
  }
  emitLevel(null, '  ');

  // Portals collapse back out. The exterior half of a crossing already points
  // at the container itself, which is valid Mermaid, so every edge touching a
  // portal is dropped and no synthetic node reaches the output.
  var isPortal = {};
  graph.allNodes().forEach(function (n) {
    if (n.type === 'core.portal') isPortal[n.id] = true;
  });

  graph.activeEdges().forEach(function (e) {
    var fromNode = e.from.node, toNode = e.to.node;
    if (isPortal[fromNode] || isPortal[toNode]) return;
    if (!keys[fromNode] || !keys[toNode]) return;
    var arrow = e.style && e.style.line === 'dashed' ? '-.->'
      : e.style && e.style.line === 'thick' ? '==>'
        : e.style && e.style.arrowEnd === 'none' ? '---' : '-->';
    var label = e.label ? '|"' + e.label.replace(/"/g, '#quot;') + '"|' : '';
    out.push('  ' + keys[fromNode] + ' ' + arrow + label + ' ' + keys[toNode]);
  });

  return out.join('\n');
}

function exportSequence(graph) {
  var out = ['sequenceDiagram'];
  if ((graph.doc.meta.sequence || {}).autonumber) out.push('  autonumber');
  var used = {}, keys = {};
  var lanes = graph.allNodes().filter(function (n) { return n.type === 'demo.lane'; });
  lanes.forEach(function (n) {
    keys[n.id] = safeKey(n, used);
    out.push('  participant ' + keys[n.id] + ' as ' + (n.label || keys[n.id]));
  });
  var blocks = {};
  graph.allNodes().forEach(function (n) { if (n.type === 'demo.group') blocks[n.id] = n; });

  var msgs = graph.activeEdges()
    .filter(function (e) { return keys[e.from.node] && keys[e.to.node]; })
    .sort(function (a, b) { return (a.rank || '').localeCompare(b.rank || ''); });

  var openBlock = null;
  msgs.forEach(function (e) {
    var b = e.parent && blocks[e.parent] ? e.parent : null;
    if (b !== openBlock) {
      if (openBlock) out.push('  end');
      if (b) out.push('  ' + (blocks[b].label || 'alt'));
      openBlock = b;
    }
    var arrow = e.style && e.style.line === 'dashed' ? '-->>' : '->>';
    var pad = openBlock ? '    ' : '  ';
    out.push(pad + keys[e.from.node] + arrow + keys[e.to.node] + ': ' + (e.label || ''));
  });
  if (openBlock) out.push('  end');
  return out.join('\n');
}

var CARD_OUT_L = { one: '||', zeroOrOne: '|o', zeroOrMany: '}o', oneOrMany: '}|' };
var CARD_OUT_R = { one: '||', zeroOrOne: 'o|', zeroOrMany: 'o{', oneOrMany: '|{' };

function exportEr(graph) {
  var out = ['erDiagram'];
  var used = {}, keys = {};
  var ents = graph.allNodes().filter(function (n) { return n.type === 'demo.entity'; });
  ents.forEach(function (n) { keys[n.id] = safeKey(n, used).toUpperCase(); });

  graph.activeEdges().forEach(function (e) {
    if (!keys[e.from.node] || !keys[e.to.node]) return;
    var d = e.data || {};
    var l = CARD_OUT_L[(d.from || {}).cardinality] || '||';
    var r = CARD_OUT_R[(d.to || {}).cardinality] || 'o{';
    var link = d.identifying === false ? '..' : '--';
    out.push('  ' + keys[e.from.node] + ' ' + l + link + r + ' ' + keys[e.to.node] +
      ' : ' + (e.label || 'relates'));
  });

  ents.forEach(function (n) {
    var attrs = (n.data || {}).attributes || [];
    if (!attrs.length) return;
    out.push('  ' + keys[n.id] + ' {');
    attrs.forEach(function (a) {
      out.push('    ' + (a.type || 'string') + ' ' + a.name +
        (a.keys && a.keys.length ? ' ' + a.keys.join(' ') : ''));
    });
    out.push('  }');
  });
  return out.join('\n');
}

export const MermaidIO = {
  importMermaid: importMermaid,
  exportMermaid: exportMermaid,
  exportFlowchart: exportFlowchart
};
