#!/usr/bin/env node
// Validates every example document against the JSON Schema, then checks the
// cross-record invariants (INV-1 .. INV-11) that JSON Schema structurally cannot express.
//
//   npm i ajv ajv-formats
//   node validate.mjs

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));

const schema = read('./graph-document.schema.json');
const registry = read('./node-types.registry.json');
const examples = read('./examples.json');

/* ---------- registry helpers ---------- */

function resolveType(name, seen = new Set()) {
  const d = registry.nodeTypes[name];
  if (!d) return null;
  if (seen.has(name)) throw new Error(`circular extends at ${name}`);
  seen.add(name);
  const base = d.extends ? resolveType(d.extends, seen) : null;
  return {
    ...(base ?? {}),
    ...d,
    ports: { ...(base?.ports ?? {}), ...(d.ports ?? {}) },
  };
}

const portsOf = (node) => {
  const t = resolveType(node.type);
  return { ...(t?.ports ?? {}), ...(node.ports ?? {}) };
};

const rulesetFor = (kind) => registry.rulesets[kind] ?? registry.rulesets.generic;

/* ---------- invariant checks ---------- */

function checkInvariants(doc) {
  const errs = [];
  const fail = (inv, msg) => errs.push(`${inv}: ${msg}`);
  const { nodes, edges } = doc;
  const rules = new Set(rulesetFor(doc.kind).invariants);

  // INV-1 map key equals record id
  for (const [k, n] of Object.entries(nodes)) if (k !== n.id) fail('INV-1', `node key ${k} != id ${n.id}`);
  for (const [k, e] of Object.entries(edges)) if (k !== e.id) fail('INV-1', `edge key ${k} != id ${e.id}`);

  // INV-2 acyclic parent chains terminating at null
  for (const n of Object.values(nodes)) {
    const path = new Set();
    let cur = n;
    while (cur?.parent != null) {
      if (path.has(cur.id)) { fail('INV-2', `parent cycle through ${n.id}`); break; }
      path.add(cur.id);
      const next = nodes[cur.parent];
      if (!next) { fail('INV-2', `${cur.id}.parent ${cur.parent} does not exist`); break; }
      cur = next;
    }
  }

  // INV-3 endpoints exist / INV-4 ports exist and directions are compatible
  for (const e of Object.values(edges)) {
    for (const [side, ep] of [['from', e.from], ['to', e.to]]) {
      const n = nodes[ep.node];
      if (!n) { fail('INV-3', `edge ${e.id}.${side} -> missing node ${ep.node}`); continue; }
      const p = portsOf(n)[ep.port];
      if (!p) { fail('INV-4', `edge ${e.id}.${side} -> node ${n.key ?? n.id} has no port "${ep.port}"`); continue; }
      const want = side === 'from' ? 'out' : 'in';
      if (p.direction !== want && p.direction !== 'inout') {
        fail('INV-4', `edge ${e.id}.${side} uses ${want}-incompatible port "${ep.port}" (${p.direction})`);
      }
    }
  }

  // INV-5 level-local edges (kind rule)
  if (rules.has('INV-5')) {
    for (const e of Object.values(edges)) {
      const a = nodes[e.from.node], b = nodes[e.to.node];
      if (a && b && (a.parent ?? null) !== (b.parent ?? null)) {
        fail('INV-5', `edge ${e.id} crosses a containment boundary (${a.key} -> ${b.key}); insert a core.portal`);
      }
    }
  }

  // INV-6 key unique among siblings
  const byParent = new Map();
  for (const n of Object.values(nodes)) {
    const g = byParent.get(n.parent ?? null) ?? new Map();
    if (n.key != null) {
      if (g.has(n.key)) fail('INV-6', `duplicate key "${n.key}" among siblings of parent ${n.parent}`);
      g.set(n.key, n.id);
    }
    byParent.set(n.parent ?? null, g);
  }

  // INV-8 port arity (active edges only; detached edges do not occupy a port)
  const used = new Map();
  for (const e of Object.values(edges)) {
    if (e.state !== 'active') continue;
    for (const ep of [e.from, e.to]) {
      const k = `${ep.node}::${ep.port}`;
      used.set(k, (used.get(k) ?? 0) + 1);
    }
  }
  for (const n of Object.values(nodes)) {
    for (const [pid, p] of Object.entries(portsOf(n))) {
      if (p.group) continue; // template port, instantiated as pid.0, pid.1, …
      const count = used.get(`${n.id}::${pid}`) ?? 0;
      const min = p.arity?.min ?? 0;
      const max = p.arity?.max ?? null;
      if (n.state === 'active' && count < min) fail('INV-8', `${n.key ?? n.id}.${pid} has ${count} connections, min ${min}`);
      if (max != null && count > max) fail('INV-8', `${n.key ?? n.id}.${pid} has ${count} connections, max ${max}`);
    }
  }

  // INV-7 purge precondition, reported informationally
  const degree = new Map();
  for (const e of Object.values(edges)) {
    for (const ep of [e.from, e.to]) degree.set(ep.node, (degree.get(ep.node) ?? 0) + 1);
  }

  // INV-9 distinct message ranks (kind rule)
  if (rules.has('INV-9')) {
    const seen = new Map();
    for (const e of Object.values(edges)) {
      if (e.type !== 'seq.message') continue;
      if (e.rank == null) { fail('INV-9', `seq.message ${e.id} has no rank`); continue; }
      if (seen.has(e.rank)) fail('INV-9', `duplicate message rank "${e.rank}"`);
      seen.set(e.rank, e.id);
    }
  }

  // INV-10 ER cardinality on both ends (kind rule)
  if (rules.has('INV-10')) {
    for (const e of Object.values(edges)) {
      if (e.type !== 'er.relationship') continue;
      if (!e.data?.from?.cardinality || !e.data?.to?.cardinality) {
        fail('INV-10', `er.relationship ${e.id} is missing cardinality on one or both ends`);
      }
    }
  }

  // INV-11 view keys resolve
  for (const k of Object.keys(doc.view?.nodes ?? {})) if (!nodes[k]) fail('INV-11', `view.nodes key ${k} has no node`);
  for (const k of Object.keys(doc.view?.edges ?? {})) if (!edges[k]) fail('INV-11', `view.edges key ${k} has no edge`);

  // registry sanity: every referenced type resolves, and allowedChildTypes hold
  for (const n of Object.values(nodes)) {
    const t = resolveType(n.type);
    if (!t) { fail('REGISTRY', `unknown node type "${n.type}" on ${n.id}`); continue; }
    if (n.parent) {
      const pt = resolveType(nodes[n.parent]?.type ?? '');
      if (pt?.allowsChildren === false) fail('REGISTRY', `${pt.label} does not allow children (${n.key})`);
      if (pt?.allowedChildTypes && !pt.allowedChildTypes.includes(n.type)) {
        fail('REGISTRY', `${n.type} not permitted inside ${nodes[n.parent].type}`);
      }
    }
  }

  const stats = {
    nodes: Object.keys(nodes).length,
    edges: Object.keys(edges).length,
    detachedNodes: Object.values(nodes).filter((n) => n.state === 'detached').length,
    // INV-7: degree 0 AND no children of EITHER collection. A seq.block's children
    // are edges, so a node-only check would wrongly report it as purgeable.
    purgeable: Object.values(nodes).filter((n) => (degree.get(n.id) ?? 0) === 0
      && !Object.values(nodes).some((c) => c.parent === n.id)
      && !Object.values(edges).some((c) => c.parent === n.id)).length,
  };
  return { errs, stats };
}

