/* core/model/port.js — the Port value object and its factory.
 *
 * A port is a connection socket on a node: a direction, an optional label,
 * and a capacity (null means unbounded). Ports have no identity of their own
 * beyond their id within one node.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  GC.PortFactory = {
    /** Normalise a declared port spec into the resolved shape consumers see. */
    resolve: function (id, spec) {
      return {
        id: id,
        direction: spec.direction,
        label: spec.label || '',
        capacity: spec.capacity === undefined ? null : spec.capacity
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
