/* core/services/mutation.js — MutationService.
 *
 * The MutationContext is what a mutation function and every type hook receive.
 * It stages writes against a copied document, queues hook events, and defers
 * self-directed operations (splice/remove) until all hooks have run. Nothing
 * is visible outside the batch until Graph.mutate() commits it.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  function MutationContext(graph, staged) {
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
    return new GC.Graph(this.doc, this.registry);
  };
  MutationContext.prototype.node = function (id) { return this.doc.nodes[id] || null; };
  MutationContext.prototype.parentOf = function (id) { var n = this.node(id); return n ? (n.parent || null) : null; };
  MutationContext.prototype.childCount = function (id) { return this._view().childCount(id); };
  MutationContext.prototype.portsOf = function (id) { return this._view().portsOf(id); };
  MutationContext.prototype.activeEdgesFrom = function (id) { return this._view().activeEdgesFrom(id); };
  MutationContext.prototype.activeEdgesTo = function (id) { return this._view().activeEdgesTo(id); };
  MutationContext.prototype.activeEdgesFromPort = function (id, p) { return this._view().activeEdgesFromPort(id, p); };
  MutationContext.prototype.hasDetachedEdges = function (id) { return this._view().hasDetachedEdges(id); };
  MutationContext.prototype.edgesFromEndpoint = function (ep) {
    return this._view().activeEdgesFrom(ep.node).filter(function (e) { return e.from.port === ep.port; });
  };
  MutationContext.prototype.warn = function (m) { this.warnings.push(m); };

  /* writes */

  MutationContext.prototype.createNode = function (spec) {
    var id = GC.newId();
    var siblings = this._view().childrenOf(spec.parent || null).map(function (n) { return n.rank; });
    this.doc.nodes[id] = GC.NodeFactory.create(spec, {
      id: id,
      rank: GC.nextRank(siblings),
      label: spec.label === undefined ? (this.registry.describe(spec.type) || {}).label || spec.type : spec.label
    });
    if (spec.view) this.doc.view.nodes[id] = spec.view;
    this._events.push({ kind: 'created', node: id });
    return id;
  };

  MutationContext.prototype.updateNode = function (id, patch) {
    var n = this.doc.nodes[id];
    if (!n) throw new Error('no such node ' + id);
    Object.keys(patch).forEach(function (k) {
      if (k === 'data') n.data = Object.assign({}, n.data, patch.data);
      else n[k] = patch[k];
    });
  };

  MutationContext.prototype.setView = function (id, patch) {
    var v = this.doc.view.nodes[id] || {};
    this.doc.view.nodes[id] = Object.assign(v, patch);
  };

  MutationContext.prototype.createEdge = function (spec) {
    var id = GC.newId();
    var parent = spec.parent !== undefined ? spec.parent : this.parentOf(spec.from.node);
    var ranks = Object.keys(this.doc.edges)
      .map(function (k) { return this.doc.edges[k]; }, this)
      .filter(function (e) { return (e.parent || null) === (parent || null); })
      .map(function (e) { return e.rank; });
    this.doc.edges[id] = GC.EdgeFactory.create(spec, {
      id: id,
      parent: parent,
      rank: GC.nextRank(ranks)
    });
    this._events.push({ kind: 'edgeAdded', edge: id });
    return id;
  };

  /** Move one end of an existing edge. Capacity is unchanged for the other end. */
  MutationContext.prototype.retargetEdge = function (id, to, which) {
    var e = this.doc.edges[id];
    if (!e) throw new Error('no such edge ' + id);
    if (which === 'from') e.from = { node: to.node, port: to.port };
    else e.to = { node: to.node, port: to.port };
    e.parent = this.parentOf(e.from.node) || null;
  };

  MutationContext.prototype.removeEdge = function (id) {
    var e = this.doc.edges[id];
    if (!e) return;
    delete this.doc.edges[id];
    delete this.doc.view.edges[id];
    this._events.push({ kind: 'edgeRemoved', edge: GC._clone(e) });
  };

  MutationContext.prototype.setEdgeState = function (id, state) {
    var e = this.doc.edges[id]; if (e) e.state = state;
  };

  MutationContext.prototype.addPort = function (id, portId, spec) {
    var n = this.doc.nodes[id]; if (!n) return;
    if (!n.ports) {
      n.ports = {};
      var desc = this.registry.describe(n.type);
      if (desc) Object.keys(desc.ports).forEach(function (p) { n.ports[p] = GC._clone(desc.ports[p]); });
    }
    n.ports[portId] = spec;
  };

  MutationContext.prototype.removePort = function (id, portId) {
    var n = this.doc.nodes[id];
    if (!n || !n.ports) return;
    var used = this._view().edgesOf(id).some(function (e) {
      return (e.from.node === id && e.from.port === portId) || (e.to.node === id && e.to.port === portId);
    });
    if (used) throw new Error('port ' + portId + ' still has edges');
    delete n.ports[portId];
  };

  MutationContext.prototype.removeNode = function (id) {
    delete this.doc.nodes[id];
    delete this.doc.view.nodes[id];
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

  MutationContext.prototype._instance = function (id) {
    var n = this.doc.nodes[id];
    if (!n) return null;
    var T = this.registry.get(n.type);
    if (!T) return null;                 // unknown type: tolerated, just no behaviour
    var inst = Object.create(T.prototype);
    inst.id = n.id; inst.data = n.data || {}; inst.ext = n.ext; inst.label = n.label; inst.type = n.type;
    return inst;
  };

  MutationContext.prototype._call = function (id, hook, arg) {
    var inst = this._instance(id);
    if (!inst || typeof inst[hook] !== 'function') return;
    var prev = this._self;
    this._self = id;
    try { inst[hook](this, arg); } finally { this._self = prev; }
  };

  MutationContext.prototype._runHooks = function () {
    var queue = this._events.slice();
    this._events.length = 0;
    for (var i = 0; i < queue.length; i++) {
      var ev = queue[i];
      if (ev.kind === 'created') {
        this._call(ev.node, 'onCreate');
      } else if (ev.kind === 'edgeAdded') {
        var e = this.doc.edges[ev.edge];
        if (e) { this._call(e.from.node, 'onEdgeAdded', e); this._call(e.to.node, 'onEdgeAdded', e); }
      } else if (ev.kind === 'edgeRemoved') {
        this._call(ev.edge.from.node, 'onEdgeRemoved', ev.edge);
        this._call(ev.edge.to.node, 'onEdgeRemoved', ev.edge);
      }
    }
    // Hooks may have queued more events (e.g. a split inserting edges). Fire one
    // more round, then stop — deliberately shallow, so behaviour cannot recurse.
    var second = this._events.slice();
    this._events.length = 0;
    for (var j = 0; j < second.length; j++) {
      var ev2 = second[j];
      if (ev2.kind === 'created') this._call(ev2.node, 'onCreate');
    }
  };

  MutationContext.prototype._applyDeferred = function () {
    var self = this;
    this._deferred.forEach(function (d) {
      var g = self._view();
      if (d.op === 'splice') {
        var ins = g.activeEdgesTo(d.node), outs = g.activeEdgesFrom(d.node);
        if (ins.length === 1 && outs.length === 1) {
          self.retargetEdge(ins[0].id, { node: outs[0].to.node, port: outs[0].to.port });
          delete self.doc.edges[outs[0].id];
        }
        g.edgesOf(d.node).forEach(function (e) { delete self.doc.edges[e.id]; });
        self.removeNode(d.node);
      } else if (d.op === 'remove') {
        g.edgesOf(d.node).forEach(function (e) { delete self.doc.edges[e.id]; });
        self.removeNode(d.node);
      }
    });
    this._deferred.length = 0;
  };

  GC.MutationContext = MutationContext;
})(typeof window !== 'undefined' ? window : globalThis);
