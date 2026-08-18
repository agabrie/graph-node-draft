/* test/selftest.mjs — headless check of lib/, against docs/domain-shape.md.
 * Run with:  node test/selftest.mjs   (also npm run test:lib)
 * No dependencies.
 */
import GraphKit, { BaseNodeType } from '../lib/index.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

function newGraph(registry) {
  return new GraphKit.Graph(GraphKit.createDocument({}), registry || new GraphKit.TypeRegistry());
}

/* ------------------------------------------------------------------ */
section('factories refuse malformed input');
{
  let threw = false;
  try { GraphKit.NodeFactory.create({}, {}); } catch (e) { threw = true; }
  check('NodeFactory requires an id', threw);

  threw = false;
  try { GraphKit.EdgeFactory.create({ from: 'a' }, { id: 'x' }); } catch (e) { threw = true; }
  check('EdgeFactory requires "to"', threw);

  threw = false;
  try { GraphKit.EdgeFactory.create({ to: 'b' }, { id: 'x' }); } catch (e) { threw = true; }
  check('EdgeFactory requires "from"', threw);

  threw = false;
  try { GraphKit.MetadataFactory.create('not an object', { id: 'x' }); } catch (e) { threw = true; }
  check('MetadataFactory refuses non-object fields', threw);
}

/* ------------------------------------------------------------------ */
section('nodes are untyped by default, and that is legal');
{
  const g = newGraph();
  const a = GraphKit.ops.addNode(g, {});
  check('node created with no meta', g.node(a).meta === null);
  check('typeOf is null, not an error', g.typeOf(a) === null);
  check('valid with no type at all', g.validate().filter((i) => i.level === 'error').length === 0);
}

/* ------------------------------------------------------------------ */
section('metadata: create, patch, and share');
{
  const g = newGraph();
  const a = GraphKit.ops.addNode(g, { meta: { type: 'demo.thing', label: 'A', x: 10, y: 20 } });
  check('inline meta created a record', !!g.node(a).meta);
  check('metaOf resolves it', g.metaOf('node', a).label === 'A');
  check('typeOf reads through meta', g.typeOf(a) === 'demo.thing');

  GraphKit.ops.setNodeMeta(g, a, { label: 'Renamed' });
  check('setNodeMeta merges, does not replace', g.metaOf('node', a).label === 'Renamed' && g.metaOf('node', a).type === 'demo.thing');

  const b = GraphKit.ops.addNode(g, {});
  GraphKit.ops.linkMeta(g, 'node', b, g.node(a).meta);
  check('linkMeta shares the record', g.node(b).meta === g.node(a).meta);
  check('shared record means shared type', g.typeOf(b) === 'demo.thing');

  GraphKit.ops.setNodeMeta(g, b, { label: 'B only' });
  check('editing through one owner is visible to the other (same record)', g.metaOf('node', a).label === 'B only');

  let threw = false;
  try { GraphKit.ops.linkMeta(g, 'node', a, 'nonexistent'); } catch (e) { threw = true; }
  check('linkMeta refuses an unknown record', threw);
}

/* ------------------------------------------------------------------ */
section('edges: node-to-node, no ports, free to cross containment');
{
  const g = newGraph();
  const group = GraphKit.ops.addNode(g, { meta: { label: 'Group' } });
  const inside = GraphKit.ops.addNode(g, { parent: group, meta: { label: 'Inside' } });
  const outside = GraphKit.ops.addNode(g, { meta: { label: 'Outside' } });

  const e = GraphKit.ops.connect(g, outside, inside, { meta: { label: 'crosses in' } });
  check('edge created straight across the boundary', g.edge(e).from === outside && g.edge(e).to === inside);
  check('edge metadata resolves', g.metaOf('edge', e).label === 'crosses in');
  check('no error — crossing edges are legal', g.validate().filter((i) => i.level === 'error').length === 0);

  let threw = false;
  try { GraphKit.ops.reparent(g, group, inside); } catch (err) { threw = true; }
  check('reparent still refuses a containment cycle', threw);

  GraphKit.ops.reparent(g, inside, null);
  check('reparent moved the node out', g.node(inside).parent === null);
  check('the crossing edge survives reparenting (old portal rule is gone)', g.allEdges().length === 1);

  threw = false;
  try { GraphKit.ops.connect(g, outside, 'no-such-node'); } catch (err) { threw = true; }
  check('connect refuses a missing endpoint', threw);
}

