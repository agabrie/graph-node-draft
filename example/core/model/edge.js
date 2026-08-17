/* core/model/edge.js — the Edge entity and its factory.
 *
 * An edge connects two endpoints ({node, port}) and shares the node's
 * lifecycle fields: containment (parent), sibling order (rank), state.
 * Endpoints reference node ids, never keys.
 */

export const EdgeFactory = {
  /**
   * Build an edge record. `deps` carries the values the caller resolves
   * against the document (fresh id, containing parent, sibling rank).
   */
  create(spec, deps) {
    return {
      id: deps.id,
      type: spec.type || 'core.link',
      from: { node: spec.from.node, port: spec.from.port },
      to: { node: spec.to.node, port: spec.to.port },
      parent: deps.parent || null,
      rank: spec.rank || deps.rank,
      label: spec.label || '',
      state: 'active',
      style: spec.style || { line: 'solid', arrowEnd: 'arrow' },
      data: spec.data || {}
    };
  }
};
