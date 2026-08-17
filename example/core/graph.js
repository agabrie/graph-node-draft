/* core/graph.js — the Graph aggregate root.
 *
 * A thin facade: reads delegate to TopologyService, writes go through the
 * MutationService's staged commit, checks come from the ValidationService.
 * Holds the document, the registry, and the change listeners — nothing else.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  function Graph(doc, registry) {
    this.doc = doc || GC.createDocument();
    this.registry = registry || new GC.TypeRegistry();
    this._listeners = [];
    this._inBatch = false;
  }

  Graph.prototype.onChange = function (fn) { this._listeners.push(fn); return this; };
  Graph.prototype._emit = function () {
    var self = this;
    this._listeners.forEach(function (f) { f(self); });
  };

  /* --- reads: delegated to TopologyService --- */

  Graph.prototype.node = function (id) { return GC.TopologyService.node(this.doc, id); };
  Graph.prototype.edge = function (id) { return GC.TopologyService.edge(this.doc, id); };
  Graph.prototype.allNodes = function () { return GC.TopologyService.allNodes(this.doc); };
  Graph.prototype.allEdges = function () { return GC.TopologyService.allEdges(this.doc); };
  Graph.prototype.parentOf = function (id) { return GC.TopologyService.parentOf(this.doc, id); };
  Graph.prototype.childrenOf = function (parentId) { return GC.TopologyService.childrenOf(this.doc, parentId); };
  Graph.prototype.childCount = function (id) { return GC.TopologyService.childCount(this.doc, id); };
  Graph.prototype.childNodeCount = function (id) { return GC.TopologyService.childNodeCount(this.doc, id); };
  Graph.prototype.portsOf = function (id) { return GC.TopologyService.portsOf(this.doc, this.registry, id); };
  Graph.prototype.port = function (id, portId) { return GC.TopologyService.port(this.doc, this.registry, id, portId); };
  Graph.prototype.activeEdges = function () { return GC.TopologyService.activeEdges(this.doc); };
  Graph.prototype.activeEdgesFrom = function (id) { return GC.TopologyService.activeEdgesFrom(this.doc, id); };
  Graph.prototype.activeEdgesTo = function (id) { return GC.TopologyService.activeEdgesTo(this.doc, id); };
  Graph.prototype.activeEdgesFromPort = function (id, port) { return GC.TopologyService.activeEdgesFromPort(this.doc, id, port); };
  Graph.prototype.edgesOf = function (id) { return GC.TopologyService.edgesOf(this.doc, id); };
  Graph.prototype.degreeOf = function (id) { return GC.TopologyService.degreeOf(this.doc, id); };
  Graph.prototype.hasDetachedEdges = function (id) { return GC.TopologyService.hasDetachedEdges(this.doc, id); };
  Graph.prototype.portUsage = function (id, port, direction) { return GC.TopologyService.portUsage(this.doc, id, port, direction); };
  Graph.prototype.viewOf = function (id) { return GC.TopologyService.viewOf(this.doc, id); };
  Graph.prototype.isCollapsed = function (id) { return GC.TopologyService.isCollapsed(this.doc, id); };
  Graph.prototype.visibleNodes = function (rootId) { return GC.TopologyService.visibleNodes(this.doc, rootId); };
  Graph.prototype.depthOf = function (id) { return GC.TopologyService.depthOf(this.doc, id); };

  /* --- mutation --- */

  /**
   * All writes go through here. Mutations apply to a copy; hooks run; invariants
   * are checked; only then is the result swapped in. A throwing hook leaves the
   * document untouched rather than half-written.
   */
  Graph.prototype.mutate = function (fn) {
    if (this._inBatch) throw new Error('nested mutate() — hooks must not re-enter');
    var before = this.doc;
    var staged = GC._clone(before);
    var ctx = new GC.MutationContext(this, staged);

    this._inBatch = true;
    try {
      var result = fn(ctx);
      ctx._runHooks();
      ctx._applyDeferred();
      staged.meta.revision = (staged.meta.revision || 0) + 1;
      staged.meta.updatedAt = new Date().toISOString();
      var errs = GC.validate(staged, this.registry).filter(function (i) { return i.level === 'error'; });
      if (errs.length) throw new Error('invariant violation: ' + errs.map(function (e) { return e.message; }).join('; '));
      this.doc = staged;
      return result;
    } finally {
      this._inBatch = false;
    }
    // note: _emit is called by callers after a successful mutate
  };

  /** Convenience: mutate then notify listeners. */
  Graph.prototype.apply = function (fn) {
    var r = this.mutate(fn);
    this._emit();
    return r;
  };

  Graph.prototype.validate = function () { return GC.validate(this.doc, this.registry); };
  Graph.prototype.toJSON = function () { return GC._clone(this.doc); };

  GC.Graph = Graph;
})(typeof window !== 'undefined' ? window : globalThis);
