/* lib/services/mutation.js — MutationService.
 *
 * The MutationContext is what a mutation function and every type hook
 * receive. It stages writes against a copied document, queues hook events,
 * and defers self-directed operations (splice/remove) until all hooks have
 * run. Nothing is visible outside the batch until Graph.mutate() commits it.
 *
 * The Graph import is circular (graph.js imports this module); it is used
 * only at call time, which ES module live bindings resolve safely.
 */
import { Graph } from '../graph.js';
import { newId } from '../model/ids.js';
import { NodeFactory } from '../model/node.js';
import { EdgeFactory } from '../model/edge.js';
import { MetadataFactory } from '../model/metadata.js';
import { nextRank } from './ranking.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function MutationContext(graph, staged) {
  this.g = graph;
  this.doc = staged;
  this.registry = graph.registry;
  this._events = [];     // hook queue
  this._deferred = [];   // splice/remove requests raised inside hooks
  this._self = null;     // node id whose hook is currently running
  this.warnings = [];
}

/* reads on the staged copy */
MutationContext.prototype._view = function () {
  return new Graph(this.doc, this.registry);
};
MutationContext.prototype.node = function (id) { return this.doc.nodes[id] || null; };
MutationContext.prototype.edge = function (id) { return this.doc.edges[id] || null; };
MutationContext.prototype.parentOf = function (id) { const n = this.node(id); return n ? (n.parent || null) : null; };
MutationContext.prototype.childCount = function (id) { return this._view().childCount(id); };
MutationContext.prototype.activeEdgesFrom = function (id) { return this._view().activeEdgesFrom(id); };
MutationContext.prototype.activeEdgesTo = function (id) { return this._view().activeEdgesTo(id); };
MutationContext.prototype.hasDetachedEdges = function (id) { return this._view().hasDetachedEdges(id); };
MutationContext.prototype.metaOf = function (kind, id) { return this._view().metaOf(kind, id); };
MutationContext.prototype.warn = function (m) { this.warnings.push(m); };

/* writes: metadata */

/** Create a standalone metadata record. Owners point at it via `meta`. */
MutationContext.prototype.createMetadata = function (fields) {
  const id = newId();
  this.doc.metadata[id] = MetadataFactory.create(fields, { id });
  return id;
};

/**
 * Merge fields into the metadata record a node or edge points at, creating
 * one on first write. `kind` is 'node' or 'edge'.
 */
MutationContext.prototype.setMeta = function (kind, id, patch) {
  const rec = kind === 'edge' ? this.doc.edges[id] : this.doc.nodes[id];
  if (!rec) throw new Error('no such ' + kind + ' ' + id);
  if (!rec.meta) {
    rec.meta = this.createMetadata(patch);
  } else {
    const existing = this.doc.metadata[rec.meta];
    this.doc.metadata[rec.meta] = Object.assign({}, existing, patch, { id: rec.meta });
  }
};

/** Point a node's or edge's `meta` at an existing record — sharing. */
MutationContext.prototype.linkMeta = function (kind, id, metaId) {
  const rec = kind === 'edge' ? this.doc.edges[id] : this.doc.nodes[id];
  if (!rec) throw new Error('no such ' + kind + ' ' + id);
  if (!this.doc.metadata[metaId]) throw new Error('no such metadata record ' + metaId);
  rec.meta = metaId;
};

/* writes: nodes and edges */

MutationContext.prototype.createNode = function (spec) {
  const id = newId();
  const siblings = this._view().childrenOf(spec.parent || null).map((n) => n.rank);
  const metaId = this._resolveMeta(spec);
  this.doc.nodes[id] = NodeFactory.create(spec, { id, rank: nextRank(siblings), metaId });
  this._events.push({ kind: 'created', node: id });
  return id;
};

MutationContext.prototype.updateNode = function (id, patch) {
  const n = this.doc.nodes[id];
  if (!n) throw new Error('no such node ' + id);
  Object.keys(patch).forEach((k) => {
    if (k === 'data') n.data = Object.assign({}, n.data, patch.data);
    else n[k] = patch[k];
  });
};

MutationContext.prototype.createEdge = function (spec) {
  const id = newId();
  const ranks = Object.keys(this.doc.edges)
    .map((k) => this.doc.edges[k])
    .filter((e) => (e.parent || null) === (spec.parent ?? null))
    .map((e) => e.rank);
  const metaId = this._resolveMeta(spec);
  this.doc.edges[id] = EdgeFactory.create(spec, { id, rank: nextRank(ranks), metaId });
  this._events.push({ kind: 'edgeAdded', edge: id });
  return id;
};

