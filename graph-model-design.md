# Graph document model

A JSON model for a Vue-based graph-node editor that also ingests Mermaid `flowchart`, `sequenceDiagram` and `erDiagram` sources.

Version 1.0.0 (draft) · Schema: `graph-document.schema.json` · Registry: `node-types.registry.json` · Examples: `examples.json`

---

## 1. The forces in tension

Everything below is a consequence of resolving these against each other:

1. **The editor must be semantically ignorant.** It moves boxes, draws wires, renames labels. It must not contain the strings `scene`, `act`, `flowchart` or `participant` anywhere.
2. **The diagram kinds are genuinely different.** A flowchart is a spatial containment graph. A sequence diagram is a partially-ordered message log over fixed lanes. An ER diagram is typed records with cardinality-annotated relations. Forcing them into one flat shape corrupts at least two of them.
3. **Every node can expand into a subgraph.** Containment is a universal capability of nodes, not a property of a special container type.
4. **Structure, presentation and payload have different lifecycles.** They are written at different frequencies, conflict differently, and belong to different owners. Storing them in one undifferentiated record makes all three worse. See §5 — this is the load-bearing decision.

The resolution is a thin, kind-agnostic core plus a **declarative type registry** that supplies all semantics as data. The editor reads the registry; it never branches on diagram kind or domain vocabulary. Adding a fourth kind is a registry entry plus an importer, with no editor changes.

---

## 2. Core decisions and why

| # | Decision | Rationale |
|---|---|---|
| D1 | Nodes and edges are **maps keyed by id**, not arrays | O(1) lookup; ids cannot duplicate by construction; JSON Patch paths are stable (`/nodes/{id}/label`), giving undo/redo and collaborative edits nearly free. Array indices make every patch path reorder-fragile. |
| D2 | Containment is a **flat map plus `parent` pointer**, never physical nesting | Nesting subgraphs inside node JSON makes reparenting a move-subtree operation and lookup a tree walk. A `parent` pointer makes reparenting one field write and containment a derived index. |
| D3 | Edges connect **ports**, not nodes directly | A path-split needs distinguishable outputs. A decision needs true/false ports. Node-only endpoints force you to encode this in labels, which is unqueryable. |
| D4 | Every node may have children | Directly satisfies "every node can expand to a subgraph" with zero type machinery. An Act containing Scenes and a `core.branch` becoming a subgraph are the same mechanism. |
| D5 | Edges are **level-local**, with `portal` nodes for crossings | Makes collapse/expand a pure view operation — see §7. |
| D6 | Sibling order is a **fractional rank string** | Inserting a Scene between two others must not renumber every subsequent sibling. |
| D7 | Identity, key and label are **three separate fields** | The id/label distinction Mermaid blurs. See §9. |
| D8 | **Derived data is never persisted** | Adjacency, containment trees, degree counts, root lists are all computed. One source of truth, no cache invalidation bugs inside your document. |
| D9 | **Presentation lives in a parallel `view` collection**, keyed by node id | Different write frequency, conflict semantics, ownership and durability from structure and payload. See §5. |
| D10 | **Nodes do not store their links** | Edges are the single source of truth for topology. Adjacency on the node is a denormalisation you would have to maintain on every mutation. See §5.1. |

---

## 3. Document envelope

```json
{
  "schemaVersion": "1.0.0",
  "id": "01JBQ8Z3K7MN4P6R8T0V2W4X6Y",
  "kind": "flowchart",
  "title": "Checkout request path",
  "meta": {
    "layout": { "direction": "LR", "engine": "dagre" },
    "createdAt": "2026-08-17T09:00:00Z",
    "updatedAt": "2026-08-17T09:14:22Z",
    "revision": 42
  },
  "nodes": { "…": {} },
  "edges": { "…": {} },
  "view": { "nodes": {}, "edges": {} },
  "ext": {},
  "source": {
    "format": "mermaid",
    "dialect": "flowchart",
    "rendererVersion": "11.16.1",
    "text": "flowchart LR\n  …",
    "importedAt": "2026-08-17T09:00:00Z"
  }
}
```

`kind` is advisory metadata, not a switch the editor reads. It selects a **ruleset** in the registry and tells the palette which categories to surface. Set it to `generic` and the document still works — you only lose kind-specific validation.

Note what is absent: no `roots` array (derive from `parent === null`), no adjacency lists, no `nodeCount`. All derived (D8).

---

## 4. Node

