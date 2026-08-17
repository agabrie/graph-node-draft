/* core/model/ids.js — identity value object.
 *
 * Opaque, immutable, never reused. ULID-shaped (Crockford base32) so ids sort
 * lexicographically by creation time, matching the schema's id pattern.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, no I L O U

  function newId() {
    var t = Date.now(), time = '';
    for (var i = 9; i >= 0; i--) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
    var rand = '';
    for (var j = 0; j < 16; j++) rand += B32[Math.floor(Math.random() * 32)];
    return time + rand; // 26 chars, matches the schema's id pattern
  }

  GC.newId = newId;
})(typeof window !== 'undefined' ? window : globalThis);
