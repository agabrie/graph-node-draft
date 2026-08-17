/* core/util.js — internal helpers shared across the core files.
 *
 * Part of GraphCore. Plain classic script so example.html opens from the
 * filesystem with no server and no build step. Load order: first.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  /** Internal deep-copy helper. Documents are plain JSON, so this is enough. */
  GC._clone = function (v) { return JSON.parse(JSON.stringify(v)); };
})(typeof window !== 'undefined' ? window : globalThis);
