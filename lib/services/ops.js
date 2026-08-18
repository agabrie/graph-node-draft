/* lib/services/ops.js — OperationsService.
 *
 * The high-level operations a consumer calls: one call, one atomic batch
 * (docs/domain-shape.md §5). No branching, no capacity policing — a type's
 * own hooks (onEdgeAdded/onEdgeRemoved) are where a consumer builds that kind
 * of behaviour; these ops just create records and let the hooks and the
 * validation gate do their job.
 */

export const ops = {
  addNode(graph, spec) {
    return graph.apply((ctx) => ctx.createNode(spec));
  },

  /** Patch a node's opaque payload. Metadata (type/label/position/…) goes
   *  through setNodeMeta, never through here. */
  setNodeData(graph, id, data) {
    return graph.apply((ctx) => { ctx.updateNode(id, { data }); });
  },

  setEdgeData(graph, id, data) {
    return graph.apply((ctx) => {
      const e = ctx.edge(id);
      if (!e) throw new Error('no such edge ' + id);
      e.data = Object.assign({}, e.data, data);
    });
  },

  /** Merge fields into a node's metadata record, creating one on first write. */
  setNodeMeta(graph, id, patch) {
    return graph.apply((ctx) => { ctx.setMeta('node', id, patch); });
  },

  setEdgeMeta(graph, id, patch) {
    return graph.apply((ctx) => { ctx.setMeta('edge', id, patch); });
  },

  /** Point a node's or edge's metadata reference at an existing record —
   *  sharing a metadata record between owners. */
  linkMeta(graph, kind, id, metaId) {
    return graph.apply((ctx) => { ctx.linkMeta(kind, id, metaId); });
  },

  collapse(graph, id, collapsed) {
    return graph.apply((ctx) => { ctx.setMeta('node', id, { collapsed: !!collapsed }); });
  },

  reparent(graph, id, newParent) {
    return graph.apply((ctx) => {
      if (newParent === id) throw new Error('a node cannot contain itself');
      let p = newParent;
      while (p) { if (p === id) throw new Error('that would create a cycle'); p = ctx.parentOf(p); }
      ctx.updateNode(id, { parent: newParent || null });
      // No edges are dropped: edges may freely cross containment boundaries.
    });
  },

  /** Connect two nodes directly — no ports, no capacity gate. If a type
   *  wants to react to fan-out (e.g. insert a branch-split), it does so from
   *  its own onEdgeAdded hook, in the same atomic batch as this call. */
  connect(graph, from, to, spec) {
    return graph.apply((ctx) => {
      if (!ctx.node(from)) throw new Error('no such node ' + from);
      if (!ctx.node(to)) throw new Error('no such node ' + to);
      return ctx.createEdge(Object.assign({ from, to }, spec || {}));
    });
  },

  disconnectEdge(graph, id) {
    return graph.apply((ctx) => { ctx.removeEdge(id); });
  },

  /** Soft removal. Wiring is preserved so it can be reattached; children
   *  cascade with it. */
  detach(graph, id) {
    return graph.apply((ctx) => {
      ctx.updateNode(id, { state: 'detached' });
      ctx._view().edgesOf(id).forEach((e) => { ctx.setEdgeState(e.id, 'detached'); });
      ctx._view().childrenOf(id).forEach((c) => {
        ctx.updateNode(c.id, { state: 'detached' });
      });
    });
  },

  attach(graph, id) {
    return graph.apply((ctx) => {
      ctx.updateNode(id, { state: 'active' });
      ctx._view().edgesOf(id).forEach((e) => {
        if (ctx.doc.nodes[e.from] && ctx.doc.nodes[e.to]) ctx.setEdgeState(e.id, 'active');
        else ctx.removeEdge(e.id);
      });
      ctx._view().childrenOf(id).forEach((c) => { ctx.updateNode(c.id, { state: 'active' }); });
    });
  },

  /** Hard-remove every edge touching the node. */
  disconnect(graph, id) {
    return graph.apply((ctx) => {
      ctx._view().edgesOf(id).forEach((e) => { ctx.removeEdge(e.id); });
    });
  },

  /** Permanent. Refuses while the node still has edges or children. */
  purge(graph, id) {
    return graph.apply((ctx) => {
      const g = ctx._view();
      if (g.degreeOf(id) > 0) throw new Error('disconnect it first — it still has edges');
      if (g.childCount(id) > 0) throw new Error('it still has children (nodes or edges)');
      ctx.removeNode(id);
    });
  }
};

export const OperationsService = ops;
