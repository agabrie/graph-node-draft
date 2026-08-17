/* core/model/document.js — the GraphDocument aggregate root's persisted shape.
 *
 * A document is plain JSON matching spec/graph-document.schema.json: nodes and
 * edges keyed by id, a parallel view collection, and an ext extension surface.
 */
import { newId } from './ids.js';

export function createDocument(opts = {}) {
  return {
    schemaVersion: '1.0.0',
    id: newId(),
    kind: opts.kind || 'generic',
    title: opts.title || 'Untitled map',
    meta: { layout: { direction: 'LR' }, revision: 0 },
    nodes: {},
    edges: {},
    view: { nodes: {}, edges: {} },
    ext: {}
  };
}

export const DocumentFactory = { create: createDocument };