```json
{
  "id": "01JBQ8Z4A1B2C3D4E5F6G7H8J9",
  "key": "ord",
  "type": "flow.process",
  "label": "Order service",
  "parent": null,
  "rank": "m",
  "state": "active",
  "ports": {
    "in":  { "direction": "in",  "arity": { "min": 0, "max": null } },
    "out": { "direction": "out", "arity": { "min": 0, "max": 1 } }
  },
  "data": {},
  "ext": {},
  "source": { "raw": "ord[Order service]", "line": 3 }
}
```

Every field here is either identity, topology, or opaque payload. There are no coordinates, no colours, no collapsed flag — those are in `view` (§5).

**`type`** resolves into the registry, which supplies default ports, palette entry, Vue component, a JSON Schema for `data`, and the Mermaid mapping. Instance `ports` *override or extend* registry defaults — omit the field and defaults apply. This is what lets an ER entity grow a port per attribute at runtime without a new type.

**`data`** is the domain payload, validated against the type's `dataSchema`. A `story.scene` puts its prose, characters and beat list here. The editor treats it as an opaque blob and renders it via a registered component.

**`ext`** is for consumers other than core — plugins, integrations, your own app services. Namespaced to prevent collisions:

```json
"ext": {
  "com.acme.costing":   { "monthlyUsd": 240 },
  "org.mermaid.style":  { "classes": ["hot"] }
}
```

Hard rule: **core code never reads `ext`, and unrecognised `ext` keys must survive a read-modify-write cycle untouched.** Break that and plugins silently lose data on every save.

---

## 5. Structure, presentation and session state

This is the architectural question that matters most, and "metadata" as a single category is the thing to dissolve. The list of candidates — linked nodes, position, children locked to parent, node type — belongs to four different tiers with four different lifecycles.

### 5.1 Topology is not metadata

**Linked nodes do not go on the node.** Edges are the single source of truth; adjacency is a derived index rebuilt in the store (D10).

If a node carries `{ "links": ["n7", "n9"] }` you now have two representations of one fact. Every connect, disconnect, reparent, detach and purge must update both, atomically, or the document is corrupt. You will also need a rule for what happens when they disagree, and there is no correct answer. Every graph editor that stores adjacency on nodes eventually grows a "repair graph" command, which is the tell.

Build the index once per revision instead:

```js
const outgoing = new Map()   // nodeId -> edgeId[]
const incoming = new Map()
for (const e of Object.values(doc.edges)) {
  push(outgoing, e.from.node, e.id)
  push(incoming, e.to.node, e.id)
}
```

O(E) on a document you already hold in memory. For a story graph — hundreds of nodes, not millions — it is free, and it cannot drift.

### 5.2 The four tiers

| Tier | Examples | Where it lives | Lifecycle |
|---|---|---|---|
| **Structure** | `id`, `type`, `parent`, `rank`, `ports`, edge endpoints, `state` | `nodes` / `edges` | The graph itself. Every mutation is semantically meaningful and undoable. |
| **Payload** | Scene prose, Act summary, ER attributes, message text | `node.data` / `edge.data` | Domain content. Opaque to the editor, validated by the type's schema. |
| **Authored presentation** | `x`, `y`, `w`, `h`, `collapsed`, `lockChildren`, colour overrides, edge waypoints | `view.nodes` / `view.edges` | Deliberate, persisted, shared, undoable — but regenerable and semantically inert. |
| **Session state** | viewport pan/zoom, selection, active tool, hover, inspector tab | Pinia store + `localStorage` | Never in the document. Meaningless without the app open. |

The two-tier instinct ("structure plus metadata") collapses the middle two, and that is where the pain is.

### 5.3 Why presentation is separated

Five concrete reasons, in rough order of how much they will bite you:

1. **Write frequency differs by three orders of magnitude.** Dragging a node emits coordinate writes at frame rate. Editing a Scene's prose emits one write. On the same record, every drag dirties the domain record, floods the JSON Patch log, and wakes up payload-level reactivity and validation. Separated, you can throttle, coalesce, or exclude geometry from the undo stack entirely without touching structure handling.

2. **Diffs stay meaningful.** If you ever persist documents in git — and for a story graph you probably should — geometry churn drowns the semantic diff. "Moved 40 nodes and changed one Scene" should not look like a 41-node change. Separated collections let you diff `nodes` alone.

