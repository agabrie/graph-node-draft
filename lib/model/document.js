/* lib/model/document.js — the GraphDocument aggregate root's persisted shape.
 *
 * Plain JSON: nodes, edges and metadata as three id-keyed collections, plus
 * document-level `meta` (title, anything advisory — distinct from the
 * per-record `metadata` collection) and an `ext` plugin surface.
 */
import { newId } from './ids.js';

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

export const DocumentFactory = { create: createDocument };
