/* selftest.mjs — headless check of the library, the custom node and Mermaid IO.
 * Run with:  node selftest.mjs
 * No dependencies. Exercises the same code paths the buttons in example.html use.
 */
import { readFileSync } from 'node:fs';

const load = (f) => (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
load('./graph-core.js');
load('./node-types.js');
load('./mermaid-io.js');

const { GraphCore, DemoTypes, MermaidIO } = globalThis;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

function newGraph(kind) {
  const reg = new GraphCore.TypeRegistry().register.apply(new GraphCore.TypeRegistry(), DemoTypes.all);
  const r = new GraphCore.TypeRegistry();
  r.register.apply(r, DemoTypes.all);
  return new GraphCore.Graph(GraphCore.createDocument({ kind: kind || 'generic' }), r);
}

/* ------------------------------------------------------------------ */
section('single node');
{
  const g = newGraph();
  const id = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'Only node' });
  check('node exists', !!g.node(id));
  check('id is a 26-char ULID', /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id), id);
  check('ports come from the registry', g.portsOf(id).length === 2);
  check('output capacity is 1', g.port(id, 'out').capacity === 1);
  check('no errors', g.validate().filter((i) => i.level === 'error').length === 0);
}

/* ------------------------------------------------------------------ */
section('one node of every palette type');
{
  const g = newGraph();
  const ids = DemoTypes.palette.map((T) => GraphCore.ops.addNode(g, { type: T.type }));
  check('all placed', ids.length === DemoTypes.palette.length);
  const errs = g.validate().filter((i) => i.level === 'error');
  check('no errors', errs.length === 0, JSON.stringify(errs));
  // the dilemma brought its own children
  const dilemma = g.allNodes().find((n) => n.type === 'demo.dilemma');
  check('dilemma auto-created 2 children', g.childNodeCount(dilemma.id) === 2,
    'got ' + g.childNodeCount(dilemma.id));
  check('dilemma children are linked', g.allEdges().some((e) =>
    g.node(e.from.node).parent === dilemma.id && g.node(e.to.node).parent === dilemma.id));
}

/* ------------------------------------------------------------------ */
section('linking nodes');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.start', label: 'A' });
  const b = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'B' });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: b, port: 'in' });
  check('edge created', g.allEdges().length === 1);
  check('edge is level-local', g.allEdges()[0].parent === null);
  let threw = false;
  try { GraphCore.ops.connect(g, { node: b, port: 'in' }, { node: a, port: 'out' }); }
  catch (e) { threw = true; }
  check('refuses to start an edge at an in-port', threw);
  GraphCore.ops.disconnectEdge(g, g.allEdges()[0].id);
  check('edge removed', g.allEdges().length === 0);
}

/* ------------------------------------------------------------------ */
section('overflow inserts a branch split (custom node, not library logic)');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'A' });
  const b = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'B' });
  const c = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'C' });

  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: b, port: 'in' });
  check('first connection is direct', g.allEdges().length === 1);

  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: c, port: 'in' });
  const splits = g.allNodes().filter((n) => n.type === 'demo.branchSplit');
  check('a split appeared', splits.length === 1, 'found ' + splits.length);
  const split = splits[0];
  check('split marked origin=auto', split.data.origin === 'auto');
  check('A now feeds the split', g.activeEdgesFrom(a).length === 1 &&
    g.activeEdgesFrom(a)[0].to.node === split.id);
  check('split feeds both targets', g.activeEdgesFrom(split.id).length === 2);
  check('a spare out-port was grown', g.portsOf(split.id)
    .filter((p) => p.direction === 'out').length === 3);
  check('capacity respected', g.validate().filter((i) => i.level === 'error').length === 0);

  // third branch
  const d = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'D' });
  const spare = g.portsOf(split.id).filter((p) => p.direction === 'out')
    .find((p) => g.activeEdgesFromPort(split.id, p.id).length === 0);
  GraphCore.ops.connect(g, { node: split.id, port: spare.id }, { node: d, port: 'in' });
  check('third branch attached', g.activeEdgesFrom(split.id).length === 3);
  check('still exactly one split', g.allNodes().filter((n) => n.type === 'demo.branchSplit').length === 1);
}

/* ------------------------------------------------------------------ */
section('split collapses when it stops branching');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'A' });
  const b = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'B' });
  const c = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'C' });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: b, port: 'in' });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: c, port: 'in' });
  const split = g.allNodes().find((n) => n.type === 'demo.branchSplit');

  // remove the branch leading to C
  const toC = g.activeEdgesTo(c)[0];
  GraphCore.ops.disconnectEdge(g, toC.id);

  check('split removed itself', !g.node(split.id));
  check('A connects straight to B again', g.activeEdgesFrom(a).length === 1 &&
    g.activeEdgesFrom(a)[0].to.node === b);
  check('no orphan edges', g.allEdges().length === 1);
  check('valid', g.validate().filter((i) => i.level === 'error').length === 0);
}