/* ---------- run ---------- */

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

let validate;
try {
  validate = ajv.compile(schema);
  console.log('schema compiles under draft 2020-12 (strict mode)\n');
} catch (err) {
  console.error('SCHEMA FAILED TO COMPILE:\n' + err.message);
  process.exit(1);
}

let failures = 0;
for (const [name, entry] of Object.entries(examples)) {
  if (name.startsWith('$') || !entry?.document) continue;
  const ok = validate(entry.document);
  const { errs, stats } = checkInvariants(entry.document);

  console.log(`── ${name} ${'─'.repeat(Math.max(0, 34 - name.length))}`);
  console.log(`   schema     ${ok ? 'pass' : 'FAIL'}`);
  if (!ok) for (const e of validate.errors) console.log(`     ${e.instancePath || '/'} ${e.message}`);
  console.log(`   invariants ${errs.length === 0 ? 'pass' : 'FAIL'}`);
  for (const e of errs) console.log(`     ${e}`);
  console.log(`   stats      ${stats.nodes} nodes, ${stats.edges} edges, `
    + `${stats.detachedNodes} detached, ${stats.purgeable} purgeable\n`);

  if (!ok || errs.length) failures++;
}

console.log(failures === 0
  ? 'all examples valid'
  : `${failures} example(s) failed`);
process.exit(failures === 0 ? 0 : 1);
