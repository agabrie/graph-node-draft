/* graph-core.js — the library.
 *
 * Knows nothing about rendering, layout, Mermaid, scenes, acts or branching.
 * Plain classic script so example.html opens from the filesystem with no server
 * and no build step. Attaches window.GraphCore.
 */
(function (root) {
  'use strict';

  /* ---------------- ids and ranks ---------------- */

  var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, no I L O U

  function newId() {
    var t = Date.now(), time = '';
    for (var i = 9; i >= 0; i--) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
    var rand = '';
    for (var j = 0; j < 16; j++) rand += B32[Math.floor(Math.random() * 32)];
    return time + rand; // 26 chars, matches the schema's id pattern
  }

  var RANK_A = 'abcdefghijklmnopqrstuvwxyz';

  /** Fractional index: a sortable string strictly between a and b. */
  function rankBetween(a, b) {
    a = a || ''; b = b || '';
    var out = '', i = 0;
    for (;;) {
      var ca = i < a.length ? RANK_A.indexOf(a[i]) : -1;
      var cb = i < b.length ? RANK_A.indexOf(b[i]) : RANK_A.length;
      if (cb - ca > 1) return out + RANK_A[Math.floor((ca + cb) / 2)];
      out += i < a.length ? a[i] : 'a';
      i++;
      if (i > 40) return out + 'm';
    }
  }

  function nextRank(existing) {
    var sorted = existing.slice().sort();
    return sorted.length ? rankBetween(sorted[sorted.length - 1], '') : 'm';
  }

  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  /* ---------------- type registry ---------------- */

  /** Subclass this in your project. The library only calls what it declares. */
  function BaseNodeType() {}
  BaseNodeType.type = 'core.node';
  BaseNodeType.label = 'Node';
  BaseNodeType.describe = function () {
    return {
      allowsChildren: true,
      ports: {
        'in': { direction: 'in', capacity: null },
        out: { direction: 'out', capacity: null }
      }
    };
  };

  function TypeRegistry() { this.types = {}; }

  TypeRegistry.prototype.register = function () {
    for (var i = 0; i < arguments.length; i++) {
      var T = arguments[i];
      if (!T || !T.type) throw new Error('type class needs a static `type`');
      this.types[T.type] = T;
    }
    return this;
  };

  TypeRegistry.prototype.get = function (name) { return this.types[name] || null; };
  TypeRegistry.prototype.has = function (name) { return !!this.types[name]; };

  TypeRegistry.prototype.describe = function (name) {
    var T = this.types[name];
    if (!T) return null;                    // unknown types are tolerated, not fatal
    var d = T.describe ? T.describe() : {};
    return {
      allowsChildren: d.allowsChildren !== false,
      ports: d.ports || {},
      onOverflow: d.onOverflow || null,
      allowedChildTypes: d.allowedChildTypes || null,
      label: T.label || name
    };
  };

  /** Everything registered, as plain data — this is what a backend consumes. */
  TypeRegistry.prototype.toJSON = function () {
    var out = {}, self = this;
    Object.keys(this.types).forEach(function (k) { out[k] = self.describe(k); });
    return out;
  };

  TypeRegistry.prototype.list = function () { return Object.keys(this.types); };

  /* ---------------- document ---------------- */

  function createDocument(opts) {
    opts = opts || {};
    return {
      schemaVersion: '1.0.0',
      id: newId(),
      kind: opts.kind || 'generic',
      title: opts.title || 'Untitled map',
      meta: { layout: { direction: 'LR' }, revision: 0 },
      nodes: {},
      edges: {},
      view: { nodes: {}, edges: {} },
      ext: {}
    };
  }

  /* ---------------- graph ---------------- */

  function Graph(doc, registry) {
    this.doc = doc || createDocument();
    this.registry = registry || new TypeRegistry();
    this._listeners = [];
    this._inBatch = false;
  }

  Graph.prototype.onChange = function (fn) { this._listeners.push(fn); return this; };
  Graph.prototype._emit = function () {
    var self = this;
    this._listeners.forEach(function (f) { f(self); });
  };

  /* --- reads --- */

  Graph.prototype.node = function (id) { return this.doc.nodes[id] || null; };
  Graph.prototype.edge = function (id) { return this.doc.edges[id] || null; };
  Graph.prototype.allNodes = function () { return Object.keys(this.doc.nodes).map(this.node, this); };
  Graph.prototype.allEdges = function () { return Object.keys(this.doc.edges).map(this.edge, this); };

  Graph.prototype.parentOf = function (id) {
    var n = this.node(id); return n ? (n.parent || null) : null;
  };

  Graph.prototype.childrenOf = function (parentId) {
    var p = parentId || null;
    return this.allNodes()
      .filter(function (n) { return (n.parent || null) === p; })
      .sort(function (a, b) { return (a.rank || '').localeCompare(b.rank || '') || a.id.localeCompare(b.id); });
  };

  Graph.prototype.childCount = function (id) {
    var n = 0, d = this.doc;
    Object.keys(d.nodes).forEach(function (k) { if (d.nodes[k].parent === id) n++; });
    Object.keys(d.edges).forEach(function (k) { if (d.edges[k].parent === id) n++; });
    return n;
  };

  Graph.prototype.childNodeCount = function (id) {
    var n = 0, d = this.doc;
    Object.keys(d.nodes).forEach(function (k) { if (d.nodes[k].parent === id) n++; });
    return n;
  };

  /** Registry defaults merged with any instance overrides. */
  Graph.prototype.portsOf = function (id) {
    var n = this.node(id); if (!n) return [];
    var desc = this.registry.describe(n.type);
    var merged = {};
    if (desc) Object.keys(desc.ports).forEach(function (p) { merged[p] = desc.ports[p]; });
    if (n.ports) Object.keys(n.ports).forEach(function (p) { merged[p] = n.ports[p]; });
    return Object.keys(merged).map(function (p) {
      var s = merged[p];
      return {
        id: p,
        direction: s.direction,
        label: s.label || '',
        capacity: s.capacity === undefined ? null : s.capacity
      };
    });
  };

  Graph.prototype.port = function (id, portId) {
    return this.portsOf(id).filter(function (p) { return p.id === portId; })[0] || null;
  };

  Graph.prototype.activeEdges = function () {
    return this.allEdges().filter(function (e) { return e.state === 'active'; });
  };
  Graph.prototype.activeEdgesFrom = function (id) {
    return this.activeEdges().filter(function (e) { return e.from.node === id; });
  };
  Graph.prototype.activeEdgesTo = function (id) {
    return this.activeEdges().filter(function (e) { return e.to.node === id; });
  };
  Graph.prototype.activeEdgesFromPort = function (id, port) {
    return this.activeEdgesFrom(id).filter(function (e) { return e.from.port === port; });
  };
  Graph.prototype.edgesOf = function (id) {
    return this.allEdges().filter(function (e) { return e.from.node === id || e.to.node === id; });
  };
  Graph.prototype.degreeOf = function (id) { return this.edgesOf(id).length; };
  Graph.prototype.hasDetachedEdges = function (id) {
    return this.edgesOf(id).some(function (e) { return e.state !== 'active'; });
  };

  /** Occupancy of one endpoint, counting active edges only. */
  Graph.prototype.portUsage = function (id, port, direction) {
    var edges = direction === 'in' ? this.activeEdgesTo(id) : this.activeEdgesFrom(id);
    return edges.filter(function (e) {
      return (direction === 'in' ? e.to.port : e.from.port) === port;
    }).length;
  };

  Graph.prototype.viewOf = function (id) { return this.doc.view.nodes[id] || null; };
  Graph.prototype.isCollapsed = function (id) {
    var v = this.viewOf(id); return !!(v && v.collapsed);
  };

  /** Depth-first walk, stopping at collapsed containers. */
  Graph.prototype.visibleNodes = function (rootId) {
    var out = [], self = this;
    (function walk(pid) {
      self.childrenOf(pid).forEach(function (n) {
        out.push(n);
        if (!self.isCollapsed(n.id)) walk(n.id);
      });
    })(rootId || null);
    return out;
  };

  Graph.prototype.depthOf = function (id) {
    var d = 0, cur = this.node(id);
    while (cur && cur.parent) { d++; cur = this.node(cur.parent); }
    return d;
  };

  /* --- mutation --- */

  /**
   * All writes go through here. Mutations apply to a copy; hooks run; invariants
   * are checked; only then is the result swapped in. A throwing hook leaves the
   * document untouched rather than half-written.
   */
  Graph.prototype.mutate = function (fn) {
    if (this._inBatch) throw new Error('nested mutate() — hooks must not re-enter');
    var before = this.doc;
    var staged = clone(before);
    var ctx = new Ctx(this, staged);

    this._inBatch = true;
    try {
      var result = fn(ctx);
      ctx._runHooks();
      ctx._applyDeferred();
      staged.meta.revision = (staged.meta.revision || 0) + 1;
      staged.meta.updatedAt = new Date().toISOString();
      var errs = validateDoc(staged, this.registry).filter(function (i) { return i.level === 'error'; });
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

  /* ---------------- mutation context ---------------- */

  function Ctx(graph, staged) {
    this.g = graph;
    this.doc = staged;
    this.registry = graph.registry;
    this._events = [];     // hook queue
    this._deferred = [];   // splice/remove requests raised inside hooks
    this._self = null;     // node id whose hook is currently running
    this.warnings = [];
  }

  /* reads on the staged copy */
  Ctx.prototype._view = function () {
    var g = new Graph(this.doc, this.registry);
    return g;
  };
  Ctx.prototype.node = function (id) { return this.doc.nodes[id] || null; };
  Ctx.prototype.parentOf = function (id) { var n = this.node(id); return n ? (n.parent || null) : null; };
  Ctx.prototype.childCount = function (id) { return this._view().childCount(id); };
  Ctx.prototype.portsOf = function (id) { return this._view().portsOf(id); };
  Ctx.prototype.activeEdgesFrom = function (id) { return this._view().activeEdgesFrom(id); };
  Ctx.prototype.activeEdgesTo = function (id) { return this._view().activeEdgesTo(id); };
  Ctx.prototype.activeEdgesFromPort = function (id, p) { return this._view().activeEdgesFromPort(id, p); };
  Ctx.prototype.hasDetachedEdges = function (id) { return this._view().hasDetachedEdges(id); };
  Ctx.prototype.edgesFromEndpoint = function (ep) {
    return this._view().activeEdgesFrom(ep.node).filter(function (e) { return e.from.port === ep.port; });
  };
  Ctx.prototype.warn = function (m) { this.warnings.push(m); };

  /* writes */

  Ctx.prototype.createNode = function (spec) {
    var id = newId();
    var siblings = this._view().childrenOf(spec.parent || null).map(function (n) { return n.rank; });
    this.doc.nodes[id] = {
      id: id,
      key: spec.key || null,
      type: spec.type,
      label: spec.label === undefined ? (this.registry.describe(spec.type) || {}).label || spec.type : spec.label,
      parent: spec.parent || null,
      rank: spec.rank || nextRank(siblings),
      state: 'active',
      ports: spec.ports || undefined,
      data: spec.data || {},
      ext: spec.ext || undefined
    };
    if (spec.view) this.doc.view.nodes[id] = spec.view;
    this._events.push({ kind: 'created', node: id });
    return id;
  };

  Ctx.prototype.updateNode = function (id, patch) {
    var n = this.doc.nodes[id];
    if (!n) throw new Error('no such node ' + id);
    Object.keys(patch).forEach(function (k) {
      if (k === 'data') n.data = Object.assign({}, n.data, patch.data);
      else n[k] = patch[k];
    });
  };

  Ctx.prototype.setView = function (id, patch) {
    var v = this.doc.view.nodes[id] || {};
    this.doc.view.nodes[id] = Object.assign(v, patch);
  };

  Ctx.prototype.createEdge = function (spec) {
    var id = newId();
    var parent = spec.parent !== undefined ? spec.parent : this.parentOf(spec.from.node);
    var ranks = Object.keys(this.doc.edges)
      .map(function (k) { return this.doc.edges[k]; }, this)
      .filter(function (e) { return (e.parent || null) === (parent || null); })
      .map(function (e) { return e.rank; });
    this.doc.edges[id] = {
      id: id,
      type: spec.type || 'core.link',
      from: { node: spec.from.node, port: spec.from.port },
      to: { node: spec.to.node, port: spec.to.port },
      parent: parent || null,
      rank: spec.rank || nextRank(ranks),
      label: spec.label || '',
      state: 'active',
      style: spec.style || { line: 'solid', arrowEnd: 'arrow' },
      data: spec.data || {}
    };
    this._events.push({ kind: 'edgeAdded', edge: id });
    return id;
  };

  /** Move one end of an existing edge. Capacity is unchanged for the other end. */
  Ctx.prototype.retargetEdge = function (id, to, which) {
    var e = this.doc.edges[id];
    if (!e) throw new Error('no such edge ' + id);
    if (which === 'from') e.from = { node: to.node, port: to.port };
    else e.to = { node: to.node, port: to.port };
    e.parent = this.parentOf(e.from.node) || null;
  };

  Ctx.prototype.removeEdge = function (id) {
    var e = this.doc.edges[id];
    if (!e) return;
    delete this.doc.edges[id];
    delete this.doc.view.edges[id];
    this._events.push({ kind: 'edgeRemoved', edge: clone(e) });
  };

  Ctx.prototype.setEdgeState = function (id, state) {
    var e = this.doc.edges[id]; if (e) e.state = state;
  };

  Ctx.prototype.addPort = function (id, portId, spec) {
    var n = this.doc.nodes[id]; if (!n) return;
    if (!n.ports) {
      n.ports = {};
      var desc = this.registry.describe(n.type);
      if (desc) Object.keys(desc.ports).forEach(function (p) { n.ports[p] = clone(desc.ports[p]); });
    }
    n.ports[portId] = spec;
  };

  Ctx.prototype.removePort = function (id, portId) {
    var n = this.doc.nodes[id];
    if (!n || !n.ports) return;
    var used = this._view().edgesOf(id).some(function (e) {
      return (e.from.node === id && e.from.port === portId) || (e.to.node === id && e.to.port === portId);
    });
    if (used) throw new Error('port ' + portId + ' still has edges');
    delete n.ports[portId];
  };

  Ctx.prototype.removeNode = function (id) {
    delete this.doc.nodes[id];
    delete this.doc.view.nodes[id];
  };

  /* self-directed operations, only meaningful inside a node hook */

  Ctx.prototype.spliceSelf = function () {
    if (!this._self) throw new Error('spliceSelf() outside a node hook');
    this._deferred.push({ op: 'splice', node: this._self });
  };
  Ctx.prototype.removeSelfAndEdges = function () {
    if (!this._self) throw new Error('removeSelfAndEdges() outside a node hook');
    this._deferred.push({ op: 'remove', node: this._self });
  };

  /* --- hook dispatch --- */

  Ctx.prototype._instance = function (id) {
    var n = this.doc.nodes[id];
    if (!n) return null;
    var T = this.registry.get(n.type);
    if (!T) return null;                 // unknown type: tolerated, just no behaviour
    var inst = Object.create(T.prototype);
    inst.id = n.id; inst.data = n.data || {}; inst.ext = n.ext; inst.label = n.label; inst.type = n.type;
    return inst;
  };

  Ctx.prototype._call = function (id, hook, arg) {
    var inst = this._instance(id);
    if (!inst || typeof inst[hook] !== 'function') return;
    var prev = this._self;
    this._self = id;
    try { inst[hook](this, arg); } finally { this._self = prev; }
  };

  Ctx.prototype._runHooks = function () {
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

  Ctx.prototype._applyDeferred = function () {
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

  /* ---------------- high level operations ---------------- */

  var ops = {
    addNode: function (graph, spec) {
      return graph.apply(function (ctx) { return ctx.createNode(spec); });
    },

    updateNode: function (graph, id, patch) {
      return graph.apply(function (ctx) { ctx.updateNode(id, patch); });
    },

    setView: function (graph, id, patch) {
      // presentation only — bumps revision but touches no structure
      return graph.apply(function (ctx) { ctx.setView(id, patch); });
    },

    reparent: function (graph, id, newParent) {
      return graph.apply(function (ctx) {
        if (newParent === id) throw new Error('a node cannot contain itself');
        var p = newParent;
        while (p) { if (p === id) throw new Error('that would create a cycle'); p = ctx.parentOf(p); }
        ctx.updateNode(id, { parent: newParent || null });
        // keep edges level-local: drop any that now cross a boundary
        ctx._view().edgesOf(id).forEach(function (e) {
          var a = ctx.parentOf(e.from.node), b = ctx.parentOf(e.to.node);
          if ((a || null) !== (b || null)) ctx.removeEdge(e.id);
        });
      });
    },

    /**
     * Connect two ports. If the source port is full, ask the type's registered
     * overflow handler. The library itself knows nothing about branching.
     */
    connect: function (graph, from, to, spec) {
      return graph.apply(function (ctx) {
        var g = ctx._view();
        var sp = g.port(from.node, from.port);
        var tp = g.port(to.node, to.port);
        if (!sp) throw new Error('no port ' + from.port + ' on source');
        if (!tp) throw new Error('no port ' + to.port + ' on target');
        if (sp.direction === 'in') throw new Error('cannot start an edge at an in-port');
        if (tp.direction === 'out') throw new Error('cannot end an edge at an out-port');

        var used = g.portUsage(from.node, from.port, 'out');
        if (sp.capacity !== null && used >= sp.capacity) {
          var srcType = ctx.node(from.node).type;
          var desc = ctx.registry.describe(srcType) || {};
          var handlerName = desc.onOverflow;
          var Handler = handlerName ? ctx.registry.get(handlerName) : null;
          if (Handler && typeof Handler.handleOverflow === 'function') {
            var handled = Handler.handleOverflow(ctx, { source: from, target: to, edgeType: (spec || {}).type });
            if (handled) return;
          }
          throw new Error('port ' + from.port + ' is full (capacity ' + sp.capacity + ')');
        }
        ctx.createEdge(Object.assign({ from: from, to: to }, spec || {}));
      });
    },

    disconnectEdge: function (graph, id) {
      return graph.apply(function (ctx) { ctx.removeEdge(id); });
    },

    setEdge: function (graph, id, patch) {
      return graph.apply(function (ctx) {
        var e = ctx.doc.edges[id];
        if (!e) throw new Error('no such edge');
        if (patch.label !== undefined) e.label = patch.label;
        if (patch.style) e.style = Object.assign({}, e.style, patch.style);
        if (patch.data) e.data = Object.assign({}, e.data, patch.data);
      });
    },

    /** Soft removal. Wiring is preserved so it can be reattached. */
    detach: function (graph, id) {
      return graph.apply(function (ctx) {
        ctx.updateNode(id, { state: 'detached' });
        ctx._view().edgesOf(id).forEach(function (e) { ctx.setEdgeState(e.id, 'detached'); });
        ctx._view().childrenOf(id).forEach(function (c) {
          ctx.updateNode(c.id, { state: 'detached' });
        });
      });
    },

    attach: function (graph, id) {
      return graph.apply(function (ctx) {
        ctx.updateNode(id, { state: 'active' });
        ctx._view().edgesOf(id).forEach(function (e) {
          if (ctx.doc.nodes[e.from.node] && ctx.doc.nodes[e.to.node]) ctx.setEdgeState(e.id, 'active');
          else ctx.removeEdge(e.id);
        });
        ctx._view().childrenOf(id).forEach(function (c) { ctx.updateNode(c.id, { state: 'active' }); });
      });
    },

    /** Hard-remove every edge touching the node. */
    disconnect: function (graph, id) {
      return graph.apply(function (ctx) {
        ctx._view().edgesOf(id).forEach(function (e) { ctx.removeEdge(e.id); });
      });
    },

    /** Permanent. Refuses while the node still has edges or children. */
    purge: function (graph, id) {
      return graph.apply(function (ctx) {
        var g = ctx._view();
        if (g.degreeOf(id) > 0) throw new Error('disconnect it first — it still has edges');
        if (g.childCount(id) > 0) throw new Error('it still has children (nodes or edges)');
        ctx.removeNode(id);
      });
    },

    collapse: function (graph, id, collapsed) {
      return graph.apply(function (ctx) { ctx.setView(id, { collapsed: !!collapsed }); });
    }
  };

  /* ---------------- validation ---------------- */

  function validateDoc(doc, registry) {
    var issues = [];
    var err = function (m, id) { issues.push({ level: 'error', message: m, nodeId: id }); };
    var warn = function (m, id) { issues.push({ level: 'warn', message: m, nodeId: id }); };
    var g = new Graph(doc, registry);

    Object.keys(doc.nodes).forEach(function (k) {
      if (doc.nodes[k].id !== k) err('node key ' + k + ' does not match its id');
    });
    Object.keys(doc.edges).forEach(function (k) {
      if (doc.edges[k].id !== k) err('edge key ' + k + ' does not match its id');
    });

    Object.keys(doc.nodes).forEach(function (k) {
      var seen = {}, cur = doc.nodes[k];
      while (cur && cur.parent) {
        if (seen[cur.id]) { err('containment cycle through ' + k, k); break; }
        seen[cur.id] = 1;
        cur = doc.nodes[cur.parent];
        if (!cur) { err('node ' + k + ' has a missing parent', k); break; }
      }
    });

    Object.keys(doc.edges).forEach(function (k) {
      var e = doc.edges[k];
      ['from', 'to'].forEach(function (side) {
        var ep = e[side];
        if (!doc.nodes[ep.node]) { err('edge ' + k + '.' + side + ' points at a missing node'); return; }
        var p = g.port(ep.node, ep.port);
        if (!p) { err('edge ' + k + '.' + side + ' uses unknown port "' + ep.port + '"'); return; }
        var want = side === 'from' ? 'out' : 'in';
        if (p.direction !== want && p.direction !== 'inout') {
          err('edge ' + k + '.' + side + ' uses a ' + p.direction + '-port where ' + want + ' was needed');
        }
      });
    });

    // capacity: maximum is an error, minimum is only ever a warning, because a
    // freshly created node legitimately has nothing connected yet
    g.allNodes().forEach(function (n) {
      if (n.state !== 'active') return;
      g.portsOf(n.id).forEach(function (p) {
        var used = g.portUsage(n.id, p.id, p.direction === 'in' ? 'in' : 'out');
        if (p.capacity !== null && used > p.capacity) {
          err((n.label || n.id) + '.' + p.id + ' has ' + used + ' connections, capacity ' + p.capacity, n.id);
        }
      });
    });

    // sibling key uniqueness
    var byParent = {};
    g.allNodes().forEach(function (n) {
      if (!n.key) return;
      var p = n.parent || '~root';
      byParent[p] = byParent[p] || {};
      if (byParent[p][n.key]) warn('duplicate key "' + n.key + '" among siblings', n.id);
      byParent[p][n.key] = 1;
    });

    Object.keys(doc.view.nodes || {}).forEach(function (k) {
      if (!doc.nodes[k]) warn('view entry for a node that no longer exists: ' + k);
    });

    // containment rules from the registry
    g.allNodes().forEach(function (n) {
      if (!n.parent) return;
      var parent = doc.nodes[n.parent];
      if (!parent) return;
      var d = registry.describe(parent.type);
      if (!d) return;
      if (d.allowsChildren === false) err((parent.label || parent.id) + ' cannot contain children', n.id);
      if (d.allowedChildTypes && d.allowedChildTypes.indexOf(n.type) === -1) {
        err(n.type + ' is not permitted inside ' + parent.type, n.id);
      }
    });

    // type-supplied lints
    g.allNodes().forEach(function (n) {
      var T = registry.get(n.type);
      if (!T || !T.prototype.validate) return;
      var inst = Object.create(T.prototype);
      inst.id = n.id; inst.data = n.data || {}; inst.ext = n.ext; inst.label = n.label;
      var ctx = new Ctx(g, doc);
      (inst.validate(ctx) || []).forEach(function (i) { issues.push(i); });
    });

    // unknown types are reported, never fatal
    g.allNodes().forEach(function (n) {
      if (!registry.has(n.type)) warn('unknown type "' + n.type + '" — rendered with a fallback', n.id);
    });

    return issues;
  }

  Graph.prototype.validate = function () { return validateDoc(this.doc, this.registry); };
  Graph.prototype.toJSON = function () { return clone(this.doc); };

  root.GraphCore = {
    newId: newId,
    rankBetween: rankBetween,
    nextRank: nextRank,
    createDocument: createDocument,
    BaseNodeType: BaseNodeType,
    TypeRegistry: TypeRegistry,
    Graph: Graph,
    ops: ops,
    validate: validateDoc
  };
})(typeof window !== 'undefined' ? window : globalThis);
