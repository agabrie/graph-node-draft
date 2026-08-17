/* core/services/registry.js — TypeRegistry.
 *
 * Resolves type names to registered classes and their descriptors. Unknown
 * types are tolerated, not fatal — a document must load in a runtime that has
 * not registered its types.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  function TypeRegistry() { this.types = {}; }

  TypeRegistry.prototype.register = function () {
    for (var i = 0; i < arguments.length; i++) {
      var T = arguments[i];
      if (!T || !T.type) throw new Error('type class needs a static `type`');
      this.types[T.type] = T;
    }
    return this;
  };

  TypeRegistry.prototype.get = function (name) { return this.types[name] || null; };
  TypeRegistry.prototype.has = function (name) { return !!this.types[name]; };

  TypeRegistry.prototype.describe = function (name) {
    var T = this.types[name];
    if (!T) return null;                    // unknown types are tolerated, not fatal
    var d = T.describe ? T.describe() : {};
    return {
      allowsChildren: d.allowsChildren !== false,
      ports: d.ports || {},
      onOverflow: d.onOverflow || null,
      allowedChildTypes: d.allowedChildTypes || null,
      label: T.label || name
    };
  };

  /** Everything registered, as plain data — this is what a backend consumes. */
  TypeRegistry.prototype.toJSON = function () {
    var out = {}, self = this;
    Object.keys(this.types).forEach(function (k) { out[k] = self.describe(k); });
    return out;
  };

  TypeRegistry.prototype.list = function () { return Object.keys(this.types); };

  GC.TypeRegistry = TypeRegistry;
})(typeof window !== 'undefined' ? window : globalThis);
