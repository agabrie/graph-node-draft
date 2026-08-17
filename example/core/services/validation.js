/* core/services/validation.js — ValidationService.
 *
 * Checks a document against the cross-record invariants the schema cannot
 * express: id/key agreement, containment acyclicity, endpoint and port
 * resolution, capacity, sibling key uniqueness, containment rules, plus any
 * type-supplied lints. Errors block a commit; warnings are advisory.
 *
 * The Graph and MutationContext imports are circular (graph.js imports this
 * module); both are used only at call time, which ES module live bindings
 * resolve safely.
 */
import { Graph } from '../graph.js';
import { MutationContext } from './mutation.js';

export function validateDoc(doc, registry) {
  const issues = [];
  const err = (m, id) => issues.push({ level: 'error', message: m, nodeId: id });
  const warn = (m, id) => issues.push({ level: 'warn', message: m, nodeId: id });
  const g = new Graph(doc, registry);

  Object.keys(doc.nodes).forEach((k) => {
    if (doc.nodes[k].id !== k) err('node key ' + k + ' does not match its id');
  });
  Object.keys(doc.edges).forEach((k) => {
    if (doc.edges[k].id !== k) err('edge key ' + k + ' does not match its id');
  });

  Object.keys(doc.nodes).forEach((k) => {
    const seen = {};
    let cur = doc.nodes[k];
    while (cur && cur.parent) {
      if (seen[cur.id]) { err('containment cycle through ' + k, k); break; }
      seen[cur.id] = 1;
      cur = doc.nodes[cur.parent];
      if (!cur) { err('node ' + k + ' has a missing parent', k); break; }
    }
  });

  Object.keys(doc.edges).forEach((k) => {
    const e = doc.edges[k];
    ['from', 'to'].forEach((side) => {
      const ep = e[side];
      if (!doc.nodes[ep.node]) { err('edge ' + k + '.' + side + ' points at a missing node'); return; }
      const p = g.port(ep.node, ep.port);
      if (!p) { err('edge ' + k + '.' + side + ' uses unknown port "' + ep.port + '"'); return; }
      const want = side === 'from' ? 'out' : 'in';
      if (p.direction !== want && p.direction !== 'inout') {
        err('edge ' + k + '.' + side + ' uses a ' + p.direction + '-port where ' + want + ' was needed');
      }
    });
  });

  // capacity: maximum is an error, minimum is only ever a warning, because a
  // freshly created node legitimately has nothing connected yet
  g.allNodes().forEach((n) => {
    if (n.state !== 'active') return;
    g.portsOf(n.id).forEach((p) => {
      const used = g.portUsage(n.id, p.id, p.direction === 'in' ? 'in' : 'out');
      if (p.capacity !== null && used > p.capacity) {
        err((n.label || n.id) + '.' + p.id + ' has ' + used + ' connections, capacity ' + p.capacity, n.id);
      }
    });
  });

  // sibling key uniqueness
  const byParent = {};
  g.allNodes().forEach((n) => {
    if (!n.key) return;
    const p = n.parent || '~root';
    byParent[p] = byParent[p] || {};
    if (byParent[p][n.key]) warn('duplicate key "' + n.key + '" among siblings', n.id);
    byParent[p][n.key] = 1;
  });

  Object.keys(doc.view.nodes || {}).forEach((k) => {
    if (!doc.nodes[k]) warn('view entry for a node that no longer exists: ' + k);
  });

  // containment rules from the registry
  g.allNodes().forEach((n) => {
    if (!n.parent) return;
    const parent = doc.nodes[n.parent];
    if (!parent) return;
    const d = registry.describe(parent.type);
    if (!d) return;
    if (d.allowsChildren === false) err((parent.label || parent.id) + ' cannot contain children', n.id);
    if (d.allowedChildTypes && d.allowedChildTypes.indexOf(n.type) === -1) {
      err(n.type + ' is not permitted inside ' + parent.type, n.id);
    }
  });

  // type-supplied lints
  g.allNodes().forEach((n) => {
    const T = registry.get(n.type);
    if (!T || !T.prototype.validate) return;
    const inst = Object.create(T.prototype);
    inst.id = n.id; inst.data = n.data || {}; inst.ext = n.ext; inst.label = n.label;
    const ctx = new MutationContext(g, doc);
    (inst.validate(ctx) || []).forEach((i) => issues.push(i));
  });

  // unknown types are reported, never fatal
  g.allNodes().forEach((n) => {
    if (!registry.has(n.type)) warn('unknown type "' + n.type + '" — rendered with a fallback', n.id);
  });

  return issues;
}

export const ValidationService = { validateDoc };
