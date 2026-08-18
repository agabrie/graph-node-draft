/* lib/Graph.js — the Graph aggregate root.
 *
 * A thin facade: reads delegate to TopologyService, writes go straight to
 * the live document via MutationContext, checks come from the validation
 * service. Holds the document, the registry, and the change listeners —
 * nothing else.
 *
 * The imports of MutationContext and validateDoc are circular with this
 * module; both are used only at call time, which ES module live bindings
 * resolve safely.
 */
import { createDocument } from './model/Document.js';
import { TypeRegistry } from './services/TypeRegistry.js';
import { TopologyService as T } from './services/TopologyService.js';
import { MutationContext } from './services/MutationContext.js';
import { validateDoc } from './services/ValidationService.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Strip Node/Edge's internal `_meta` cache (model/Node.js) from an exported
 *  document — it's a resolved-metadata cache for in-memory reads, not part
 *  of the document's own persisted shape; doc.metadata is the source of
 *  truth and is exported as-is. */
function stripMetaCache(doc) {
  Object.keys(doc.nodes).forEach((k) => { delete doc.nodes[k]._meta; });
  Object.keys(doc.edges).forEach((k) => { delete doc.edges[k]._meta; });
  return doc;
}

/**
 * mutate() writes directly to the live document — there is no staged copy
 * and no rollback. A hook or validation failure partway through a batch
 * leaves whatever ran before the throw in place; recovering from that is a
 * consumer concern (e.g. reloading a last-known-good snapshot), not
 * something this library stages against. See docs/domain-shape.md §5.
 */
export class Graph {
  constructor(doc, registry) {
    this.doc = doc || createDocument();
    this.registry = registry || new TypeRegistry();
    this._listeners = [];
    this._inBatch = false;
  }

  onChange(fn) { this._listeners.push(fn); return this; }
  _emit() {
    this._listeners.forEach((f) => f(this));
  }

  /* --- reads: delegated to TopologyService ---
   *
   * doc.nodes/doc.edges are already real Node/Edge instances (model/Node.js)
   * — nothing here wraps or unwraps anything, it's a pure delegation. */

  node(id) { return T.node(this.doc, id); }
  edge(id) { return T.edge(this.doc, id); }
  allNodes() { return T.allNodes(this.doc); }
  allEdges() { return T.allEdges(this.doc); }
  parentOf(id) { return T.parentOf(this.doc, id); }
  childrenOf(parentId) { return T.childrenOf(this.doc, parentId); }
  childCount(id) { return T.childCount(this.doc, id); }
  childNodeCount(id) { return T.childNodeCount(this.doc, id); }
  activeEdges() { return T.activeEdges(this.doc); }
  activeEdgesFrom(id) { return T.activeEdgesFrom(this.doc, id); }
  activeEdgesTo(id) { return T.activeEdgesTo(this.doc, id); }
  edgesOf(id) { return T.edgesOf(this.doc, id); }
  degreeOf(id) { return T.degreeOf(this.doc, id); }
  hasDetachedEdges(id) { return T.hasDetachedEdges(this.doc, id); }
  metaOf(kind, id) { return T.metaOf(this.doc, kind, id); }
  typeOf(id) { return T.typeOf(this.doc, id); }
  isCollapsed(id) { return T.isCollapsed(this.doc, id); }
  visibleNodes(rootId) { return T.visibleNodes(this.doc, rootId); }
  visibleAncestorOf(id) { return T.visibleAncestorOf(this.doc, id); }
  depthOf(id) { return T.depthOf(this.doc, id); }
  isChildrenLocked(id) { return T.isChildrenLocked(this.doc, id); }
  isLinkLocked(id) { return T.isLinkLocked(this.doc, id); }
  ancestorsOf(id) { return T.ancestorsOf(this.doc, id); }
  downstreamOf(id) { return T.downstreamOf(this.doc, id); }
  isDownstreamOf(id, other) { return T.isDownstreamOf(this.doc, id, other); }
  upstreamOf(id) { return T.upstreamOf(this.doc, id); }
  isUpstreamOf(id, other) { return T.isUpstreamOf(this.doc, id, other); }
  linkLockedCompanions(id) { return T.linkLockedCompanions(this.doc, id); }

  /* --- mutation --- */

  /**
   * All writes go through here, directly against the live document — see the
   * class docstring. fn runs, then hooks, then validation; a throw at any
   * point stops the batch but does not undo what already ran.
   */
  mutate(fn) {
    if (this._inBatch) throw new Error('nested mutate() — hooks must not re-enter');
    const doc = this.doc;
    const ctx = new MutationContext(this, doc);

    this._inBatch = true;
    try {
      const result = fn(ctx);
      ctx._runHooks();
      ctx._applyDeferred();
      doc.meta.revision = (doc.meta.revision || 0) + 1;
      doc.meta.updatedAt = new Date().toISOString();
      const errs = validateDoc(doc, this.registry).filter((i) => i.level === 'error');
      if (errs.length) throw new Error('invariant violation: ' + errs.map((e) => e.message).join('; '));
      return result;
    } finally {
      this._inBatch = false;
    }
    // note: _emit is called by callers after a successful mutate
  }

  /** Convenience: mutate then notify listeners. */
  apply(fn) {
    const r = this.mutate(fn);
    this._emit();
    return r;
  }

  validate() { return validateDoc(this.doc, this.registry); }
  toJSON() { return stripMetaCache(clone(this.doc)); }
}
