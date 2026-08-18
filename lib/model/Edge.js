/* lib/model/Edge.js — the Edge entity and its factory.
 *
 * Connects node to node directly — no ports. `from`/`to` are node ids.
 * `parent` is an independent grouping (e.g. a sequence block owning its
 * messages), never derived from the endpoints: edges may freely cross
 * containment boundaries (docs/domain-shape.md §2).
 *
 * `doc.edges[id]` is a real Edge instance for the life of the document, on
 * the same terms as Node — see model/Node.js's docstring, including how
 * `_meta` is kept in sync.
 */

export class Edge {
  constructor(fields) {
    this.id = fields.id;
    this.parent = fields.parent ?? null;
    this.rank = fields.rank;
    this.state = fields.state || 'active';
    this.from = fields.from;
    this.to = fields.to;
    this.meta = fields.meta ?? null;
    this.data = fields.data || {};
    this.ext = fields.ext;
    this._meta = fields._meta ?? null;
  }

  /** Rebuild an Edge instance from a plain object, e.g. loaded from storage. */
  static fromJSON(raw) { return new Edge(raw); }
}

export class EdgeFactory {
  static create(spec, deps) {
    if (!deps || !deps.id) {
      throw new Error('EdgeFactory.create: an id is required');
    }
    if (!spec.from || typeof spec.from !== 'string') {
      throw new Error('EdgeFactory.create: "from" must be a node id');
    }
    if (!spec.to || typeof spec.to !== 'string') {
      throw new Error('EdgeFactory.create: "to" must be a node id');
    }
    return new Edge({
      id: deps.id,
      parent: spec.parent !== undefined ? spec.parent : (deps.parent ?? null),
      rank: spec.rank || deps.rank,
      state: 'active',
      from: spec.from,
      to: spec.to,
      meta: deps.metaId ?? null,
      data: spec.data || {},
      ext: spec.ext || undefined
    });
  }
}
