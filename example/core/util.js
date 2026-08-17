/* core/util.js — internal helpers shared across the core modules. */

/** Internal deep-copy helper. Documents are plain JSON, so this is enough. */
export const clone = (v) => JSON.parse(JSON.stringify(v));
