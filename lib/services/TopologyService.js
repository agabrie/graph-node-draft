/* lib/services/TopologyService.js — TopologyService.
 *
 * Every read/query over a document: lookups, containment walks, edge
 * incidence, metadata resolution, visibility. Pure functions over
 * (doc[, registry]) — no state, no mutation. The Graph aggregate delegates
 * its read API here.
 */

export class TopologyService {
  static node(doc, id) { return doc.nodes[id] || null; }
  static edge(doc, id) { return doc.edges[id] || null; }
  static allNodes(doc) {
    return Object.keys(doc.nodes).map((k) => doc.nodes[k]);
  }
  static allEdges(doc) {
    return Object.keys(doc.edges).map((k) => doc.edges[k]);
  }

  static parentOf(doc, id) {
    const n = this.node(doc, id); return n ? (n.parent || null) : null;
  }

  static childrenOf(doc, parentId) {
    const p = parentId || null;
    return this.allNodes(doc)
      .filter((n) => (n.parent || null) === p)
      .sort((a, b) => (a.rank || '').localeCompare(b.rank || '') || a.id.localeCompare(b.id));
  }

  /** Nodes and edges parented under id — an edge-grouping container (e.g. a
   *  sequence block) has edge children, not node children. */
  static childCount(doc, id) {
    let n = 0;
    Object.keys(doc.nodes).forEach((k) => { if (doc.nodes[k].parent === id) n++; });
    Object.keys(doc.edges).forEach((k) => { if (doc.edges[k].parent === id) n++; });
    return n;
  }

  static childNodeCount(doc, id) {
    let n = 0;
    Object.keys(doc.nodes).forEach((k) => { if (doc.nodes[k].parent === id) n++; });
    return n;
  }

  static activeEdges(doc) {
    return this.allEdges(doc).filter((e) => e.state === 'active');
  }
  static activeEdgesFrom(doc, id) {
    return this.activeEdges(doc).filter((e) => e.from === id);
  }
  static activeEdgesTo(doc, id) {
    return this.activeEdges(doc).filter((e) => e.to === id);
  }
  static edgesOf(doc, id) {
    return this.allEdges(doc).filter((e) => e.from === id || e.to === id);
  }
  static degreeOf(doc, id) { return this.edgesOf(doc, id).length; }
  static hasDetachedEdges(doc, id) {
    return this.edgesOf(doc, id).some((e) => e.state !== 'active');
  }

  /** Resolve a node's or edge's `meta` reference to its metadata record. */
  static metaOf(doc, kind, id) {
    const rec = kind === 'edge' ? doc.edges[id] : doc.nodes[id];
    if (!rec || !rec.meta) return null;
    return doc.metadata[rec.meta] || null;
  }

  /** Convenience: a node's registered type name, or null if untyped. */
  static typeOf(doc, id) {
    const m = this.metaOf(doc, 'node', id);
    return (m && m.type) || null;
  }

  /** Delegates to the node's own isCollapsed() (model/Node.js) — kept here
   *  too so doc-only callers don't need a Node instance in hand. */
  static isCollapsed(doc, id) {
    const n = this.node(doc, id);
    return !!(n && n.isCollapsed());
  }

  /** Depth-first walk, stopping at collapsed containers. */
  static visibleNodes(doc, rootId) {
    const out = [];
    const walk = (pid) => {
      this.childrenOf(doc, pid).forEach((n) => {
        out.push(n);
        if (!n.isCollapsed()) walk(n.id);
      });
    };
    walk(rootId || null);
    return out;
  }

  /** id itself if it is visible, otherwise the nearest ancestor that is not
   *  hidden behind a collapsed one — the visible stand-in for id. Meant for
   *  things like redirecting an edge whose endpoint is currently hidden
   *  (docs/domain-shape.md §8 / §10.4, the replacement for portals): the
   *  resolution is a pure read of `collapsed` and containment, so it lives
   *  here; what a renderer draws with the result — where, how — is its own
   *  call. */
  static visibleAncestorOf(doc, id) {
    let cur = id;
    for (;;) {
      const parent = this.parentOf(doc, cur);
      if (!parent) return id;
      if (this.isCollapsed(doc, parent)) return parent;
      cur = parent;
    }
  }

  static depthOf(doc, id) {
    let d = 0, cur = this.node(doc, id);
    while (cur && cur.parent) { d++; cur = this.node(doc, cur.parent); }
    return d;
  }

  /** Delegates to the node's own isChildrenLocked()/isLinkLocked()
   *  (model/Node.js) — kept here too so doc-only callers don't need a Node
   *  instance in hand. */
  static isChildrenLocked(doc, id) {
    const n = this.node(doc, id);
    return !n || n.isChildrenLocked();
  }

  static isLinkLocked(doc, id) {
    const n = this.node(doc, id);
    return !!(n && n.isLinkLocked());
  }

  /** Every containment ancestor of id: parent, grandparent, and so on.
   *  Containment only — see downstreamOf for the separate, edge-based
   *  relationship. */
  static ancestorsOf(doc, id) {
    const out = new Set();
    let p = this.parentOf(doc, id);
    while (p) { out.add(p); p = this.parentOf(doc, p); }
    return out;
  }

