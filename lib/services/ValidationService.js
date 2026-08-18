/* lib/services/ValidationService.js — ValidationService.
 *
 * Checks a document against the structural invariants a document cannot
 * violate by construction alone (docs/domain-shape.md §7): id/key agreement,
 * containment acyclicity, edge endpoint existence, metadata reference
 * resolution — plus registry containment rules and any type-supplied lints.
 * Errors block a commit; warnings are advisory.
 *
 * The Graph and MutationContext imports are circular (Graph.js imports this
 * module); both are used only at call time, which ES module live bindings
 * resolve safely.
 */
import { Graph } from '../Graph.js';
import { MutationContext } from './MutationContext.js';

export function validateDoc(doc, registry) {
  const issues = [];
  const err = (m, id) => issues.push({ level: 'error', message: m, nodeId: id });
  const warn = (m, id) => issues.push({ level: 'warn', message: m, nodeId: id });
  const g = new Graph(doc, registry);

  // records key their own collection
  Object.keys(doc.nodes).forEach((k) => {
    if (doc.nodes[k].id !== k) err('node key ' + k + ' does not match its id');
  });
  Object.keys(doc.edges).forEach((k) => {
    if (doc.edges[k].id !== k) err('edge key ' + k + ' does not match its id');
  });
  Object.keys(doc.metadata).forEach((k) => {
    if (doc.metadata[k].id !== k) err('metadata key ' + k + ' does not match its id');
  });

  // parent chains are acyclic and terminate at null
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

  // every edge endpoint refers to an existing node — edges may freely cross
  // containment boundaries, so there is nothing else to check here
  Object.keys(doc.edges).forEach((k) => {
    const e = doc.edges[k];
    if (!doc.nodes[e.from]) err('edge ' + k + '.from points at a missing node');
    if (!doc.nodes[e.to]) err('edge ' + k + '.to points at a missing node');
  });

  // a meta reference, when present, resolves to an existing metadata record
  g.allNodes().forEach((n) => {
    if (n.meta && !doc.metadata[n.meta]) err('node ' + n.id + '.meta points at a missing record', n.id);
  });
  g.allEdges().forEach((e) => {
    if (e.meta && !doc.metadata[e.meta]) err('edge ' + e.id + '.meta points at a missing record', e.id);
  });

  // containment rules from the registry, where both ends are typed
  g.allNodes().forEach((n) => {
    if (!n.parent) return;
    const parent = doc.nodes[n.parent];
    if (!parent) return;
    const parentType = g.typeOf(parent.id);
    if (!parentType) return;
    const d = registry.describe(parentType);
    if (!d) return;
    if (d.allowsChildren === false) err(parentType + ' (' + parent.id + ') cannot contain children', n.id);
    const childType = g.typeOf(n.id);
    if (d.allowedChildTypes && childType && d.allowedChildTypes.indexOf(childType) === -1) {
      err(childType + ' is not permitted inside ' + parentType, n.id);
    }
  });

  // type-supplied lints
  g.allNodes().forEach((n) => {
    const type = g.typeOf(n.id);
    if (!type) return;
    const T = registry.get(type);
    if (!T || !T.prototype.validate) return;
    const inst = Object.create(T.prototype);
    inst.id = n.id; inst.data = n.data || {}; inst.ext = n.ext; inst.type = type;
    inst.meta = g.metaOf('node', n.id);
    const ctx = new MutationContext(g, doc);
    (inst.validate(ctx) || []).forEach((i) => issues.push(i));
  });

  // a declared but unregistered type is reported, never fatal — an untyped
  // node (no type declared at all) is not an error, it is legal (§4)
  g.allNodes().forEach((n) => {
    const type = g.typeOf(n.id);
    if (type && !registry.has(type)) warn('unknown type "' + type + '" — rendered with a fallback', n.id);
  });

  return issues;
}

export class ValidationService {
  static validateDoc(doc, registry) { return validateDoc(doc, registry); }
}
