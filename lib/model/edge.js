/* lib/model/edge.js — the Edge entity and its factory.
 *
 * Connects node to node directly — no ports. `from`/`to` are node ids.
 * `parent` is an independent grouping (e.g. a sequence block owning its
 * messages), never derived from the endpoints: edges may freely cross
 * containment boundaries (docs/domain-shape.md §2).
 */

export const EdgeFactory = {
  create(spec, deps) {
    if (!deps || !deps.id) {
      throw new Error('EdgeFactory.create: an id is required');
    }
    if (!spec.from || typeof spec.from !== 'string') {
      throw new Error('EdgeFactory.create: "from" must be a node id');
    }
    if (!spec.to || typeof spec.to !== 'string') {
      throw new Error('EdgeFactory.create: "to" must be a node id');
    }
    return {
      id: deps.id,
      parent: spec.parent !== undefined ? spec.parent : (deps.parent ?? null),
      rank: spec.rank || deps.rank,
      state: 'active',
      from: spec.from,
      to: spec.to,
      meta: deps.metaId ?? null,
      data: spec.data || {},
      ext: spec.ext || undefined
    };
  }
};
