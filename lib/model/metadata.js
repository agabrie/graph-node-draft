/* lib/model/metadata.js — the metadata record and its factory.
 *
 * Metadata is a first-class record in its own right-hand collection, not a
 * block on the node/edge. A node or edge points at one by id via its `meta`
 * field; the same record may be shared by more than one owner, and swapping
 * an owner's presentation is a one-field change of that reference
 * (docs/domain-shape.md §1, §10.1).
 *
 * The library does not enforce a fixed shape here: node metadata carries
 * `type`/`label`/`x`/`y`/`collapsed`/`lockChildren`, edge metadata carries
 * `label`/`style`/`curvature`. Both are just fields on a record.
 */

export const MetadataFactory = {
  create(fields, deps) {
    if (!deps || !deps.id) {
      throw new Error('MetadataFactory.create: an id is required');
    }
    if (fields !== undefined && fields !== null &&
      (typeof fields !== 'object' || Array.isArray(fields))) {
      throw new Error('MetadataFactory.create: fields must be a plain object');
    }
    return Object.assign({}, fields, { id: deps.id });
  }
};
