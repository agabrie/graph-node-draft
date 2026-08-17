/* core/services/ops.js — OperationsService.
 *
 * The high-level operations an editor calls: one user gesture, one atomic
 * batch. Each delegates to the MutationContext; the overflow hand-off in
 * connect() is the library's entire knowledge of branching.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

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

  GC.OperationsService = ops;
  GC.ops = ops; // kept for API compatibility
})(typeof window !== 'undefined' ? window : globalThis);
