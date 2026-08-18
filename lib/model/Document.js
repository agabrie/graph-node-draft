/* lib/model/Document.js — the GraphDocument aggregate root's persisted shape.
 *
 * nodes/edges/metadata as three id-keyed collections, plus document-level
 * `meta` (title, anything advisory — distinct from the per-record `metadata`
 * collection) and an `ext` plugin surface. `nodes`/`edges` values are real
 * Node/Edge instances (see model/Node.js) for the life of the document —
 * createDocument() always starts empty; fromJSON() is the only path that
 * brings a previously-persisted document back in, and it is what rebuilds
 * those instances, since JSON has no notion of a prototype on its own.
 */
import { newId } from './ids.js';
import { Node } from './Node.js';
import { Edge } from './Edge.js';

export function createDocument(opts = {}) {
  return {
    id: newId(),
    version: '1.0.0',
    nodes: {},
    edges: {},
    metadata: {},
    meta: opts.meta || {},
    ext: {}
  };
}

/** Rebuild a document from plain data (e.g. JSON.parse'd out of storage),
 *  reconstructing every node/edge as a real instance. Metadata records stay
 *  plain objects — they have no factory/class of their own (Metadata.js).
 *  Each node/edge's `_meta` cache (model/Node.js) is resolved here too,
 *  since a freshly parsed record has no way to have set it on its own. */
export function documentFromJSON(raw) {
  const metadata = Object.assign({}, raw.metadata);
  const nodes = {};
  Object.keys(raw.nodes || {}).forEach((k) => {
    const n = Node.fromJSON(raw.nodes[k]);
    n._meta = n.meta ? (metadata[n.meta] || null) : null;
    nodes[k] = n;
  });
  const edges = {};
  Object.keys(raw.edges || {}).forEach((k) => {
    const e = Edge.fromJSON(raw.edges[k]);
    e._meta = e.meta ? (metadata[e.meta] || null) : null;
    edges[k] = e;
  });
  return {
    id: raw.id,
    version: raw.version,
    nodes,
    edges,
    metadata,
    meta: Object.assign({}, raw.meta),
    ext: Object.assign({}, raw.ext)
  };
}

export class DocumentFactory {
  static create(opts) { return createDocument(opts); }
  static fromJSON(raw) { return documentFromJSON(raw); }
}
