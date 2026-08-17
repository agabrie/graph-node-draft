/* core/model/base-node-type.js — the extension point for node behaviour.
 *
 * Subclass this in your project. The library only calls what it declares:
 * describe() plus the optional hooks (onCreate, onEdgeAdded, onEdgeRemoved,
 * validate) dispatched by the mutation service.
 */

export function BaseNodeType() {}
BaseNodeType.type = 'core.node';
BaseNodeType.label = 'Node';
BaseNodeType.describe = function () {
  return {
    allowsChildren: true,
    ports: {
      'in': { direction: 'in', capacity: null },
      out: { direction: 'out', capacity: null }
    }
  };
};