/** Resolve spec.meta (inline fields, creates a record) or spec.metaRef
 *  (an existing record id, shares it) into a metaId for the factory. */
MutationContext.prototype._resolveMeta = function (spec) {
  if (spec.metaRef) {
    if (!this.doc.metadata[spec.metaRef]) throw new Error('no such metadata record ' + spec.metaRef);
    return spec.metaRef;
  }
  if (spec.meta) return this.createMetadata(spec.meta);
  return null;
};

/** Move one end of an existing edge. which: 'from' | 'to'. */
MutationContext.prototype.retargetEdge = function (id, nodeId, which) {
  const e = this.doc.edges[id];
  if (!e) throw new Error('no such edge ' + id);
  if (which === 'from') e.from = nodeId;
  else e.to = nodeId;
};

MutationContext.prototype.removeEdge = function (id) {
  const e = this.doc.edges[id];
  if (!e) return;
  delete this.doc.edges[id];
  this._events.push({ kind: 'edgeRemoved', edge: clone(e) });
};

MutationContext.prototype.setEdgeState = function (id, state) {
  const e = this.doc.edges[id]; if (e) e.state = state;
};

MutationContext.prototype.removeNode = function (id) {
  delete this.doc.nodes[id];
};

/* self-directed operations, only meaningful inside a node hook */

MutationContext.prototype.spliceSelf = function () {
  if (!this._self) throw new Error('spliceSelf() outside a node hook');
  this._deferred.push({ op: 'splice', node: this._self });
};
MutationContext.prototype.removeSelfAndEdges = function () {
  if (!this._self) throw new Error('removeSelfAndEdges() outside a node hook');
  this._deferred.push({ op: 'remove', node: this._self });
};

/* --- hook dispatch --- */

/** Build the hook-callable instance for a node, resolving its type through
 *  its metadata record. Untyped nodes (no meta, or no meta.type) have no
 *  instance and therefore no behaviour — this is what makes "the parser can
 *  build structure before semantics" true. */
MutationContext.prototype._instance = function (id) {
  const n = this.doc.nodes[id];
  if (!n) return null;
  const meta = n.meta ? this.doc.metadata[n.meta] : null;
  const type = meta && meta.type;
  if (!type) return null;
  const T = this.registry.get(type);
  if (!T) return null;                 // unregistered type: tolerated, just no behaviour
  const inst = Object.create(T.prototype);
  inst.id = n.id; inst.data = n.data || {}; inst.ext = n.ext; inst.type = type; inst.meta = meta;
  return inst;
};

MutationContext.prototype._call = function (id, hook, arg) {
  const inst = this._instance(id);
  if (!inst || typeof inst[hook] !== 'function') return;
  const prev = this._self;
  this._self = id;
  try { inst[hook](this, arg); } finally { this._self = prev; }
};

MutationContext.prototype._runHooks = function () {
  const queue = this._events.slice();
  this._events.length = 0;
  for (const ev of queue) {
    if (ev.kind === 'created') {
      this._call(ev.node, 'onCreate');
    } else if (ev.kind === 'edgeAdded') {
      const e = this.doc.edges[ev.edge];
      if (e) { this._call(e.from, 'onEdgeAdded', e); this._call(e.to, 'onEdgeAdded', e); }
    } else if (ev.kind === 'edgeRemoved') {
      this._call(ev.edge.from, 'onEdgeRemoved', ev.edge);
      this._call(ev.edge.to, 'onEdgeRemoved', ev.edge);
    }
  }
  // Hooks may have queued more events (e.g. a split inserting edges). Fire one
  // more round, then stop — deliberately shallow, so behaviour cannot recurse.
  const second = this._events.slice();
  this._events.length = 0;
  for (const ev2 of second) {
    if (ev2.kind === 'created') this._call(ev2.node, 'onCreate');
  }
};

MutationContext.prototype._applyDeferred = function () {
  this._deferred.forEach((d) => {
    const g = this._view();
    if (d.op === 'splice') {
      const ins = g.activeEdgesTo(d.node), outs = g.activeEdgesFrom(d.node);
      if (ins.length === 1 && outs.length === 1) {
        this.retargetEdge(ins[0].id, outs[0].to, 'to');
        delete this.doc.edges[outs[0].id];
      }
      g.edgesOf(d.node).forEach((e) => { delete this.doc.edges[e.id]; });
      this.removeNode(d.node);
    } else if (d.op === 'remove') {
      g.edgesOf(d.node).forEach((e) => { delete this.doc.edges[e.id]; });
      this.removeNode(d.node);
    }
  });
  this._deferred.length = 0;
};
