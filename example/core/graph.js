/* core/graph.js — the Graph aggregate root.
 *
 * A thin facade: reads delegate to TopologyService, writes go through the
 * MutationService's staged commit, checks come from the ValidationService.
 * Holds the document, the registry, and the change listeners — nothing else.
 *
 * The imports of MutationContext and validateDoc are circular with this
 * module; both are used only at call time, which ES module live bindings
 * resolve safely.
 */
import { createDocument } from './model/document.js';
import { TypeRegistry } from './services/registry.js';
import { TopologyService as T } from './services/topology.js';
import { MutationContext } from './services/mutation.js';
import { validateDoc } from './services/validation.js';
import { clone } from './util.js';

export function Graph(doc, registry) {
  this.doc = doc || createDocument();
  this.registry = registry || new TypeRegistry();
  this._listeners = [];
  this._inBatch = false;
}

Graph.prototype.onChange = function (fn) { this._listeners.push(fn); return this; };
Graph.prototype._emit = function () {
  this._listeners.forEach((f) => f(this));
};

/* --- reads: delegated to TopologyService --- */

Graph.prototype.node = function (id) { return T.node(this.doc, id); };
Graph.prototype.edge = function (id) { return T.edge(this.doc, id); };
Graph.prototype.allNodes = function () { return T.allNodes(this.doc); };
Graph.prototype.allEdges = function () { return T.allEdges(this.doc); };
Graph.prototype.parentOf = function (id) { return T.parentOf(this.doc, id); };
Graph.prototype.childrenOf = function (parentId) { return T.childrenOf(this.doc, parentId); };
Graph.prototype.childCount = function (id) { return T.childCount(this.doc, id); };
Graph.prototype.childNodeCount = function (id) { return T.childNodeCount(this.doc, id); };
Graph.prototype.portsOf = function (id) { return T.portsOf(this.doc, this.registry, id); };
Graph.prototype.port = function (id, portId) { return T.port(this.doc, this.registry, id, portId); };
Graph.prototype.activeEdges = function () { return T.activeEdges(this.doc); };
Graph.prototype.activeEdgesFrom = function (id) { return T.activeEdgesFrom(this.doc, id); };
Graph.prototype.activeEdgesTo = function (id) { return T.activeEdgesTo(this.doc, id); };
Graph.prototype.activeEdgesFromPort = function (id, port) { return T.activeEdgesFromPort(this.doc, id, port); };
Graph.prototype.edgesOf = function (id) { return T.edgesOf(this.doc, id); };
Graph.prototype.degreeOf = function (id) { return T.degreeOf(this.doc, id); };
Graph.prototype.hasDetachedEdges = function (id) { return T.hasDetachedEdges(this.doc, id); };
Graph.prototype.portUsage = function (id, port, direction) { return T.portUsage(this.doc, id, port, direction); };
Graph.prototype.viewOf = function (id) { return T.viewOf(this.doc, id); };
Graph.prototype.isCollapsed = function (id) { return T.isCollapsed(this.doc, id); };
Graph.prototype.visibleNodes = function (rootId) { return T.visibleNodes(this.doc, rootId); };
Graph.prototype.depthOf = function (id) { return T.depthOf(this.doc, id); };

/* --- mutation --- */

/**
 * All writes go through here. Mutations apply to a copy; hooks run; invariants
 * are checked; only then is the result swapped in. A throwing hook leaves the
 * document untouched rather than half-written.
 */
Graph.prototype.mutate = function (fn) {
  if (this._inBatch) throw new Error('nested mutate() — hooks must not re-enter');
  const before = this.doc;
  const staged = clone(before);
  const ctx = new MutationContext(this, staged);

  this._inBatch = true;
  try {
    const result = fn(ctx);
    ctx._runHooks();
    ctx._applyDeferred();
    staged.meta.revision = (staged.meta.revision || 0) + 1;
    staged.meta.updatedAt = new Date().toISOString();
    const errs = validateDoc(staged, this.registry).filter((i) => i.level === 'error');
    if (errs.length) throw new Error('invariant violation: ' + errs.map((e) => e.message).join('; '));
    this.doc = staged;
    return result;
  } finally {
    this._inBatch = false;
  }
  // note: _emit is called by callers after a successful mutate
};

/** Convenience: mutate then notify listeners. */
Graph.prototype.apply = function (fn) {
  const r = this.mutate(fn);
  this._emit();
  return r;
};

Graph.prototype.validate = function () { return validateDoc(this.doc, this.registry); };
Graph.prototype.toJSON = function () { return clone(this.doc); };