section('an authored split is never auto-removed');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'A' });
  const b = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'B' });
  const s = GraphCore.ops.addNode(g, { type: 'demo.branchSplit', label: 'Mine', data: { origin: 'authored' } });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: s, port: 'in' });
  GraphCore.ops.connect(g, { node: s, port: 'out.0' }, { node: b, port: 'in' });
  check('survives with 1 in / 1 out', !!g.node(s));
  const warns = g.validate().filter((i) => i.level === 'warn' && i.nodeId === s);
  check('but is reported by the lint', warns.length === 1, JSON.stringify(warns));
}

section('a split that became a subgraph is never auto-removed');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'A' });
  const b = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'B' });
  const c = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'C' });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: b, port: 'in' });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: c, port: 'in' });
  const split = g.allNodes().find((n) => n.type === 'demo.branchSplit');
  GraphCore.ops.addNode(g, { type: 'demo.step', label: 'inside', parent: split.id });
  GraphCore.ops.disconnectEdge(g, g.activeEdgesTo(c)[0].id);
  check('kept because it has a child', !!g.node(split.id));
}

/* ------------------------------------------------------------------ */
section('subgraphs, containment and collapse');
{
  const g = newGraph();
  const grp = GraphCore.ops.addNode(g, { type: 'demo.group', label: 'Group' });
  const x = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'X', parent: grp });
  const y = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'Y', parent: grp });
  GraphCore.ops.connect(g, { node: x, port: 'out' }, { node: y, port: 'in' });
  check('children counted', g.childNodeCount(grp) === 2);
  check('visible walk includes children', g.visibleNodes().length === 3);
  GraphCore.ops.collapse(g, grp, true);
  check('collapsed hides children', g.visibleNodes().length === 1);
  check('collapse rewrote no edges', g.allEdges().length === 1);
  GraphCore.ops.collapse(g, grp, false);

  const outside = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'Outside' });
  let threw = false;
  try { GraphCore.ops.reparent(g, grp, x); } catch (e) { threw = true; }
  check('refuses a containment cycle', threw);
  GraphCore.ops.reparent(g, y, null);
  check('reparent moved the node out', g.node(y).parent === null);
  check('the crossing edge was dropped', g.allEdges().length === 0);
  check('valid', g.validate().filter((i) => i.level === 'error').length === 0);
}

/* ------------------------------------------------------------------ */
section('edit, detach, disconnect, purge');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'A' });
  const b = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'B' });
  GraphCore.ops.connect(g, { node: a, port: 'out' }, { node: b, port: 'in' }, { label: 'goes to' });

  GraphCore.ops.updateNode(g, a, { label: 'Renamed', data: { note: 'hello' } });
  check('label edited', g.node(a).label === 'Renamed');
  check('data merged', g.node(a).data.note === 'hello');
  check('rename touched no edges', g.allEdges().length === 1);

  const e = g.allEdges()[0];
  GraphCore.ops.setEdge(g, e.id, { label: 'renamed edge', data: { weight: 3 } });
  check('edge label edited', g.edge(e.id).label === 'renamed edge');
  check('edge metadata stored', g.edge(e.id).data.weight === 3);

  GraphCore.ops.detach(g, b);
  check('node detached', g.node(b).state === 'detached');
  check('its edge is parked, not deleted', g.edge(e.id).state === 'detached');
  GraphCore.ops.attach(g, b);
  check('reattach restored the wiring', g.edge(e.id).state === 'active');

  let threw = false;
  try { GraphCore.ops.purge(g, b); } catch (err) { threw = true; }
  check('purge refused while connected', threw);
  GraphCore.ops.disconnect(g, b);
  check('disconnect removed edges', g.allEdges().length === 0);
  GraphCore.ops.purge(g, b);
  check('purge succeeded once isolated', !g.node(b));
}

