/* node-types.js — PROJECT CODE, not library code.
 *
 * Every type here is defined by subclassing GraphCore.BaseNodeType. Delete this
 * file and the library still runs; you just have no types to place.
 *
 * BranchSplitNode is the interesting one: it is the reference example of a node
 * whose behaviour the library knows nothing about. It inserts itself when a port
 * overflows, grows its own outputs, and removes itself when it stops branching.
 */
import { BaseNodeType as Base } from './core/index.js';

function extend(Child, Parent) {
  Child.prototype = Object.create(Parent.prototype);
  Child.prototype.constructor = Child;
  return Child;
}

/* ============================================================
 * Plain types — declaration only, no behaviour
 * ============================================================ */

function StepNode() {}
extend(StepNode, Base);
StepNode.type = 'demo.step';
StepNode.label = 'Step';
StepNode.describe = function () {
  return {
    allowsChildren: true,
    // capacity 1 on the output is what makes a second connection overflow…
    ports: {
      'in': { direction: 'in', capacity: null },
      out: { direction: 'out', capacity: 1 }
    },
    // …and this is who gets asked to resolve it.
    onOverflow: 'demo.branchSplit'
  };
};

function StartNode() {}
extend(StartNode, Base);
StartNode.type = 'demo.start';
StartNode.label = 'Start';
StartNode.describe = function () {
  return {
    allowsChildren: false,
    ports: { out: { direction: 'out', capacity: 1 } },
    onOverflow: 'demo.branchSplit'
  };
};

function EndNode() {}
extend(EndNode, Base);
EndNode.type = 'demo.end';
EndNode.label = 'End';
EndNode.describe = function () {
  return { allowsChildren: false, ports: { 'in': { direction: 'in', capacity: null } } };
};

function StoreNode() {}
extend(StoreNode, Base);
StoreNode.type = 'demo.store';
StoreNode.label = 'Datastore';
StoreNode.describe = function () {
  return {
    allowsChildren: false,
    ports: {
      'in': { direction: 'in', capacity: null },
      out: { direction: 'out', capacity: null }   // unlimited: never overflows
    }
  };
};

function GroupNode() {}
extend(GroupNode, Base);
GroupNode.type = 'demo.group';
GroupNode.label = 'Group';
GroupNode.describe = function () {
  return {
    allowsChildren: true,
    ports: {
      'in': { direction: 'in', capacity: null },
      out: { direction: 'out', capacity: null }
    }
  };
};

/* ============================================================
 * A type with custom creation logic: always comes with two children
 * ============================================================ */

function DilemmaNode() {}
extend(DilemmaNode, Base);
DilemmaNode.type = 'demo.dilemma';
DilemmaNode.label = 'Dilemma (auto 2 children)';
DilemmaNode.describe = function () {
  return {
    allowsChildren: true,
    ports: {
      'in': { direction: 'in', capacity: null },
      out: { direction: 'out', capacity: 1 }
    },
    onOverflow: 'demo.branchSplit'
  };
};
/** Runs once, when the node is created. Children are staged with it. */
DilemmaNode.prototype.onCreate = function (ctx) {
  var self = this.id;
  var a = ctx.createNode({ type: 'demo.step', label: 'Option A', parent: self });
  var b = ctx.createNode({ type: 'demo.step', label: 'Option B', parent: self });
  ctx.createEdge({ from: { node: a, port: 'out' }, to: { node: b, port: 'in' } });
  ctx.setView(self, { collapsed: false });
};
DilemmaNode.prototype.validate = function (ctx) {
  return ctx.childCount(this.id) >= 2 ? [] : [{
    level: 'warn', nodeId: this.id,
    message: 'A dilemma should keep at least two options'
  }];
};

/* ============================================================
 * BranchSplitNode — the reference custom node
 * ============================================================ */

function BranchSplitNode() {}
extend(BranchSplitNode, Base);
BranchSplitNode.type = 'demo.branchSplit';
BranchSplitNode.label = 'Branch split';
BranchSplitNode.describe = function () {
  return {
    allowsChildren: true,          // a split that gains children is a subgraph
    ports: {
      'in': { direction: 'in', capacity: null },
      'out.0': { direction: 'out', capacity: 1 },
      'out.1': { direction: 'out', capacity: 1 }
    }
  };
};

/**
 * Called by the library when a connection would exceed an out-port's capacity,
 * for any type whose descriptor names this one in `onOverflow`.
 * Return true if handled, false to let the library refuse the connection.
 */
