/* lib/services/topology.js — TopologyService.
 *
 * Every read/query over a document: lookups, containment walks, edge
 * incidence, metadata resolution, visibility. Pure functions over
 * (doc[, registry]) — no state, no mutation. The Graph aggregate delegates
 * its read API here.
 */

export const TopologyService = {
  node(doc, id) { return doc.nodes[id] || null; },
  edge(doc, id) { return doc.edges[id] || null; },
  allNodes(doc) {
    return Object.keys(doc.nodes).map((k) => doc.nodes[k]);
  },
  allEdges(doc) {
    return Object.keys(doc.edges).map((k) => doc.edges[k]);
  },

  parentOf(doc, id) {
    const n = this.node(doc, id); return n ? (n.parent || null) : null;
  },

  childrenOf(doc, parentId) {
    const p = parentId || null;
    return this.allNodes(doc)
      .filter((n) => (n.parent || null) === p)
      .sort((a, b) => (a.rank || '').localeCompare(b.rank || '') || a.id.localeCompare(b.id));
  },

  /** Nodes and edges parented under id — an edge-grouping container (e.g. a
   *  sequence block) has edge children, not node children. */
  childCount(doc, id) {
    let n = 0;
    Object.keys(doc.nodes).forEach((k) => { if (doc.nodes[k].parent === id) n++; });
    Object.keys(doc.edges).forEach((k) => { if (doc.edges[k].parent === id) n++; });
    return n;
  },

  childNodeCount(doc, id) {
    let n = 0;
    Object.keys(doc.nodes).forEach((k) => { if (doc.nodes[k].parent === id) n++; });
    return n;
  },

  activeEdges(doc) {
    return this.allEdges(doc).filter((e) => e.state === 'active');
  },
  activeEdgesFrom(doc, id) {
    return this.activeEdges(doc).filter((e) => e.from === id);
  },
  activeEdgesTo(doc, id) {
    return this.activeEdges(doc).filter((e) => e.to === id);
  },
  edgesOf(doc, id) {
    return this.allEdges(doc).filter((e) => e.from === id || e.to === id);
  },
  degreeOf(doc, id) { return this.edgesOf(doc, id).length; },
  hasDetachedEdges(doc, id) {
    return this.edgesOf(doc, id).some((e) => e.state !== 'active');
  },

  /** Resolve a node's or edge's `meta` reference to its metadata record. */
  metaOf(doc, kind, id) {
    const rec = kind === 'edge' ? doc.edges[id] : doc.nodes[id];
    if (!rec || !rec.meta) return null;
    return doc.metadata[rec.meta] || null;
  },

  /** Convenience: a node's registered type name, or null if untyped. */
  typeOf(doc, id) {
    const m = this.metaOf(doc, 'node', id);
    return (m && m.type) || null;
  },

  isCollapsed(doc, id) {
    const m = this.metaOf(doc, 'node', id);
    return !!(m && m.collapsed);
  },

  /** Depth-first walk, stopping at collapsed containers. */
  visibleNodes(doc, rootId) {
    const out = [];
    const walk = (pid) => {
      this.childrenOf(doc, pid).forEach((n) => {
        out.push(n);
        if (!this.isCollapsed(doc, n.id)) walk(n.id);
      });
    };
    walk(rootId || null);
    return out;
  },

  depthOf(doc, id) {
    let d = 0, cur = this.node(doc, id);
    while (cur && cur.parent) { d++; cur = this.node(doc, cur.parent); }
    return d;
  }
};