3. **Conflict semantics differ.** Two users moving the same node: last-write-wins is correct and nobody cares. Two users editing the same Scene text: you need a real merge strategy. One record forces one policy onto both.

4. **Ownership may diverge.** Canonical layout today; "my personal arrangement of the Act 2 board" tomorrow. With `view` separated, per-user layout is loading a different `view` object against the same `nodes`. In the same record it is a migration.

5. **Export is cleaner.** Rendering the story to a screenplay, or exporting Mermaid, wants structure and payload and none of the geometry. Separated, the exporter simply never reads `view`.

### 5.4 The concrete shape

```json
"view": {
  "nodes": {
    "01JBQ8Z4…": {
      "x": 320, "y": 80, "w": 168, "h": 44,
      "collapsed": false,
      "lockChildren": true,
      "style": { "accent": "teal" }
    }
  },
  "edges": {
    "01JBQ8Z5…": { "waypoints": [[400, 90], [460, 120]] }
  }
}
```

Properties of this arrangement:

- **Same file, separable later.** One document, one fetch, one save — simple now. When you want `view` in its own table, row, or per-user file, you move a subtree and change nothing in `nodes`.
- **Every entry is optional.** A node with no `view` entry is unpositioned; the layout engine assigns coordinates. Import produces zero `view` entries and lets dagre place everything, which is exactly right for Mermaid sources that carry no coordinates.
- **Garbage collection is a real obligation.** `purge(node)` must delete `view.nodes[id]`. Add an integrity check that reports orphaned `view` keys; they are harmless but they accumulate.

The cost is honest: two lookups instead of one, and a cleanup rule. In exchange you get four of the five benefits above permanently and the fifth cheaply.

**If you want to defer the split**, the pragmatic middle is to keep presentation on the node under a single `view` key — `node.view.x` rather than `node.x` — so extraction later is a mechanical move rather than a field-by-field audit. What you must not do is scatter `x`, `y`, `collapsed`, `color` as siblings of `label` and `parent`, because then the boundary exists only in your head.

### 5.5 `lockChildren` — check which tier it is really in

"Are children locked in position relative to the parent" is two different requirements wearing one name, and they land in different tiers:

- **"Don't auto-layout these; I placed them deliberately"** → authored presentation. `view.nodes[id].lockChildren = true`, and the layout engine skips the subtree. Regenerable, semantically inert, correct in `view`.
- **"These children are ordered, and the order means something"** → structure. Scene 3 follows Scene 2 within an Act because the story says so, not because of pixels. That is `node.rank` on the children (§11), and it must survive a "reset layout" command that wipes every coordinate in the document.

Run that test on it: **if "reset all layout" would destroy the information, it is not presentation.** Scene order survives; pixel offsets do not.

### 5.6 Node type: core field, domain vocabulary

`type` is a **core structural field** — the editor needs a discriminator to look up a descriptor. But its *values* are domain vocabulary living in the registry:

```
story.act      container, holds Scenes and Splits
story.scene    leaf payload
story.split    one in-port, N out-ports  (your Path-split)
```

Note where these land in the existing model rather than needing new concepts: an Act is a node with children (D4). A Path-split is `core.branch` with a domain label and its own `dataSchema` — and because every node can contain children, a Path-split expands into a subgraph the moment a user asks, with no conversion step and no id churn.

The discipline that keeps the editor agnostic is testable: **grep the editor package for `scene`, `act` and `split`. Zero hits, or you have leaked.** Domain vocabulary appears in the registry JSON, in Vue components registered by name, and nowhere else. The editor knows only that `type` is a string it can resolve.

### 5.7 The boundary, stated precisely

"Metadata is *how* to render, `data` is *what* to render" is the right instinct. Two refinements make it hold up in code.

**Split presentation by scope: class-level goes in the registry, instance-level goes in `view`.**

| Question | Scope | Home |
|---|---|---|
| What shape is a Scene? Which icon? Which Vue component? Which ports? | All Scenes | Registry, keyed by `type` |
| Where is *this* Scene? How wide did the user drag it? Is it collapsed? Are its children pinned? | One node | `view.nodes[id]` |

The test: **if changing it should change every node of that type, it belongs in the registry.** Put shape or colour on the node instance and you will be writing a migration the first time someone wants all Splits to look different.

**The mechanism that actually makes "what to render" agnostic is the editor-to-component contract.** The editor resolves `type` → registry → component name, mounts that component, and hands it `data` as an opaque prop. The editor never inspects `data`'s interior; the component is the only code that understands it. That single boundary is what keeps the editor from knowing what a Scene is:

