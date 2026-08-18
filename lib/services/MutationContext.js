/* lib/services/MutationContext.js — MutationService.
 *
 * The MutationContext is what a mutation function and every type hook
 * receive. It writes directly to the live document handed to it by
 * Graph.mutate(), queues hook events, and defers self-directed operations
 * (splice/remove) until all hooks have run. There is no staging or
 * rollback — see Graph.js's mutate() docstring.
 *
 * The Graph import is circular (Graph.js imports this module); it is used
 * only at call time, which ES module live bindings resolve safely.
 */
import { Graph } from '../Graph.js';
import { newId } from '../model/ids.js';
import { NodeFactory } from '../model/Node.js';
import { EdgeFactory } from '../model/Edge.js';
import { MetadataFactory } from '../model/Metadata.js';
import { nextRank } from './RankingService.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export class MutationContext {
  constructor(graph, staged) {
    this.g = graph;
    this.doc = staged;
    this.registry = graph.registry;
    this._events = [];     // hook queue
    this._deferred = [];   // splice/remove requests raised inside hooks
    this._self = null;     // node id whose hook is currently running
    this.warnings = [];
  }

  /* reads on the staged copy */
  _view() {
    return new Graph(this.doc, this.registry);
  }
  node(id) { return this.doc.nodes[id] || null; }
  edge(id) { return this.doc.edges[id] || null; }
  parentOf(id) { const n = this.node(id); return n ? (n.parent || null) : null; }
  childCount(id) { return this._view().childCount(id); }
  activeEdgesFrom(id) { return this._view().activeEdgesFrom(id); }
  activeEdgesTo(id) { return this._view().activeEdgesTo(id); }
  hasDetachedEdges(id) { return this._view().hasDetachedEdges(id); }
  metaOf(kind, id) { return this._view().metaOf(kind, id); }
  warn(m) { this.warnings.push(m); }

  /* writes: metadata */

  /** Create a standalone metadata record. Owners point at it via `meta`. */
  createMetadata(fields) {
    const id = newId();
    this.doc.metadata[id] = MetadataFactory.create(fields, { id });
    return id;
  }

  /**
   * Merge fields into the metadata record a node or edge points at, creating
   * one on first write. `kind` is 'node' or 'edge'.
   *
   * Only refreshes rec._meta (the record this call was made through) — not
   * every other owner that might point at the same metaId via linkMeta.
   * Sharing is supported but not an active use case right now, so this
   * doesn't pay for keeping every sharer's cache in sync; see model/Node.js.
   */
  setMeta(kind, id, patch) {
    const rec = kind === 'edge' ? this.doc.edges[id] : this.doc.nodes[id];
    if (!rec) throw new Error('no such ' + kind + ' ' + id);
    if (!rec.meta) {
      rec.meta = this.createMetadata(patch);
    } else {
      const existing = this.doc.metadata[rec.meta];
      this.doc.metadata[rec.meta] = Object.assign({}, existing, patch, { id: rec.meta });
    }
    rec._meta = this.doc.metadata[rec.meta];
  }

  /** Point a node's or edge's `meta` at an existing record — sharing. */
  linkMeta(kind, id, metaId) {
    const rec = kind === 'edge' ? this.doc.edges[id] : this.doc.nodes[id];
    if (!rec) throw new Error('no such ' + kind + ' ' + id);
    if (!this.doc.metadata[metaId]) throw new Error('no such metadata record ' + metaId);
    rec.meta = metaId;
    rec._meta = this.doc.metadata[metaId];
  }

  /* writes: nodes and edges */

  createNode(spec) {
    const id = newId();
    const siblings = this._view().childrenOf(spec.parent || null).map((n) => n.rank);
    const metaId = this._resolveMeta(spec);
    const node = NodeFactory.create(spec, { id, rank: nextRank(siblings), metaId });
    node._meta = metaId ? this.doc.metadata[metaId] : null;
    this.doc.nodes[id] = node;
    this._events.push({ kind: 'created', node: id });
    return id;
  }

  updateNode(id, patch) {
    const n = this.doc.nodes[id];
    if (!n) throw new Error('no such node ' + id);
    Object.keys(patch).forEach((k) => {
      if (k === 'data') n.data = Object.assign({}, n.data, patch.data);
      else n[k] = patch[k];
    });
  }

  createEdge(spec) {
    const id = newId();
    const ranks = Object.keys(this.doc.edges)
      .map((k) => this.doc.edges[k])
      .filter((e) => (e.parent || null) === (spec.parent ?? null))
      .map((e) => e.rank);
    const metaId = this._resolveMeta(spec);
    const edge = EdgeFactory.create(spec, { id, rank: nextRank(ranks), metaId });
    edge._meta = metaId ? this.doc.metadata[metaId] : null;
    this.doc.edges[id] = edge;
    this._events.push({ kind: 'edgeAdded', edge: id });
    return id;
  }

  /** Resolve spec.meta (inline fields, creates a record) or spec.metaRef
   *  (an existing record id, shares it) into a metaId for the factory. */
  _resolveMeta(spec) {
    if (spec.metaRef) {
      if (!this.doc.metadata[spec.metaRef]) throw new Error('no such metadata record ' + spec.metaRef);
      return spec.metaRef;
    }
    if (spec.meta) return this.createMetadata(spec.meta);
    return null;
  }

  /** Move one end of an existing edge. which: 'from' | 'to'. */
  retargetEdge(id, nodeId, which) {
    const e = this.doc.edges[id];
    if (!e) throw new Error('no such edge ' + id);
    if (which === 'from') e.from = nodeId;
    else e.to = nodeId;
  }

  removeEdge(id) {
    const e = this.doc.edges[id];
    if (!e) return;
    delete this.doc.edges[id];
    this._events.push({ kind: 'edgeRemoved', edge: clone(e) });
  }

  setEdgeState(id, state) {
    const e = this.doc.edges[id]; if (e) e.state = state;
  }

  removeNode(id) {
    delete this.doc.nodes[id];
  }

  /* self-directed operations, only meaningful inside a node hook */

  spliceSelf() {
    if (!this._self) throw new Error('spliceSelf() outside a node hook');
    this._deferred.push({ op: 'splice', node: this._self });
  }
  removeSelfAndEdges() {
    if (!this._self) throw new Error('removeSelfAndEdges() outside a node hook');
    this._deferred.push({ op: 'remove', node: this._self });
  }

  /* --- hook dispatch --- */

  /** Build the hook-callable instance for a node, resolving its type through
   *  its metadata record. Untyped nodes (no meta, or no meta.type) have no
   *  instance and therefore no behaviour — this is what makes "the parser can
   *  build structure before semantics" true. */
  _instance(id) {
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
  }

  _call(id, hook, arg) {
    const inst = this._instance(id);
    if (!inst || typeof inst[hook] !== 'function') return;
    const prev = this._self;
    this._self = id;
    try { inst[hook](this, arg); } finally { this._self = prev; }
  }

  _runHooks() {
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
  }

  _applyDeferred() {
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
  }
}
