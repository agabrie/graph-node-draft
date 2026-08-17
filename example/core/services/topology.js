/* core/services/topology.js — TopologyService.
 *
 * Every read/query over a document: lookups, containment walks, edge and port
 * occupancy, visibility. Pure functions over (doc, registry) — no state, no
 * mutation. The Graph aggregate delegates its read API here.
 */
import { PortFactory } from '../model/port.js';

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

  /** Registry defaults merged with any instance overrides. */
  portsOf(doc, registry, id) {
    const n = this.node(doc, id); if (!n) return [];
    const desc = registry.describe(n.type);
    const merged = {};
    if (desc) Object.keys(desc.ports).forEach((p) => { merged[p] = desc.ports[p]; });
    if (n.ports) Object.keys(n.ports).forEach((p) => { merged[p] = n.ports[p]; });
    return Object.keys(merged).map((p) => PortFactory.resolve(p, merged[p]));
  },

  port(doc, registry, id, portId) {
    return this.portsOf(doc, registry, id).filter((p) => p.id === portId)[0] || null;
  },

  activeEdges(doc) {
    return this.allEdges(doc).filter((e) => e.state === 'active');
  },
  activeEdgesFrom(doc, id) {
    return this.activeEdges(doc).filter((e) => e.from.node === id);
  },
  activeEdgesTo(doc, id) {
    return this.activeEdges(doc).filter((e) => e.to.node === id);
  },
  activeEdgesFromPort(doc, id, port) {
    return this.activeEdgesFrom(doc, id).filter((e) => e.from.port === port);
  },
  edgesOf(doc, id) {
    return this.allEdges(doc).filter((e) => e.from.node === id || e.to.node === id);
  },
  degreeOf(doc, id) { return this.edgesOf(doc, id).length; },
  hasDetachedEdges(doc, id) {
    return this.edgesOf(doc, id).some((e) => e.state !== 'active');
  },

  /** Occupancy of one endpoint, counting active edges only. */
  portUsage(doc, id, port, direction) {
    const edges = direction === 'in' ? this.activeEdgesTo(doc, id) : this.activeEdgesFrom(doc, id);
    return edges.filter((e) => (direction === 'in' ? e.to.port : e.from.port) === port).length;
  },

  viewOf(doc, id) { return doc.view.nodes[id] || null; },
  isCollapsed(doc, id) {
    const v = this.viewOf(doc, id); return !!(v && v.collapsed);
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