```
editor:     type → registry.component → <StorySceneNode :data="node.data" />
component:  reads data.prose, data.characters, data.beats
editor:     reads none of it, ever
```

Everything the editor needs to lay out and wire the graph is in `nodes`, `edges` and `view`. Everything it must not understand is in `data`. If you ever find the editor reaching into `data` to make a layout decision, that is the leak — hoist whatever it needed into `view` or the registry.

**Two caveats worth deciding up front:**

*`label` is a deliberate exception.* Strictly it is "what to render", but the editor legitimately needs one human-readable string per node — for search, breadcrumbs, minimap text, a collapsed container's title, and accessibility names. Keeping it core avoids the editor reaching into `data` for a display name, which would breach the contract above. Document it as an exception rather than letting it become a precedent: `label` is core, everything else about content is not.

*Size is often derived from `data`, so store it only when overridden.* A Scene's height depends on how much prose it holds; an ER entity's height depends on attribute count. If `view` always carries `w`/`h`, authored values and intrinsic values fight, and stale sizes survive content edits. Rule: **omit `w`/`h` unless the user explicitly resized the node.** Absent means "measure me" — the component reports its intrinsic size and layout uses that. Present means "the user overrode this, respect it". Same pattern for `x`/`y`: absent means unplaced, so the layout engine assigns, which is exactly what a fresh Mermaid import produces.

---

## 6. Port

```json
{
  "direction": "in",
  "label": "",
  "role": "default",
  "arity": { "min": 0, "max": 1 },
  "dataType": null
}
```

- `direction` — `in` | `out` | `inout`
- `role` — `default` | `true` | `false` | `error` | `portal`. Semantic hint for the renderer and any future exporter (a `true`/`false` pair round-trips to labelled edges off a Mermaid diamond).
- `arity.max: null` means unbounded. **`max: 1` on an out-port is what triggers automatic split-node insertion** (§8).
- `dataType` — reserved for typed connections. Leave `null`; the validator ignores it.

---

## 7. Edge, and the level-local invariant

```json
{
  "id": "01JBQ8Z5…",
  "type": "flow.link",
  "from": { "node": "01JBQ8Z4…", "port": "out" },
  "to":   { "node": "01JBQ8Z6…", "port": "in" },
  "parent": null,
  "rank": "m",
  "label": "",
  "state": "active",
  "style": { "line": "solid", "arrowStart": "none", "arrowEnd": "arrow" },
  "data": {},
  "ext": {},
  "source": { "raw": "gw --> ord", "line": 4 }
}
```

Edges carry `parent` for the same reason nodes do — a sequence-diagram `alt` block contains *messages*, not participants. Uniform containment across both collections avoids inventing a second grouping mechanism.

### The invariant that pays for itself

For containment kinds:

> **INV-5:** `nodes[edge.from.node].parent === nodes[edge.to.node].parent`

An edge may only connect siblings. Cross-level connections are expressed with a **portal node** inside the container:

```
┌─ act2 (container, expanded) ───────────┐
│  [portal:in] → scene_a → scene_b       │
│                             ↓          │
│                       [portal:out]     │
└────────────────────────────────────────┘
```

A portal is an ordinary node of type `core.portal` with `data: { port: "in", direction: "in" }`. It binds an interior endpoint to a port on its own parent. Exterior edges terminate on `act2`'s port; interior edges terminate on the portal. Neither crosses a boundary.

Why the extra node is worth it:

- **Collapse and expand become pure view operations.** `view.nodes[id].collapsed = true` hides children. Zero edges rewritten, zero ids changed, and because it is a `view` write it need not even enter the structural undo stack. With boundary-crossing edges you must re-anchor every crossing edge on collapse and reconcile on expand.
- **Validation is local** — one parent comparison, not two ancestor walks.
- **Layout is recursive and independent.** Run dagre per level and compose.
- **It matches user expectation** from Node-RED, n8n, Blender and Unreal: subgraph inputs and outputs are visible objects you can wire and reorder.

The cost is that the Mermaid importer must synthesise portals, because Mermaid draws boundary-crossing edges freely. One-time normalisation pass, §12.

INV-5 is a **kind rule, not a core invariant.** Sequence diagrams violate it by design and the registry simply does not apply it for `kind: sequence`.

---

## 8. Splits as policy, not structure

Your intermediate-node idea is best expressed as an **arity policy**:

1. User drags a wire from `scene_a.out` to a second target.
2. Editor sees `out.arity.max === 1` with one existing connection.
3. Editor inserts a `story.split`, rewires the existing edge through it, connects both targets to the split's out-ports.

`story.split` is an ordinary node — one in-port, N out-ports, unbounded. Because every node can contain children (D4), **it is already a subgraph the moment the user expands it.** No conversion, no type change, no id churn.

Set `arity.max: null` to allow bare fan-out with no intermediate node. The behaviour is per-type and declared in the registry, so `story.scene` can require splits while `seq.participant` allows unlimited messages.

For import this is a switch, defaulting off:

```json
"normalize": { "branchOnFanOut": false }
```

Import Mermaid faithfully first; offer split insertion as an explicit user action so an import never silently restructures the source graph.

---

## 9. Identity: three fields, three jobs

| Field | Mutable | Unique scope | Purpose |
|---|---|---|---|
| `id` | Never | Document | Referential integrity. ULID or UUIDv7 — both sort lexicographically by creation time, which makes debugging pleasant. |
| `key` | Yes | Siblings | Human-facing handle. Carries the Mermaid identifier on import. |
| `label` | Yes | Not unique | Display text. |

Edges reference `id`, never `key`. Non-negotiable: renaming a Mermaid-imported node from `ord` to `orders` must not touch a single edge. Mermaid's global-id model is exactly what makes hand-edited `.mmd` files fragile, and there is no reason to inherit it.

On import, `key` collisions across subgraph scopes get suffixed (`db`, `db_2`) with the original preserved in `source.raw`.

---

## 10. Lifecycle: active, detached, purged

Remove from the map without deleting so it can be reconnected; delete outright only when disconnected. Three operations over two states.

```
              detach                    disconnect              purge
  active ──────────────▶ detached ──────────────────▶ detached ────────▶ (gone)
     ▲                      │                        (degree 0)
     └──────────────────────┘
              attach
```

| Operation | Effect |
|---|---|
| `detach(node)` | `state = "detached"` on the node **and every incident edge**. Leaves layout and traversal; wiring fully preserved. |
| `attach(node)` | Reverse. Wiring restored exactly, provided other endpoints still exist. |
| `disconnect(node)` | Hard-deletes incident edges. Degree becomes 0. |
| `purge(node)` | Permitted **only** with no incident edges in any state and no children. Removes the entry, and its `view` entry. |

Four guards worth enforcing in the reducer:

- **`purge` must count children in *both* collections.** A node's children may be nodes *or* edges — a `seq.block` contains only edges. A children check that walks `nodes` alone reports such a block as purgeable and orphans every message it grouped. This one was caught by the invariant checker rather than by reading the model, which is the argument for running `validate.mjs` in CI.
- `purge` must reject a node with children at all, or you orphan them. Either purge recursively behind an explicit flag, or require emptying first.
- `attach` must verify both endpoints of each detached edge still exist. If one was purged, drop that edge rather than resurrecting a dangling reference. It must also **re-check arity**: detached edges do not occupy a port (see below), so reattaching can push an `arity.max: 1` port to 2. Either refuse, or insert a branch node as part of the attach.
- `purge` must delete `view.nodes[id]` (§5.4).

One semantic decision embedded in the checker: **detached edges do not consume port arity.** A Scene whose single out-port has one active and one detached edge is valid. The alternative — detached edges reserving their slot — makes arity depend on invisible state and confuses users. The cost is the reattach check above.

Traversals default to `state === "active"`. Detached nodes deserve a real UI affordance — a tray or parked panel — not a hidden state users must remember.

---

## 11. Ordering: fractional ranks

`rank` is a lexicographically-sortable string (fractional indexing / LexoRank), not an integer.

```
initial:   a0        b0        c0
insert between a0 and b0  →  "a0V"
```

Sibling order = sort by `rank`, tiebreak by `id`. Inserting is one field write; an integer index rewrites every subsequent sibling, producing enormous undo entries and guaranteed conflicts under concurrent editing.

Where it matters:

- **Scene order within an Act** — structural, survives layout reset (§5.5).
- **Sequence messages** — `edge.rank` *is* the message order.
- **Sequence participants** — `node.rank` is column order.
- **Flowcharts** — mostly cosmetic, but keep it for stable serialisation and diffs.

Use the `fractional-indexing` package rather than rolling your own; the midpoint algorithm has unpleasant edge cases around exhausted ranges.

