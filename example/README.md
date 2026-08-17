# Example — runnable graph node editor

Run `npm start` from the repo root, then open **http://localhost:8080**. No build
step, no runtime dependencies — everything is plain ES modules, served over HTTP
because browsers do not load modules from `file://`.

## The files

| File | Layer | What it is |
|---|---|---|
| `example.html` | app | Page and styles. Loads `example.js` as an ES module; the rest of the app follows through imports. |
| `example.js` | app | Wires it together: presets, palette, inspector, Mermaid buttons. |
| `renderer.js` | app | One possible renderer. Reads only type, label, ports, `view` and containment — never `node.data`. |
| `node-types.js` | **project** | All node types, each a subclass of `GraphCore.BaseNodeType`. Includes the branch split. |
| `mermaid-io.js` | adapter | The only file that knows Mermaid exists. |
| `core/` | **library** | Document, mutations, ports, hooks, validation. Knows nothing about rendering, layout, Mermaid, or any domain type. One file per entity in `core/model/` (each with its factory), one file per service in `core/services/`, and the `Graph` aggregate facade in `core/graph.js`. |
| `samples/*.mmd` | fixtures | One sample per dialect. |
| `tests/selftest.mjs` | test | 92 headless checks. `npm run test:self` — no dependencies. |
| `tests/domtest.mjs` | test | 70 checks that drive the actual page. `npm run test:dom`. |

Delete `node-types.js` and the library still runs — you just have no types to place.
That is the boundary the whole design is built around.

## What to click

**Presets** load a scenario:

- **single node** — one node, nothing else. Its out-port reads `0/1`: capacity one.
- **one of every type** — one node per palette entry. The dilemma arrives with two children already made.
- **linked chain** — four nodes wired in sequence.
- **branching (auto split)** — the interesting one, see below.
- **subgraph + portal** — a container with a portal, so no edge crosses its boundary.
- **nested dilemma** — a type whose `onCreate` hook builds its own children.

**Linking:** click a green out-port on the right of a node, then a blue in-port on the left of another. `Cancel link` aborts.

**Editing:** click a node or edge, then use the inspector. Labels, `data` as raw JSON, edge line style, and the move-into dropdown for reparenting.

**Deleting** has three levels, deliberately:

- **Detach** — soft. The node goes to the tray at the bottom and its edges are *parked*, not deleted. Click it in the tray to reattach with its wiring intact.
- **Disconnect** — hard-removes the edges.
- **Purge** — permanent, and refused while the node still has edges or children.

**Mermaid:** the three `*.mmd` buttons load a sample into the text box; `Import ▸` parses it; `◂ Export` writes the current map back out; `Download .mmd` saves it. `open file` reads a `.mmd` from disk.

## The thing worth watching

Load **branching (auto split)**, then:

1. Two nodes get linked directly. The source's out-port goes to `1/1`.
2. A second link from the same port would exceed capacity. The library does **not** allow it and does **not** hard-fail — it asks the handler named in that type's `onOverflow`.
3. `BranchSplitNode.handleOverflow` inserts a split, retargets the existing edge through it, and wires both branches. It also grows a spare third output.
4. Now delete either branch edge (click the edge, then `Remove edge`). The split sees it is no longer branching and removes itself, joining its neighbours back up.

None of that behaviour is in `core/`. Grep it for `split`, `branch` or `overflow` — the only hit is the generic hand-off in `core/services/ops.js`. The library's entire contribution is: ports declare a capacity, and something gets asked when one is exceeded.

Three things stop the auto-removal, all visible in `node-types.js`:

- the split has children (it became a real subgraph)
- `data.origin` is `authored` rather than `auto` (a person placed it)
- it has parked edges, plugin data in `ext`, or a `condition` typed into it

## Sample Mermaid files

`samples/flowchart.mmd` — exercises shapes, labelled branches, a subgraph, and two edges that cross the subgraph boundary (the importer inserts portals for those and says so in the log).

`samples/sequence.mmd` — participants, an actor, messages, an `alt` block, `autonumber`.

`samples/er.mmd` — entities with typed attributes and PK/FK/UK markers, three relationships with crow's-foot cardinality.

## Known limits

- **Drag** moves top-level nodes only. Nested nodes are auto-placed by the container.
- **The Mermaid parser is line-based**, not a real grammar. It covers the constructs in the samples and logs a note for anything else rather than dropping it silently.
- **Export is lossy on purpose.** Ports beyond in/out, `data` payloads and coordinates have no Mermaid syntax. Treat export as "draw me a diagram of this", not as serialisation — the JSON is the source of truth.
- **No undo.** Out of scope by design, which is why `Detach` exists and why `Purge` is gated.
- `capacity` is the field the docs still call `arity`. This example uses the newer name.