/* ------------------------------------------------------------------ */
section('edit, detach, disconnect, purge');
{
  const g = newGraph();
  const a = GraphKit.ops.addNode(g, { meta: { label: 'A' } });
  const b = GraphKit.ops.addNode(g, { meta: { label: 'B' } });
  const e = GraphKit.ops.connect(g, a, b, { meta: { label: 'goes to' } });

  GraphKit.ops.setNodeData(g, a, { note: 'hello' });
  check('data patched', g.node(a).data.note === 'hello');
  check('data edit touched no edges', g.allEdges().length === 1);

  GraphKit.ops.setEdgeData(g, e, { weight: 3 });
  check('edge data stored', g.edge(e).data.weight === 3);

  GraphKit.ops.detach(g, b);
  check('node detached', g.node(b).state === 'detached');
  check('its edge is parked, not deleted', g.edge(e).state === 'detached');
  GraphKit.ops.attach(g, b);
  check('reattach restored the wiring', g.edge(e).state === 'active');

  let threw = false;
  try { GraphKit.ops.purge(g, b); } catch (err) { threw = true; }
  check('purge refused while connected', threw);
  GraphKit.ops.disconnect(g, b);
  check('disconnect removed edges', g.allEdges().length === 0);
  GraphKit.ops.purge(g, b);
  check('purge succeeded once isolated', !g.node(b));
}

/* ------------------------------------------------------------------ *
 * mutate() writes straight to the live document (no staged copy, no
 * rollback — see Graph.js's mutate() docstring). A throwing hook stops the
 * batch but does not undo what already ran before the throw.
 * ------------------------------------------------------------------ */
section('a throwing hook stops the batch but does not roll back prior writes');
{
  function BoomType() {}
  BoomType.prototype = Object.create(BaseNodeType.prototype);
  BoomType.type = 'demo.boom';
  BoomType.label = 'Boom';
  BoomType.describe = () => ({ allowsChildren: true });
  BoomType.prototype.onCreate = function () { throw new Error('nope'); };

  const registry = new GraphKit.TypeRegistry().register(BoomType);
  const g = newGraph(registry);
  const before = g.allNodes().length;
  let threw = false;
  try { GraphKit.ops.addNode(g, { meta: { type: 'demo.boom' } }); } catch (e) { threw = true; }
  check('the throw propagated', threw);
  check('the node the hook was attached to was still written', g.allNodes().length === before + 1);
}

/* ------------------------------------------------------------------ */
section('unregistered types are tolerated, not fatal (portability)');
{
  const g = newGraph(); // empty registry — nothing registered
  const id = GraphKit.ops.addNode(g, { meta: { type: 'consumer.custom' } });
  check('node with an unregistered type still exists', !!g.node(id));
  const issues = g.validate();
  check('no errors', issues.filter((i) => i.level === 'error').length === 0);
  check('a warning notes the unknown type', issues.some((i) => i.level === 'warn' && /unknown type/.test(i.message)));
}

/* ------------------------------------------------------------------ *
 * The point of the whole exercise: a consumer type manages its own
 * fan-out entirely through hooks. The library has no concept of ports,
 * capacity, or an overflow trigger — it only fires onEdgeAdded /
 * onEdgeRemoved and lets the type read/write the document through ctx.
 * ------------------------------------------------------------------ */
section('consumer-owned branching, built only from hooks');

function StepType() {}
StepType.prototype = Object.create(BaseNodeType.prototype);
StepType.type = 'demo.step';
StepType.label = 'Step';
StepType.describe = () => ({ allowsChildren: false });
/** The moment a step gets a second outgoing edge, move both onto a fresh
 *  split node. This is entirely consumer policy — the library never
 *  inspects edge counts on its own. */
StepType.prototype.onEdgeAdded = function (ctx, edge) {
  if (edge.from !== this.id) return;
  const outs = ctx.activeEdgesFrom(this.id);
  if (outs.length !== 2) return; // fire exactly once, at the second edge
  const split = ctx.createNode({
    parent: ctx.parentOf(this.id),
    meta: { type: 'demo.branchSplit', label: 'Split' },
    data: { origin: 'auto' }
  });
  outs.forEach((e) => ctx.retargetEdge(e.id, split, 'from'));
  ctx.createEdge({ from: this.id, to: split });
};

function BranchSplitType() {}
BranchSplitType.prototype = Object.create(BaseNodeType.prototype);
BranchSplitType.type = 'demo.branchSplit';
BranchSplitType.label = 'Branch split';
BranchSplitType.describe = () => ({ allowsChildren: true });
BranchSplitType.prototype.onEdgeRemoved = function (ctx) {
  if ((this.data || {}).origin !== 'auto') return; // the user placed it, never auto-remove
  if (ctx.childCount(this.id) > 0) return;          // it became a real subgraph
  const ins = ctx.activeEdgesTo(this.id).length;
  const outs = ctx.activeEdgesFrom(this.id).length;
  if (ins === 1 && outs === 1) ctx.spliceSelf();
  else if (ins === 0 || outs === 0) ctx.removeSelfAndEdges();
};