---

## 12. Mapping the three Mermaid kinds

### 12.1 flowchart

| Mermaid | Model |
|---|---|
| `flowchart LR` | `kind: "flowchart"`, `meta.layout.direction: "LR"` |
| `ord[Order service]` | node, `key: "ord"`, `label: "Order service"`, `type` from bracket lookup |
| bracket shape | `type` via the registry reverse map (`[` `]` → `flow.process`, `{` `}` → `flow.decision`, `[(` `)]` → `flow.datastore`, …) |
| `gw --> ord` | edge, `style.line: "solid"`, `style.arrowEnd: "arrow"` |
| `-.->` / `==>` / `~~~` | `style.line: "dashed"` / `"thick"` / `"invisible"` |
| `--o` / `--x` | `style.arrowEnd: "circle"` / `"cross"` |
| `-->|label|` | `edge.label` |
| `subgraph core [Core]` … `end` | node `type: "core.group"`; members get `parent` = its id |
| `direction TB` inside subgraph | `node.data.layout.direction` |
| `classDef` / `class` / `:::` | `node.ext["org.mermaid.style"]` |
| `click n "url"` | `node.ext["org.mermaid.interaction"]` |

**Normalisation pass:**

1. Parse into a provisional flat graph, honouring Mermaid's global id scope.
2. Assign `parent` from subgraph membership at declaration site.
3. For every edge whose endpoints have different parents, walk both ancestor chains to the common ancestor and insert a `core.portal` at each boundary crossed, splitting the edge into per-level segments. Record the original in `source`.
4. Re-key collisions; assign ranks in source order.
5. Emit **no** `view` entries — let the layout engine place everything.

Step 3 adds nodes that were not in the source text. Surface it in the import summary — "12 nodes imported, 3 boundary portals added" — so it is not a surprise.

### 12.2 sequenceDiagram

| Mermaid | Model |
|---|---|
| `participant API as Order API` | node `seq.participant`, `key: "API"`, `label: "Order API"`, `rank` = column order |
| `actor U as Customer` | node `seq.actor` |
| `U->>API: POST /checkout` | edge `seq.message`, `rank` = time order, `label` = text |
| `->>` `-->>` `->` `-x` `-)` | `style.line` + `style.arrowEnd` pair |
| `+` / `-` activation | `edge.data.activate` / `deactivate` |
| `alt` `else` `loop` `par` `opt` `critical` | node `seq.block`, `data.blockType`, `data.branches[]`; contained messages get `edge.parent` = block id |
| `Note over A,B: text` | node `seq.note`, `data.anchors: [nodeId, nodeId]` |
| `autonumber` | `meta.sequence.autonumber: true` |

Consequences: INV-5 is not applied, since messages inside an `alt` connect top-level participants — the block groups edges, not endpoints. Participants sit at `parent: null` ordered by `rank`.

The payoff from D4 again: a `seq.block` needed no new machinery. It is a node whose children happen to be edges.

### 12.3 erDiagram

| Mermaid | Model |
|---|---|
| `CUSTOMER { bigint id PK }` | node `er.entity`, `data.attributes: [{ name, type, keys, comment }]` |
| `CUSTOMER \|\|--o{ ORDER : places` | edge `er.relationship`, `label: "places"` |
| `\|\|` `\|o` `}o` `}\|` | `data.from.cardinality` / `data.to.cardinality` as `one` / `zeroOrOne` / `zeroOrMany` / `oneOrMany` |
| `--` vs `..` | `data.identifying: true` / `false` |

Attributes live in `data`, not as child nodes, because they are not independently connectable — until you want FK-to-PK wiring at attribute granularity. That is the extension path: generate one instance port per attribute (§4), keeping `data.attributes` as the source of truth and ports as the connection surface. No schema change, which is the point of instance-level port overrides.

---

## 13. Keeping the export door open

Import-only for now. The cost of not closing the door is small and confined to `source`:

- **Document** — full original text, dialect, renderer version.
- **Node / edge** — `raw` (original declaration substring) and `line`.
- **Unmapped constructs** — `ext["org.mermaid.*"]` for `classDef`, `click`, `linkStyle`, `%%{init}%%` directives and comments.

Enough to regenerate equivalent Mermaid later and to show a source-diff view. Deliberately *not* a full CST — storing one couples your model to a Mermaid grammar version, which is the dependency you are escaping by owning the JSON.

