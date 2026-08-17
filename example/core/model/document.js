/* core/model/document.js — the GraphDocument aggregate root's persisted shape.
 *
 * A document is plain JSON matching spec/graph-document.schema.json: nodes and
 * edges keyed by id, a parallel view collection, and an ext extension surface.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  function createDocument(opts) {
    opts = opts || {};
    return {
      schemaVersion: '1.0.0',
      id: GC.newId(),
      kind: opts.kind || 'generic',
      title: opts.title || 'Untitled map',
      meta: { layout: { direction: 'LR' }, revision: 0 },
      nodes: {},
      edges: {},
      view: { nodes: {}, edges: {} },
      ext: {}
    };
  }

  GC.DocumentFactory = { create: createDocument };
  GC.createDocument = createDocument; // kept for API compatibility
})(typeof window !== 'undefined' ? window : globalThis);
