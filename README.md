# graph-node-draft — a data-agnostic node-graph library

A library for entities, edges, and a type-extension system for building node
graphs — branching stories, flowcharts, whatever a consumer needs — without
the library knowing any of that domain vocabulary itself. No rendering, no
built-in node types. `demo/` is one example consumer, not part of the library.

The full shape — what a node and edge actually are, what's structural versus
metadata, why there are no ports, how the type-hook extension system works —
is written up in **[`docs/domain-shape.md`](docs/domain-shape.md)**. Start
there for the *why*; this file is the *where*.

## Try it

```bash
npm start
```

Opens **http://localhost:8080**. No build step, no dependencies — the whole
thing is plain ES modules, served over HTTP only because browsers don't load
modules from `file://` (`server.mjs`, ~40 lines, no npm packages).

## Verify it

```bash
npm test
```

Runs [`test/selftest.mjs`](test/selftest.mjs) — headless checks of `lib/`
against the shape doc: factories rejecting malformed input, atomic commits,
metadata sharing, containment vs. links, and the consumer-owned branch-split
example (proving the library needs no concept of branching to support one).

## Layout

```
lib/                     the library — the only thing that matters if
                         you're consuming this, not the demo
  model/                 one file per entity, each with its own factory
    node.js  edge.js  metadata.js  document.js  ids.js  base-node-type.js
  services/               one file per domain service
    topology.js            every read/query — lookups, containment,
                           metadata resolution, visibility
    mutation.js             the staged MutationContext: hook dispatch,
                           deferred splice/remove, all writes
    validation.js           the handful of structural invariants
                           (docs/domain-shape.md §7)
    ops.js                  the public editing verbs: addNode, connect,
                           reparent, detach/attach/disconnect/purge, ...
    ranking.js              fractional sibling order
    registry.js             TypeRegistry — resolves a type name to its
                           registered class and descriptor
  graph.js                the Graph aggregate: a thin facade over the
                         services above, plus the atomic mutate()/apply()
                         commit gate
  index.js                the public entry point

demo/                     a reference consumer, not the library
  index.html                the page
  app.js                    presets, palette, inspector, wiring
  node-types.js             project code — the registered node types,
                           including the branch-split and scene-with-
                           auto-attached-label-block examples
  renderer.js               one possible renderer (SVG). Pixel layout,
                           drag math, and "what's currently on screen"
                           all live here; anything that's just a graph or
                           metadata fact (containment, lock states, which
                           ancestor is visible) is a library call instead

test/
  selftest.mjs              headless checks of lib/, no dependencies

docs/
  domain-shape.md           the current spec — entities, metadata, the
                           type-hook system, invariants, settled decisions

server.mjs                 no-dependency static server for the demo
```

## The core idea

The library knows: nodes and edges live in id-keyed maps, any node may
contain children, edges connect node to node directly (no ports), and a
node's metadata (type, label, position, lock flags) lives in its own
referenced record rather than on the node itself.

It does not know what a "scene" or a "branch" is, how to draw anything, or
that Mermaid or any other format exists. All of that is `demo/node-types.js`
— project code, deletable without breaking the library. The branch-split
example is the proof: it inserts itself when a node gets a second outgoing
edge and removes itself when it stops branching, entirely from its own
`onEdgeAdded`/`onEdgeRemoved` hooks. The library has no concept of capacity,
ports, or a branching trigger anywhere in it — grep `lib/` for `split` or
`branch` and get nothing.

## Known gaps

- No Mermaid (or any other) import/export adapter yet — deliberately
  deferred, though the shape was designed with one in mind (see
  `docs/domain-shape.md` §8: an adapter must be buildable from the same
  public `ops` any consumer uses, no back doors).
- No undo, redo, or change attribution, by design. `detach` is the
  reversible removal; `purge` is gated behind having no edges and no
  children.
- No persistence layer (`DocumentRepository`-style) — a consumer loads and
  saves the plain JSON document itself.
