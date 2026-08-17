# Graph node editor — data model, spec and runnable example

Start with **`example/example.html`**. Open it in a browser — no server, no build step,
no dependencies. Everything else in here explains or specifies what that page does.

## Layout

```
example/          runnable demo, and the only working code
  example.html      the page
  example.js        demo app: presets, palette, inspector, buttons
  renderer.js       one possible renderer (SVG). Replaceable.
  node-types.js     PROJECT code — all node types, including the branch split
  mermaid-io.js     the only file that knows Mermaid exists
  graph-core.js     LIBRARY — document, ports, mutations, hooks, validation
  samples/*.mmd     one Mermaid sample per dialect
  selftest.mjs      92 checks, no dependencies:  node selftest.mjs
  domtest.mjs       70 checks driving the real page:  npm i jsdom && node domtest.mjs
  README.md         what to click, and what to watch

docs/
  graph-model-design.md    the spec: data shape, decisions, lifecycle, invariants
  architecture-onion.md    layering, ports and adapters, dependency enforcement

spec/
  graph-document.schema.json   JSON Schema 2020-12 for a document
  node-types.registry.json     type descriptors as plain data
  mermaid-import.map.json      import-adapter lookup tables
  examples.json                four worked documents
  examples.catalogue.json      a simple map, plus one node of every type
  validate.mjs                 schema + invariant checker (needs ajv)

reference/
  custom-node-branch-split.ts  the split as typed reference code
```

## The one idea

The library knows only this: nodes and edges live in id-keyed maps, any node may
contain children, edges connect ports, ports declare a capacity, and something
gets asked when a capacity is exceeded.

It does not know what a scene is, what branching means, how to draw a box, or
that Mermaid exists. Grep `graph-core.js` for `split`, `branch`, `render` or
`mermaid` — every hit is a comment saying it does not do that.

The branch split is the proof. It inserts itself when a port overflows, grows its
own outputs, and removes itself when it stops branching — entirely from
`node-types.js`, which is project code. Delete that file and the library still
runs; you just have no types to place.

## Verify it

```bash
cd example
node selftest.mjs                  # 92 checks, no install
npm i jsdom && node domtest.mjs    # 70 checks, boots the page and clicks everything

cd ../spec
npm i ajv ajv-formats && node validate.mjs
```

## Known gaps

- `docs/` and `spec/` still call port capacity **`arity`**, and still describe the
  branch split as a built-in type. The example uses the newer naming and the
  correct boundary. The example is right; the docs lag by one revision.
- No undo, redo or change attribution anywhere, by design. `Detach` is the
  reversible removal; `Purge` is gated behind having no edges and no children.
- Mermaid export is deliberately lossy — ports beyond in/out, `data` payloads and
  coordinates have no Mermaid syntax. The JSON is the source of truth.
- The Mermaid parser is line-based, not a real grammar. It covers the samples and
  logs a note for anything it skips.
