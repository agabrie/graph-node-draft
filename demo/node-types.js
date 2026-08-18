/* demo/node-types.js — PROJECT CODE, not library code.
 *
 * Every type here subclasses BaseNodeType from lib/. Delete this file and
 * the library still runs; you just have no types to place. This is the
 * point of docs/domain-shape.md §3: the library has zero domain behaviour,
 * everything below is a consumer's own extension.
 *
 * Two types are the ones worth reading closely:
 *
 *   StepNode — the moment it gets a second outgoing edge, its own
 *   onEdgeAdded hook moves both edges onto a fresh BranchSplitNode. The
 *   library never inspected an edge count; there is no capacity, no port,
 *   no overflow trigger anywhere in lib/. BranchSplitNode's onEdgeRemoved
 *   is the inverse: it collapses itself when it stops branching.
 *
 *   SceneNode — its onCreate hook auto-attaches a LabelBlockNode child.
 *   Both are ordinary hooks; nothing here is special-cased by the library.
 */
import { BaseNodeType } from '../lib/index.js';

function extend(Child, Parent) {
  Child.prototype = Object.create(Parent.prototype);
  Child.prototype.constructor = Child;
  return Child;
}

/* ---------------- plain types — declaration only ---------------- */

function StartNode() {}
extend(StartNode, BaseNodeType);
StartNode.type = 'demo.start';
StartNode.label = 'Start';
StartNode.describe = () => ({ allowsChildren: false });

function EndNode() {}
extend(EndNode, BaseNodeType);
EndNode.type = 'demo.end';
EndNode.label = 'End';
EndNode.describe = () => ({ allowsChildren: false });

function GroupNode() {}
extend(GroupNode, BaseNodeType);
GroupNode.type = 'demo.group';
GroupNode.label = 'Group';
GroupNode.describe = () => ({ allowsChildren: true });

function LabelBlockNode() {}
extend(LabelBlockNode, BaseNodeType);
LabelBlockNode.type = 'demo.labelBlock';
LabelBlockNode.label = 'Label block';
LabelBlockNode.describe = () => ({ allowsChildren: false });

/* ---------------- scene: onCreate attaches a child ---------------- */

function SceneNode() {}
extend(SceneNode, BaseNodeType);
SceneNode.type = 'demo.scene';
SceneNode.label = 'Scene (auto label)';
SceneNode.describe = () => ({ allowsChildren: true });
/** Runs once, when the node is created, inside the same atomic batch. */
SceneNode.prototype.onCreate = function (ctx) {
  ctx.createNode({
    parent: this.id,
    meta: { type: 'demo.labelBlock', label: 'Untitled label' }
  });
};

/* ---------------- step: manages its own fan-out ---------------- */

function StepNode() {}
extend(StepNode, BaseNodeType);
StepNode.type = 'demo.step';
StepNode.label = 'Step (auto-splits)';
StepNode.describe = () => ({ allowsChildren: true });
/** The moment this step gets a second outgoing edge, move both onto a
 *  fresh split node. Consumer policy — the library never counts edges. */
StepNode.prototype.onEdgeAdded = function (ctx, edge) {
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

/* ---------------- branch split: collapses itself ---------------- */

function BranchSplitNode() {}
extend(BranchSplitNode, BaseNodeType);
BranchSplitNode.type = 'demo.branchSplit';
BranchSplitNode.label = 'Branch split';
BranchSplitNode.describe = () => ({ allowsChildren: true });
/** A split that no longer branches is machinery with nothing to do. */
BranchSplitNode.prototype.onEdgeRemoved = function (ctx) {
  if ((this.data || {}).origin !== 'auto') return; // the user placed it, never auto-remove
  if (ctx.childCount(this.id) > 0) return;          // it became a real subgraph
  const ins = ctx.activeEdgesTo(this.id).length;
  const outs = ctx.activeEdgesFrom(this.id).length;
  if (ins === 1 && outs === 1) ctx.spliceSelf();
  else if (ins === 0 || outs === 0) ctx.removeSelfAndEdges();
};
BranchSplitNode.prototype.validate = function (ctx) {
  if ((this.data || {}).origin === 'auto') return [];
  const ins = ctx.activeEdgesTo(this.id).length;
  const outs = ctx.activeEdgesFrom(this.id).length;
  if (ins > 1 || outs > 1 || ctx.childCount(this.id) > 0) return [];
  return [{
    level: 'warn', nodeId: this.id,
    message: 'Split has ' + ins + ' in / ' + outs + ' out and no children — not branching'
  }];
};

export const DemoTypes = {
  StartNode, EndNode, GroupNode, LabelBlockNode, SceneNode, StepNode, BranchSplitNode,
  all: [StartNode, EndNode, GroupNode, LabelBlockNode, SceneNode, StepNode, BranchSplitNode],
  /** Types offered in the palette, in order. */
  palette: [StartNode, StepNode, EndNode, GroupNode, SceneNode, LabelBlockNode, BranchSplitNode]
};