BranchSplitNode.handleOverflow = function (ctx, attempt) {
  var existing = ctx.edgesFromEndpoint(attempt.source);
  if (existing.length !== 1) return false;        // not a fan-out situation

  var prior = existing[0];
  var originalTarget = { node: prior.to.node, port: prior.to.port };

  // Same container as the source, so both resulting edges stay level-local.
  var split = ctx.createNode({
    type: BranchSplitNode.type,
    label: 'Branch',
    parent: ctx.parentOf(attempt.source.node),
    data: { origin: 'auto' }
  });

  // Retarget rather than delete-and-recreate: the source port's occupancy is
  // never reduced, so its capacity cannot be violated part-way through.
  ctx.retargetEdge(prior.id, { node: split, port: 'in' });
  ctx.createEdge({ from: { node: split, port: 'out.0' }, to: originalTarget, label: prior.label || '' });
  ctx.createEdge({ from: { node: split, port: 'out.1' }, to: attempt.target });
  return true;
};

/** Keep exactly one spare output so another branch can always be dragged. */
BranchSplitNode.prototype.onEdgeAdded = function (ctx, edge) {
  if (edge.from.node !== this.id) return;
  var outs = ctx.portsOf(this.id).filter(function (p) { return p.direction === 'out'; });
  var spare = outs.filter(function (p) {
    return ctx.activeEdgesFromPort(edge.from.node, p.id).length === 0;
  });
  if (spare.length === 0) {
    ctx.addPort(this.id, 'out.' + outs.length, { direction: 'out', capacity: 1 });
  }
};

/** A split that no longer branches is machinery with nothing to do. */
BranchSplitNode.prototype.onEdgeRemoved = function (ctx, _edge) {
  if (!this._collapsible(ctx)) return;
  var ins = ctx.activeEdgesTo(this.id).length;
  var outs = ctx.activeEdgesFrom(this.id).length;
  if (ins === 1 && outs === 1) ctx.spliceSelf();
  else if (outs === 0 || ins === 0) ctx.removeSelfAndEdges();
};

BranchSplitNode.prototype._collapsible = function (ctx) {
  if (this.data.origin !== 'auto') return false;          // the user placed it
  if (ctx.childCount(this.id) > 0) return false;          // it became a subgraph
  if (this.ext && Object.keys(this.ext).length) return false; // plugin data would vanish
  if (ctx.hasDetachedEdges(this.id)) return false;        // parked wiring is in use
  if (this.data.condition) return false;                  // somebody typed intent
  return true;
};

/** Authored splits are reported, never removed automatically. */
BranchSplitNode.prototype.validate = function (ctx) {
  if (this.data.origin === 'auto') return [];
  var ins = ctx.activeEdgesTo(this.id).length;
  var outs = ctx.activeEdgesFrom(this.id).length;
  if (ins > 1 || outs > 1 || ctx.childCount(this.id) > 0) return [];
  return [{
    level: 'warn', nodeId: this.id,
    message: 'Split has ' + ins + ' in / ' + outs + ' out and no children — not branching'
  }];
};

/* ============================================================
 * Mermaid round-trip types. Present so imported files have somewhere to land.
 * ============================================================ */

function makeSimple(type, label, opts) {
  function T() {}
  extend(T, Base);
  T.type = type;
  T.label = label;
  T.describe = function () { return opts; };
  return T;
}

var DecisionNode = makeSimple('demo.decision', 'Decision', {
  allowsChildren: true,
  ports: {
    'in': { direction: 'in', capacity: null },
    'true': { direction: 'out', capacity: 1, label: 'yes' },
    'false': { direction: 'out', capacity: 1, label: 'no' }
  }
});

var LaneNode = makeSimple('demo.lane', 'Participant', {
  allowsChildren: false,
  ports: { lane: { direction: 'inout', capacity: null } }
});

var EntityNode = makeSimple('demo.entity', 'Entity', {
  allowsChildren: false,
  ports: { rel: { direction: 'inout', capacity: null } }
});

var PortalNode = makeSimple('core.portal', 'Portal', {
  allowsChildren: false,
  ports: { link: { direction: 'inout', capacity: 1 } }
});

export const DemoTypes = {
  StartNode: StartNode,
  StepNode: StepNode,
  EndNode: EndNode,
  StoreNode: StoreNode,
  GroupNode: GroupNode,
  DilemmaNode: DilemmaNode,
  BranchSplitNode: BranchSplitNode,
  DecisionNode: DecisionNode,
  LaneNode: LaneNode,
  EntityNode: EntityNode,
  PortalNode: PortalNode,
  all: [StartNode, StepNode, EndNode, StoreNode, GroupNode, DilemmaNode,
    BranchSplitNode, DecisionNode, LaneNode, EntityNode, PortalNode],
  /** Types offered in the palette, in order. */
  palette: [StartNode, StepNode, DecisionNode, StoreNode, GroupNode,
    DilemmaNode, BranchSplitNode, EndNode]
};