{
  const registry = new GraphKit.TypeRegistry().register(StepType, BranchSplitType);
  const g = newGraph(registry);
  const a = GraphKit.ops.addNode(g, { meta: { type: 'demo.step', label: 'Choose' } });
  const b = GraphKit.ops.addNode(g, { meta: { type: 'demo.step', label: 'Path A' } });
  const c = GraphKit.ops.addNode(g, { meta: { type: 'demo.step', label: 'Path B' } });

  GraphKit.ops.connect(g, a, b);
  check('first connection is direct — no split yet', g.allEdges().length === 1 && g.activeEdgesFrom(a)[0].to === b);

  GraphKit.ops.connect(g, a, c);
  const split = g.allNodes().find((n) => g.typeOf(n.id) === 'demo.branchSplit');
  check('a split appeared, entirely from the step\'s own hook', !!split);
  check('the step now points only at the split', g.activeEdgesFrom(a).length === 1 && g.activeEdgesFrom(a)[0].to === split.id);
  check('the split fans out to both original targets', g.activeEdgesFrom(split.id).length === 2);
  check('document is valid throughout', g.validate().filter((i) => i.level === 'error').length === 0);

  const toC = g.activeEdgesTo(c)[0];
  GraphKit.ops.disconnectEdge(g, toC.id);
  check('removing a branch collapses the split (its own onEdgeRemoved)', !g.node(split.id));
  check('a connects straight to b again', g.activeEdgesFrom(a).length === 1 && g.activeEdgesFrom(a)[0].to === b);
  check('no orphan edges left behind', g.allEdges().length === 1);
}

/* ------------------------------------------------------------------ *
 * lockChildren / lockLinked support — pure graph/metadata queries that any
 * renderer needs, not just the demo's SVG one. No pixel arithmetic here;
 * that part (measure/layout) is deliberately left to the consumer.
 * ------------------------------------------------------------------ */
section('isChildrenLocked / isLinkLocked / ancestorsOf');
{
  const g = newGraph();
  const a = GraphKit.ops.addNode(g, {});
  check('children locked by default (no meta at all)', g.isChildrenLocked(a) === true);
  check('link locked is off by default', g.isLinkLocked(a) === false);

  GraphKit.ops.setNodeMeta(g, a, { lockChildren: false });
  check('lockChildren:false is honoured', g.isChildrenLocked(a) === false);
  GraphKit.ops.setNodeMeta(g, a, { lockLinked: true });
  check('lockLinked:true is honoured', g.isLinkLocked(a) === true);

  const b = GraphKit.ops.addNode(g, { parent: a });
  const c = GraphKit.ops.addNode(g, { parent: b });
  check('ancestorsOf walks the full parent chain', [...g.ancestorsOf(c)].sort().join() === [a, b].sort().join());
  check('a top-level node has no ancestors', g.ancestorsOf(a).size === 0);
}

section('visibleAncestorOf');
{
  const g = newGraph();
  const top = GraphKit.ops.addNode(g, {});
  check('a fully visible node is its own visible ancestor', g.visibleAncestorOf(top) === top);

  const grp = GraphKit.ops.addNode(g, {});
  const child = GraphKit.ops.addNode(g, { parent: grp });
  const grandchild = GraphKit.ops.addNode(g, { parent: child });
  check('nothing collapsed — still visible', g.visibleAncestorOf(grandchild) === grandchild);

  GraphKit.ops.collapse(g, grp, true);
  check('hidden two levels down resolves to the collapsed ancestor', g.visibleAncestorOf(grandchild) === grp);
  check('the immediate child is hidden too', g.visibleAncestorOf(child) === grp);
  check('the collapsed node itself is always its own visible ancestor', g.visibleAncestorOf(grp) === grp);

  GraphKit.ops.collapse(g, grp, false);
  check('expanding restores direct visibility', g.visibleAncestorOf(grandchild) === grandchild);
}