One rule to keep it honest: **`source` is write-once at import and never updated by the editor.** The moment you sync it with edits you have built a two-way binding to a foreign grammar. Treat it as provenance, not state.

---

## 14. Node type registry

The registry is why the editor can be agnostic. It is data — shippable as JSON, extensible by users.

```json
"story.split": {
  "extends": "core.branch",
  "label": "Path split",
  "category": "story",
  "component": "StorySplitNode",
  "ports": {
    "in":  { "direction": "in",  "arity": { "min": 1, "max": null } },
    "out": { "direction": "out", "arity": { "min": 0, "max": null }, "group": true }
  },
  "dataSchema": {
    "type": "object",
    "properties": { "condition": { "type": "string" } }
  },
  "allowsChildren": true,
  "mermaid": { "flowchart": { "open": "{", "close": "}" } }
}
```

One descriptor drives five things: palette entry, Vue component, port topology, `data` validation, and Mermaid mapping. Adding a node type is a JSON edit plus optionally a component — no editor changes, which is what "agnostic but customisable" has to mean in practice.

`allowsChildren` defaults to `true` (D4). Set it `false` only where expansion is meaningless, such as `core.portal`.

**Rulesets** carry per-kind invariants:

```json
"rulesets": {
  "flowchart": { "invariants": ["INV-5"], "allowedTypes": ["flow.*", "core.*"] },
  "sequence":  { "invariants": ["INV-9"], "allowedTypes": ["seq.*", "core.group"] },
  "story":     { "invariants": ["INV-5"], "allowedTypes": ["story.*", "core.*"] }
}
```

---

## 15. Invariants

**Core — always enforced:**

- INV-1 `nodes[id].id === id`, `edges[id].id === id`.
- INV-2 `parent` chains are acyclic and terminate at `null`.
- INV-3 Every `edge.from.node` / `edge.to.node` exists in `nodes`.
- INV-4 Every referenced port exists and direction is compatible (`out` → `in`).
- INV-6 `key` is unique among siblings sharing a `parent`.
- INV-7 `purge` requires degree 0 and no children **in either `nodes` or `edges`**.
- INV-8 Port `arity` bounds respected, counting active edges only.
- INV-11 Every `view.nodes` / `view.edges` key resolves to an existing record.

**Kind rules — applied per ruleset:**

- INV-5 Level-local edges (containment kinds only).
- INV-9 `seq.message` ranks are distinct (`sequence` only).
- INV-10 `er.relationship` requires cardinality on both ends (`er` only).

Enforce core invariants in the reducer, synchronously, on every mutation. Enforce kind rules on save and on demand, so a mid-drag intermediate state may be briefly invalid.

---

## 16. Editor notes

**Undo/redo.** D1 makes JSON Patch the natural mutation log. `[{"op":"replace","path":"/nodes/01JB…/label","value":"Orders"}]` plus its inverse gives unlimited undo with no bespoke command objects, and the same patch stream is what goes on a WebSocket if you add collaboration. Because presentation is a separate subtree, you can filter `/view/**` patches out of the undo stack — or into a separate shallower one — without special-casing fields.

**Vue reactivity.** Keep the document in a Pinia store as a plain reactive object. Derive the rest through getters memoised on `meta.revision`:

```
childrenOf(parentId)   group nodes by parent
edgesOf(nodeId)        index by from.node / to.node
degreeOf(nodeId)       drives the purge guard
visibleNodes(rootId)   walk containment, stop at collapsed
```

Never store these on the document (D8).

**Rendering.** `visibleNodes` plus per-level dagre gives nested layout for free. A collapsed container renders as one box whose visible ports are exactly its portal-bound ports — the payoff from §7.

**Validation surface.** Ship the JSON Schema to the frontend and run ajv in the browser as well as the server. Same artefact, same errors, no drift.

---

## 17. Versioning

`schemaVersion` is semver over the *core* model. Registry types version independently, since users will add their own.

1. **Preserve unknown fields on read-modify-write.** A document written by v1.2 and edited by a v1.0 client must not lose v1.2 fields.
2. **Additive minor versions only.** New optional fields and new types are minor. Removing a field, tightening a constraint, or changing invariant semantics is major and needs a migration.

Keep migrations as an ordered list of pure `(doc) => doc` functions keyed by version, run on load. Cheap now, essential the first time you change something.

---

## 18. Deliberately deferred

