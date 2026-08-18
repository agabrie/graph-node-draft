/* lib/model/Node.js — the Node entity and its factory.
 *
 * Structure only (see docs/domain-shape.md §1-2): identity, containment,
 * sibling order, lifecycle state, a metadata reference, and the opaque
 * payload. Type, label and coordinates are not here — they live in the
 * metadata record `meta` points at.
 *
 * `doc.nodes[id]` is a real Node instance for the life of the document —
 * TopologyService, MutationContext and Graph all read/write it directly,
 * with no wrap/unwrap step. It only ever becomes plain data at an explicit
 * boundary: Graph.toJSON() for export, and Node.fromJSON() on the way back
 * in from storage (JSON has no notion of a prototype, so loading a
 * persisted document has to rebuild instances explicitly — see Document.js).
 *
 * `_meta` is a cache of the resolved metadata record `meta` (an id) points
 * at — MutationContext keeps it in sync on every write to that record
 * (setMeta/linkMeta), including when the record is shared by more than one
 * node (docs/domain-shape.md §1, §10.1). It's what lets isCollapsed() etc.
 * answer without the caller threading the whole document through; nothing
 * outside MutationContext/Document should write to it directly.
 */

export class Node {
  constructor(fields) {
    this.id = fields.id;
    this.parent = fields.parent ?? null;
    this.rank = fields.rank;
    this.state = fields.state || 'active';
    this.meta = fields.meta ?? null;
    this.data = fields.data || {};
    this.ext = fields.ext;
    this._meta = fields._meta ?? null;
  }

  /** Rebuild a Node instance from a plain object, e.g. loaded from storage. */
  static fromJSON(raw) { return new Node(raw); }

  isCollapsed() { return !!(this._meta && this._meta.collapsed); }

  /** True unless explicitly set to false (docs/domain-shape.md §2, §10.1) —
   *  a container's children default to fixed positions relative to it. */
  isChildrenLocked() { return !this._meta || this._meta.lockChildren !== false; }

  /** Opt-in (default off, unlike lockChildren) — see
   *  TopologyService.linkLockedCompanions for what this drives. */
  isLinkLocked() { return !!(this._meta && this._meta.lockLinked); }
}

export class NodeFactory {
  /**
   * Build a node instance. `deps` carries values the caller resolves against
   * the document (fresh id, sibling rank, a metadata id if one was created),
   * so the factory stays pure and can still refuse malformed input.
   */
  static create(spec, deps) {
    if (!deps || !deps.id) {
      throw new Error('NodeFactory.create: an id is required');
    }
    if (spec.parent !== undefined && spec.parent !== null && typeof spec.parent !== 'string') {
      throw new Error('NodeFactory.create: parent must be a node id or null');
    }
    return new Node({
      id: deps.id,
      parent: spec.parent ?? null,
      rank: spec.rank || deps.rank,
      state: 'active',
      meta: deps.metaId ?? null,
      data: spec.data || {},
      ext: spec.ext || undefined
    });
  }
}
