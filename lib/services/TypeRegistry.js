/* lib/services/TypeRegistry.js — TypeRegistry.
 *
 * Resolves a node's type name to its registered class and descriptor.
 * Unknown types are tolerated, not fatal (docs/domain-shape.md §4): a
 * document must load in a runtime that has not registered its types, and an
 * untyped node — meta absent, or meta.type absent — is legal on its own.
 */

export class TypeRegistry {
  constructor() { this.types = {}; }

  register(...types) {
    for (const T of types) {
      if (!T || !T.type) throw new Error('type class needs a static `type`');
      this.types[T.type] = T;
    }
    return this;
  }

  get(name) { return this.types[name] || null; }
  has(name) { return !!this.types[name]; }

  describe(name) {
    const T = this.types[name];
    if (!T) return null;
    const d = T.describe ? T.describe() : {};
    return {
      allowsChildren: d.allowsChildren !== false,
      allowedChildTypes: d.allowedChildTypes || null,
      label: T.label || name
    };
  }

  /** Everything registered, as plain data — this is what a backend consumes. */
  toJSON() {
    const out = {};
    Object.keys(this.types).forEach((k) => { out[k] = this.describe(k); });
    return out;
  }

  list() { return Object.keys(this.types); }
}
