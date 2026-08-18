/* lib/model/base-node-type.js — the extension point for node behaviour.
 *
 * Subclass this in a consuming project. The library calls only what a type
 * declares: describe() for containment rules, plus the optional hooks
 * (onCreate, onEdgeAdded, onEdgeRemoved, validate) dispatched during a
 * mutation. All domain behaviour — branch-splits, auto-attached children,
 * anything — is consumer code built from these; the library itself has none.
 */

export function BaseNodeType() {}
BaseNodeType.type = 'core.node';
BaseNodeType.label = 'Node';
BaseNodeType.describe = function () {
  return {
    allowsChildren: true,
    allowedChildTypes: null,
    dataSchema: null
  };
};
