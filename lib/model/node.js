/* lib/model/node.js — the Node entity and its factory.
 *
 * Structure only (see docs/domain-shape.md §1-2): identity, containment,
 * sibling order, lifecycle state, a metadata reference, and the opaque
 * payload. Type, label and coordinates are not here — they live in the
 * metadata record `meta` points at.
 */

export const NodeFactory = {
  /**
   * Build a node record. `deps` carries values the caller resolves against
   * the document (fresh id, sibling rank, a metadata id if one was created),
   * so the factory stays pure and can still refuse malformed input.
   */
  create(spec, deps) {
    if (!deps || !deps.id) {
      throw new Error('NodeFactory.create: an id is required');
    }
    if (spec.parent !== undefined && spec.parent !== null && typeof spec.parent !== 'string') {
      throw new Error('NodeFactory.create: parent must be a node id or null');
    }
    return {
      id: deps.id,
      parent: spec.parent ?? null,
      rank: spec.rank || deps.rank,
      state: 'active',
      meta: deps.metaId ?? null,
      data: spec.data || {},
      ext: spec.ext || undefined
    };
  }
};
