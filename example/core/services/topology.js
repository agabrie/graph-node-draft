/* core/services/topology.js — TopologyService.
 *
 * Every read/query over a document: lookups, containment walks, edge and port
 * occupancy, visibility. Pure functions over (doc, registry) — no state, no
 * mutation. The Graph aggregate delegates its read API here.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  var T = {
    node: function (doc, id) { return doc.nodes[id] || null; },
    edge: function (doc, id) { return doc.edges[id] || null; },
    allNodes: function (doc) {
      return Object.keys(doc.nodes).map(function (k) { return doc.nodes[k]; });
    },
    allEdges: function (doc) {
      return Object.keys(doc.edges).map(function (k) { return doc.edges[k]; });
    },

    parentOf: function (doc, id) {
      var n = T.node(doc, id); return n ? (n.parent || null) : null;
    },

    childrenOf: function (doc, parentId) {
      var p = parentId || null;
      return T.allNodes(doc)
        .filter(function (n) { return (n.parent || null) === p; })
        .sort(function (a, b) { return (a.rank || '').localeCompare(b.rank || '') || a.id.localeCompare(b.id); });
    },

    childCount: function (doc, id) {
      var n = 0;
      Object.keys(doc.nodes).forEach(function (k) { if (doc.nodes[k].parent === id) n++; });
      Object.keys(doc.edges).forEach(function (k) { if (doc.edges[k].parent === id) n++; });
      return n;
    },

    childNodeCount: function (doc, id) {
      var n = 0;
      Object.keys(doc.nodes).forEach(function (k) { if (doc.nodes[k].parent === id) n++; });
      return n;
    },

    /** Registry defaults merged with any instance overrides. */
    portsOf: function (doc, registry, id) {
      var n = T.node(doc, id); if (!n) return [];
      var desc = registry.describe(n.type);
      var merged = {};
      if (desc) Object.keys(desc.ports).forEach(function (p) { merged[p] = desc.ports[p]; });
      if (n.ports) Object.keys(n.ports).forEach(function (p) { merged[p] = n.ports[p]; });
      return Object.keys(merged).map(function (p) {
        return GC.PortFactory.resolve(p, merged[p]);
      });
    },

    port: function (doc, registry, id, portId) {
      return T.portsOf(doc, registry, id).filter(function (p) { return p.id === portId; })[0] || null;
    },

    activeEdges: function (doc) {
      return T.allEdges(doc).filter(function (e) { return e.state === 'active'; });
    },
    activeEdgesFrom: function (doc, id) {
      return T.activeEdges(doc).filter(function (e) { return e.from.node === id; });
    },
    activeEdgesTo: function (doc, id) {
      return T.activeEdges(doc).filter(function (e) { return e.to.node === id; });
    },
    activeEdgesFromPort: function (doc, id, port) {
      return T.activeEdgesFrom(doc, id).filter(function (e) { return e.from.port === port; });
    },
    edgesOf: function (doc, id) {
      return T.allEdges(doc).filter(function (e) { return e.from.node === id || e.to.node === id; });
    },
    degreeOf: function (doc, id) { return T.edgesOf(doc, id).length; },
    hasDetachedEdges: function (doc, id) {
      return T.edgesOf(doc, id).some(function (e) { return e.state !== 'active'; });
    },

    /** Occupancy of one endpoint, counting active edges only. */
    portUsage: function (doc, id, port, direction) {
      var edges = direction === 'in' ? T.activeEdgesTo(doc, id) : T.activeEdgesFrom(doc, id);
      return edges.filter(function (e) {
        return (direction === 'in' ? e.to.port : e.from.port) === port;
      }).length;
    },

    viewOf: function (doc, id) { return doc.view.nodes[id] || null; },
    isCollapsed: function (doc, id) {
      var v = T.viewOf(doc, id); return !!(v && v.collapsed);
    },

    /** Depth-first walk, stopping at collapsed containers. */
    visibleNodes: function (doc, rootId) {
      var out = [];
      (function walk(pid) {
        T.childrenOf(doc, pid).forEach(function (n) {
          out.push(n);
          if (!T.isCollapsed(doc, n.id)) walk(n.id);
        });
      })(rootId || null);
      return out;
    },

    depthOf: function (doc, id) {
      var d = 0, cur = T.node(doc, id);
      while (cur && cur.parent) { d++; cur = T.node(doc, cur.parent); }
      return d;
    }
  };

  GC.TopologyService = T;
})(typeof window !== 'undefined' ? window : globalThis);
