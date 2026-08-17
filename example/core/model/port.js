/* core/model/port.js — the Port value object and its factory.
 *
 * A port is a connection socket on a node: a direction, an optional label,
 * and a capacity (null means unbounded). Ports have no identity of their own
 * beyond their id within one node.
 */

export const PortFactory = {
  /** Normalise a declared port spec into the resolved shape consumers see. */
  resolve(id, spec) {
    return {
      id,
      direction: spec.direction,
      label: spec.label || '',
      capacity: spec.capacity === undefined ? null : spec.capacity
    };
  }
};