  /**
   * Every id reachable from id by following outgoing edges transitively —
   * "downstream" in the sense of link connectivity, not containment. See
   * upstreamOf for the mirror (incoming edges) and its note on cycles. This
   * is a deliberately separate relationship from ancestorsOf()/descendant: a
   * node's containment ancestors and its edge-downstream set can differ
   * arbitrarily, and unlike containment, the edge graph is not required to
   * be acyclic (docs/domain-shape.md §2, §7 — only containment cycles are a
   * validation error). Cycle-safe regardless. excludeIds lets a caller
   * (e.g. linkLockedCompanions) prune the walk without a second pass.
   */
  static downstreamOf(doc, id, excludeIds) {
    const exclude = excludeIds || new Set();
    const seen = new Set([id]);
    const out = [];
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      frontier.forEach((cur) => {
        this.activeEdgesFrom(doc, cur).forEach((e) => {
          const other = e.to;
          if (!other || seen.has(other) || exclude.has(other)) return;
          seen.add(other);
          out.push(other);
          next.push(other);
        });
      });
      frontier = next;
    }
    return out;
  }

  /** Is `other` downstream of id (reachable by following outgoing edges)? */
  static isDownstreamOf(doc, id, other) {
    return this.downstreamOf(doc, id).includes(other);
  }

  /**
   * The mirror of downstreamOf: every id that can reach id by following
   * outgoing edges — i.e. id is reachable from them. Walks incoming edges
   * transitively instead of outgoing ones; same cycle-safety, same
   * excludeIds behaviour.
   *
   * Upstream and downstream are not mutually exclusive: when id sits on an
   * edge cycle, some node can be both upstream and downstream of it at
   * once (docs/domain-shape.md §2 permits edge cycles — only containment
   * cycles are a validation error, §7). That's allowed to stand rather than
   * resolved here; a caller that cares can test both directions itself.
   */
  static upstreamOf(doc, id, excludeIds) {
    const exclude = excludeIds || new Set();
    const seen = new Set([id]);
    const out = [];
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      frontier.forEach((cur) => {
        this.activeEdgesTo(doc, cur).forEach((e) => {
          const other = e.from;
          if (!other || seen.has(other) || exclude.has(other)) return;
          seen.add(other);
          out.push(other);
          next.push(other);
        });
      });
      frontier = next;
    }
    return out;
  }

  /** Is `other` upstream of id (can reach id by following outgoing edges)? */
  static isUpstreamOf(doc, id, other) {
    return this.upstreamOf(doc, id).includes(other);
  }

  /**
   * The nodes a lockLinked move starting at id should carry along: id's
   * downstream set (see downstreamOf), filtered down to what a drag can
   * actually reposition. Direction matters (a node drags what it points at,
   * never what points at it, same as containment), and the lock only needs
   * to be set on id itself — it is not required on the nodes in between for
   * the chain to keep propagating.
   *
   * Three exclusions on top of the raw downstream walk.
   *
   * A downstream node is excluded if it has any "external input" — an
   * upstream neighbour (something with an edge straight into it) that is
   * itself neither id nor part of id's own downstream set. Such a node is
   * fed by something outside the chain being dragged, so it isn't purely
   * id's own — e.g. Start -> a1 -> branch -> pathA -> a2 -> a1: dragging
   * branch (lockLinked) reaches a1 via branch -> pathA -> a2 -> a1, but a1
   * also has Start feeding it directly, and Start is not reachable
   * downstream from branch at all, so a1 is excluded. Contrast a node whose
   * only upstream neighbour(s) are themselves downstream of id (e.g. a cycle
   * that closes back through id's own chain without introducing an outside
   * feed) — that node has no external input and stays. This needs the full
   * downstream set computed first, so it's checked as a filter afterward
   * rather than inline during the walk.
   *
   * A node is excluded whenever it is a containment ancestor of whichever
   * downstream node pointed at it — not just an ancestor of id itself (edges
   * cross containment freely — §2 — so the chain can reach back out to any
   * ancestor of any node in it, not only id's own), because moving that
   * ancestor would fight the containment math that already repositions its
   * descendant when it moves. The walk does not continue past an excluded
   * node either.
   *
   * And a node nested inside a container that has opted out of lockChildren
   * is excluded too, for the same reason the walk doesn't continue past it —
   * such a node's position is computed by auto-layout on every render, so
   * there is nothing to carry it by.
   *
   * Consumer-agnostic: this returns ids only. What a caller does with them —
   * whether any are currently on screen, where they currently sit — is
   * presentation state the library does not have.
   */
  static linkLockedCompanions(doc, id) {
    const seen = new Set([id]);
    const raw = [];
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      frontier.forEach((cur) => {
        const curAncestors = this.ancestorsOf(doc, cur);
        this.activeEdgesFrom(doc, cur).forEach((e) => {
          const other = e.to;
          if (!other || seen.has(other) || curAncestors.has(other)) return;
          seen.add(other);
          const parent = this.parentOf(doc, other);
          const positioned = !parent || this.isChildrenLocked(doc, parent);
          if (positioned) { raw.push(other); next.push(other); }
        });
      });
      frontier = next;
    }
    const downstream = new Set(raw);
    return raw.filter((otherId) => {
      const upstream = this.activeEdgesTo(doc, otherId).map((e) => e.from);
      return upstream.every((u) => u === id || downstream.has(u));
    });
  }
}