- **Typed ports** (`dataType`). Field exists; leave enforcement out until you need it. Type systems are easy to add and very hard to loosen.
- **Multi-document references.** Cross-document links turn ids into a global namespace. Get one document right first.
- **CRDT / OT.** JSON Patch over a flat map is already the right substrate. Do not pay CRDT complexity before you have concurrent editors.
- **Mermaid export.** §13 keeps it cheap later.
- **Per-user `view` documents.** D9 makes it a move, not a migration. Wait until someone asks.
- **Full Mermaid grammar coverage.** Import the constructs above, park the rest in `ext`, report it. An import that silently drops a `classDef` is worse than one that says it skipped three constructs.

---

## 19. Frontend and runtime portability

The model is deliberately technology-neutral: it is JSON with all derived data excluded, so nothing in it presumes a rendering stack. Here is the honest audit.

### Fully portable

| Artefact | Coupling |
|---|---|
| `graph-document.schema.json` | None. Plain JSON Schema 2020-12. |
| `examples.json` | None. Data. |
| `node-types.registry.json` | Two opaque keys — see below. |
| The model itself | None. No coordinates baked into nodes, no adjacency, no framework types. |

Draft 2020-12 validators exist across every stack you are likely to use: `ajv` (JS), `jsonschema` (Python), `opis/json-schema` and `justinrainbow/json-schema` (PHP), `santhosh-tekuri/jsonschema` (Go), `jsonschema` (Rust), `networknt/json-schema-validator` (Java). Same artefact, same errors, whatever renders it.

### The two coupled fields

`component` and `icon` in the registry are **opaque keys, not imports.** The registry says "render this with the thing called `StorySceneNode`"; which framework resolves that name is entirely the frontend's business:

```
Vue      { StorySceneNode: defineAsyncComponent(() => import('./StoryScene.vue')) }
React    { StorySceneNode: StoryScene }
Svelte   { StorySceneNode: StoryScene }
native   { StorySceneNode: (props) => new SceneWidget(props) }
```

If you will ever run two frontends against one registry, move both fields into a sibling `renderers: { vue: {…}, react: {…} }` map keyed by type. With a single frontend, inline is fine and simpler.

### What is advisory rather than normative

§16 names Pinia and dagre. Both are examples, and the patterns transfer directly:

| Concern | Vue | Equivalent elsewhere |
|---|---|---|
| Reactive document store | Pinia | Redux / Zustand / MobX, Svelte stores, Angular signals, plain observable |
| Memoised derived indexes | getters keyed on `meta.revision` | selectors, `computed`, `useMemo`, any cache keyed on the same counter |
| Mutation log | JSON Patch (RFC 6902) | RFC 6902 implementations exist in every language |
| Layout | dagre | elk.js, d3-hierarchy, Graphviz via WASM, or your own |

The one genuine substitution for a non-web frontend is the layout engine, since dagre and elk are JS. Everything else is arithmetic over a JSON tree.

### `validate.mjs` specifically

That file is Node plus ajv, so it is runtime-coupled — but it is **tooling and backend, not frontend**. Its logic is roughly 150 lines of plain graph algorithms over maps: no framework, no async, no DOM. Porting it to PHP for your backend is mechanical, and given your stack that is probably where it belongs — schema validation via `opis/json-schema`, the INV-1 to INV-11 checks as a straight transcription. Run it on every write, and in CI against fixtures.

The Mermaid importer is the one place I would keep Node, at least initially. Rather than reimplementing the grammar in PHP, run `mermaid`'s own parser in a small Node sidecar or a queue worker that consumes `.mmd` and emits a document conforming to this schema. You get grammar fidelity for free and the coupling stays behind one interface.

---

## 20. Open questions worth settling before you build

1. **Is `key` user-visible?** If yes it needs uniqueness feedback in the UI. If it is only a Mermaid artefact, hide it and generate from `label`.
2. **Are portals user-creatable, or importer-only?** Users authoring their own subgraph inputs is more powerful but needs a palette entry and arity UI.
3. **Does `detach` cascade to children?** Detaching an expanded Act — do its Scenes go with it, or must it collapse first? I would cascade and record it as one undo entry.
4. **Is Scene order within an Act total or partial?** `rank` gives total order. If a Path-split means two Scenes are genuinely concurrent alternatives, order between them is meaningless and forcing a rank will mislead whoever reads the JSON later.
5. **Can an Act contain an Act?** D4 permits it. If your domain forbids it, that is a registry rule (`allowedChildTypes`), not a core constraint.
