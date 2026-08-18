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

  /** id itself if it is visible, otherwise the nearest ancestor that is not
   *  hidden behind a collapsed one — the visible stand-in for id. Meant for
   *  things like redirecting an edge whose endpoint is currently hidden
   *  (docs/domain-shape.md §8 / §10.4, the replacement for portals): the
   *  resolution is a pure read of `collapsed` and containment, so it lives
   *  here; what a renderer draws with the result — where, how — is its own
   *  call. */
  visibleAncestorOf(doc, id) {
    let cur = id;
    for (;;) {
      const parent = this.parentOf(doc, cur);
      if (!parent) return id;
      if (this.isCollapsed(doc, parent)) return parent;
      cur = parent;
    }
  },

  depthOf(doc, id) {
    let d = 0, cur = this.node(doc, id);
    while (cur && cur.parent) { d++; cur = this.node(doc, cur.parent); }
    return d;
  },

  /** Effective lockChildren state: true unless explicitly set to false
   *  (docs/domain-shape.md §2, §10.1) — a container's children default to
   *  fixed positions relative to it; lockChildren:false opts into
   *  whatever auto-layout a consumer implements instead. */
  isChildrenLocked(doc, id) {
    const m = this.metaOf(doc, 'node', id);
    return !m || m.lockChildren !== false;
  },

  /** Opt-in (default off, unlike lockChildren): whether this node's
   *  outgoing edges should be treated as rigid — see linkLockedCompanions. */
  isLinkLocked(doc, id) {
    const m = this.metaOf(doc, 'node', id);
    return !!(m && m.lockLinked);
  },

  /** Every containment ancestor of id: parent, grandparent, and so on. */
  ancestorsOf(doc, id) {
    const out = new Set();
    let p = this.parentOf(doc, id);
    while (p) { out.add(p); p = this.parentOf(doc, p); }
    return out;
  },

  /**
   * The nodes a lockLinked move starting at id should carry along:
   * everything reachable by following outgoing edges transitively.
   * Direction matters (a node drags what it points at, never what points
   * at it, same as containment), and the lock only needs to be set on id
   * itself — it is not required on the nodes in between for the chain to
   * keep propagating.
   *
   * Two exclusions. id's own containment ancestors are excluded even if an
   * edge points at one (edges cross containment freely — §2 — but moving
   * an ancestor would fight the containment math that already repositions
   * id when its container moves). And a node nested inside a container
   * that has opted out of lockChildren is excluded too, and the walk does
   * not continue past it — such a node's position is computed by
   * auto-layout on every render, so there is nothing to carry it by.
   *
   * Cycle-safe. Consumer-agnostic: this returns ids only. What a caller
   * does with them — whether any are currently on screen, where they
   * currently sit — is presentation state the library does not have.
   */
  linkLockedCompanions(doc, id) {
    const ancestors = this.ancestorsOf(doc, id);
    const seen = new Set([id]);
    const out = [];
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      frontier.forEach((cur) => {
        this.activeEdgesFrom(doc, cur).forEach((e) => {
          const other = e.to;
          if (!other || seen.has(other) || ancestors.has(other)) return;
          seen.add(other);
          const parent = this.parentOf(doc, other);
          const positioned = !parent || this.isChildrenLocked(doc, parent);
          if (positioned) { out.push(other); next.push(other); }
        });
      });
      frontier = next;
    }
    return out;
  }
};
