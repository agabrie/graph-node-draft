/* core/model/node.js — the Node entity and its factory.
 *
 * A node record is plain JSON matching the schema: identity, type reference,
 * containment (parent), sibling order (rank), lifecycle state, optional
 * instance ports, opaque data, and the ext extension surface.
 */

export const NodeFactory = {
  /**
   * Build a node record. `deps` carries the values the caller resolves
   * against the document (fresh id, sibling rank, registry default label),
   * so the factory itself stays pure.
   */
  create(spec, deps) {
    return {
      id: deps.id,
      key: spec.key || null,
      type: spec.type,
      label: deps.label,
      parent: spec.parent || null,
      rank: spec.rank || deps.rank,
      state: 'active',
      ports: spec.ports || undefined,
      data: spec.data || {},
      ext: spec.ext || undefined
    };
  }
};