/* ------------------------------------------------------------------ */
section('mermaid import');
const samples = {
  flowchart: readFileSync(new URL('./samples/flowchart.mmd', import.meta.url), 'utf8'),
  sequence: readFileSync(new URL('./samples/sequence.mmd', import.meta.url), 'utf8'),
  er: readFileSync(new URL('./samples/er.mmd', import.meta.url), 'utf8')
};
{
  const g = newGraph();
  const r = MermaidIO.importMermaid(samples.flowchart, g);
  check('dialect detected', r.dialect === 'flowchart');
  check('nodes imported', g.allNodes().length >= 9, 'got ' + g.allNodes().length);
  check('edges imported', g.allEdges().length >= 7, 'got ' + g.allEdges().length);
  const grp = g.allNodes().find((n) => n.key === 'core');
  check('subgraph became a container', grp && g.childNodeCount(grp.id) >= 2);
  check('boundary portals inserted', g.allNodes().some((n) => n.type === 'core.portal'));
  const errs = g.validate().filter((i) => i.level === 'error');
  check('imported document is valid', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  check('labels preserved', g.allNodes().some((n) => n.label === 'Validate payload'));
  check('edge labels preserved', g.allEdges().some((e) => e.label === 'yes'));
}
{
  const g = newGraph();
  const r = MermaidIO.importMermaid(samples.sequence, g);
  check('dialect detected', r.dialect === 'sequenceDiagram');
  check('participants imported', g.allNodes().filter((n) => n.type === 'demo.lane').length === 3);
  check('messages imported', g.allEdges().length === 4, 'got ' + g.allEdges().length);
  check('alt block became a container', g.allNodes().some((n) => n.type === 'demo.group'));
  check('autonumber captured', !!(g.doc.meta.sequence || {}).autonumber);
  check('valid', g.validate().filter((i) => i.level === 'error').length === 0);
}
{
  const g = newGraph();
  const r = MermaidIO.importMermaid(samples.er, g);
  check('dialect detected', r.dialect === 'erDiagram');
  check('entities imported', g.allNodes().length === 4, 'got ' + g.allNodes().length);
  check('relationships imported', g.allEdges().length === 3);
  const cust = g.allNodes().find((n) => n.key === 'CUSTOMER');
  check('attributes parsed', cust.data.attributes.length === 2, JSON.stringify(cust.data.attributes));
  check('PK captured', cust.data.attributes[0].keys[0] === 'PK');
  check('cardinality captured', g.allEdges()[0].data.to.cardinality === 'zeroOrMany');
  check('valid', g.validate().filter((i) => i.level === 'error').length === 0);
}

/* ------------------------------------------------------------------ */
section('mermaid export and round trip');
for (const [name, text] of Object.entries(samples)) {
  const g1 = newGraph();
  MermaidIO.importMermaid(text, g1);
  const out = MermaidIO.exportMermaid(g1);
  check(name + ': export is non-empty', out.length > 20);
  const g2 = newGraph();
  let ok = true, why = '';
  try { MermaidIO.importMermaid(out, g2); } catch (e) { ok = false; why = e.message; }
  check(name + ': exported text re-imports', ok, why);
  if (ok) {
    check(name + ': round trip keeps node count',
      g2.allNodes().length >= g1.allNodes().filter((n) => n.type !== 'core.portal').length - 1,
      g1.allNodes().length + ' → ' + g2.allNodes().length);
    check(name + ': round trip is valid',
      g2.validate().filter((i) => i.level === 'error').length === 0);
  }
}

/* ------------------------------------------------------------------ */
section('registry exports plain data for a non-JS consumer');
{
  const g = newGraph();
  const json = g.registry.toJSON();
  check('every type described', Object.keys(json).length === DemoTypes.all.length);
  check('descriptor has ports', !!json['demo.step'].ports.out);
  check('descriptor names its overflow handler', json['demo.step'].onOverflow === 'demo.branchSplit');
  check('no rendering fields leaked', !('component' in json['demo.step']) && !('icon' in json['demo.step']));
  check('serialises', typeof JSON.stringify(json) === 'string');
}

section('unknown types are tolerated, not fatal');
{
  const g = newGraph();
  const id = GraphCore.ops.addNode(g, { type: 'someone.elses.type', label: 'From the future' });
  const errs = g.validate().filter((i) => i.level === 'error');
  const warns = g.validate().filter((i) => i.level === 'warn');
  check('node kept', !!g.node(id));
  check('no error raised', errs.length === 0, JSON.stringify(errs));
  check('warning raised instead', warns.some((w) => /unknown type/.test(w.message)));
}

section('a failing mutation leaves the document untouched');
{
  const g = newGraph();
  const a = GraphCore.ops.addNode(g, { type: 'demo.step', label: 'A' });
  const before = JSON.stringify(g.toJSON());
  let threw = false;
  try {
    g.apply(function (ctx) {
      ctx.createNode({ type: 'demo.step', label: 'ghost' });
      throw new Error('boom');
    });
  } catch (e) { threw = true; }
  check('error propagated', threw);
  check('nothing was written', JSON.stringify(g.toJSON()) === before);
  check('still one node', g.allNodes().length === 1 && !!g.node(a));
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' checks)');
process.exit(fail === 0 ? 0 : 1);