section('linkLockedCompanions: transitive, direction-aware, ancestor-excluded');
{
  const g = newGraph();
  const a = GraphKit.ops.addNode(g, {});
  const b = GraphKit.ops.addNode(g, {});
  const c = GraphKit.ops.addNode(g, {});
  const upstream = GraphKit.ops.addNode(g, {});
  GraphKit.ops.connect(g, a, b);
  GraphKit.ops.connect(g, b, c);           // transitive: a -> b -> c
  GraphKit.ops.connect(g, upstream, a);    // reverse direction — must not appear
  const companions = g.linkLockedCompanions(a);
  check('walks transitively through an unflagged intermediate', companions.includes(b) && companions.includes(c));
  check('direction matters — upstream is excluded', !companions.includes(upstream));

  const p = GraphKit.ops.addNode(g, {});
  const child = GraphKit.ops.addNode(g, { parent: p });
  GraphKit.ops.connect(g, child, p); // links back to its own container
  const d = GraphKit.ops.addNode(g, {});
  GraphKit.ops.connect(g, child, d);
  const childCompanions = g.linkLockedCompanions(child);
  check('a node\'s own containment ancestor is excluded even if linked', !childCompanions.includes(p));
  check('an unrelated downstream link still comes through', childCompanions.includes(d));

  const autoGroup = GraphKit.ops.addNode(g, { meta: { lockChildren: false } });
  const autoChild = GraphKit.ops.addNode(g, { parent: autoGroup });
  const outside = GraphKit.ops.addNode(g, {});
  GraphKit.ops.connect(g, outside, autoChild);
  const companionsOfOutside = g.linkLockedCompanions(outside);
  check('a node nested in a non-locked container is excluded from companions',
    !companionsOfOutside.includes(autoChild));

  // A downstream node's own containment ancestor is excluded too, not just
  // the dragged node's — the chain can reach a second node's parent even
  // when that parent has nothing to do with the node the drag started from.
  const container2 = GraphKit.ops.addNode(g, {});
  const inside2 = GraphKit.ops.addNode(g, { parent: container2 });
  const start = GraphKit.ops.addNode(g, {});
  GraphKit.ops.connect(g, start, inside2);
  GraphKit.ops.connect(g, inside2, container2); // inside2 links back to its own parent
  const companionsOfStart = g.linkLockedCompanions(start);
  check('inside2 (directly downstream) is included', companionsOfStart.includes(inside2));
  check('inside2\'s own containment parent is excluded even though it is not start\'s ancestor',
    !companionsOfStart.includes(container2));

  // A downstream node with an "external input" — an upstream neighbour that
  // is neither id nor part of id's own downstream set — is excluded, even
  // though it's otherwise reachable via a legitimate forward chain. It's fed
  // by something outside the drag, so it isn't purely id's to carry.
  // Start -> a1 -> branch -> pathA -> a2 -> a1 (a2 loops back to a1):
  // dragging branch reaches a1 via branch->pathA->a2->a1, but a1 is also
  // fed directly by Start, which branch's downstream set never reaches.
  const extStart = GraphKit.ops.addNode(g, {});
  const a1 = GraphKit.ops.addNode(g, {});
  const branch = GraphKit.ops.addNode(g, {});
  const pathA = GraphKit.ops.addNode(g, {});
  const a2 = GraphKit.ops.addNode(g, {});
  const pathB = GraphKit.ops.addNode(g, {});
  GraphKit.ops.connect(g, extStart, a1);
  GraphKit.ops.connect(g, a1, branch);
  GraphKit.ops.connect(g, branch, pathA);
  GraphKit.ops.connect(g, pathA, a2);
  GraphKit.ops.connect(g, branch, pathB);
  GraphKit.ops.connect(g, a2, a1);
  const branchCompanions = g.linkLockedCompanions(branch);
  check('pathA, pathB, a2 are companions of branch', ['pathA', 'pathB', 'a2'].every((_, i) =>
    branchCompanions.includes([pathA, pathB, a2][i])));
  check('a1 is excluded — Start feeds it from outside branch\'s downstream set',
    !branchCompanions.includes(a1));

  // Contrast: a cycle that closes back through id's own downstream chain,
  // without any external feed, is NOT excluded — n4's only upstream
  // neighbour (n3) is itself downstream of n2, so n4 has no external input.
  const n1 = GraphKit.ops.addNode(g, {});
  const n2 = GraphKit.ops.addNode(g, {});
  const n3 = GraphKit.ops.addNode(g, {});
  const n4 = GraphKit.ops.addNode(g, {});
  GraphKit.ops.connect(g, n1, n2);
  GraphKit.ops.connect(g, n2, n3);
  GraphKit.ops.connect(g, n3, n4);
  GraphKit.ops.connect(g, n4, n2); // closes back on n2 itself, no outside feed
  const companionsOfN2 = g.linkLockedCompanions(n2);
  check('n4 stays in — its cycle closes back on n2 itself, no external input',
    companionsOfN2.includes(n4));
}

/* ------------------------------------------------------------------ */
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' checks)');
process.exit(fail === 0 ? 0 : 1);
