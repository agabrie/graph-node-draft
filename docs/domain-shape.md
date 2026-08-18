# Node-graph — domain shape

The goal: a **data-agnostic node-graph library** — logic and API only. Consuming
projects register their own node types and custom behavior (a branch-split that
manages itself, a scene that auto-attaches a label-block). Rendering belongs to
each consumer; this repo only carries a demo frontend as an example.

This document defines the shape of the domain: what a graph *is*, what is
metadata, and what the library promises. No code.

---

## 1. The three layers of a record

Every node and edge separates into three layers with different owners:

| Layer | Owner | Contents | Needed for the graph to be a graph? |
|---|---|---|---|
| **Structure** | library | identity, connections, containment, order, lifecycle state | yes |
| **Metadata** | library defines the shape, renderer consumes it | type, label, coordinates, collapsed, child-lock | no |
| **Data** | consumer | whatever the type needs (prose, conditions, attributes) | no — opaque to the library |

The test for what goes where: *delete it — is it still the same graph?*
Delete a node's coordinates and the graph is intact. Delete an edge's endpoint
and it isn't. Metadata is not required, but it is **not freeform** either: the
library defines one consolidated metadata shape so every renderer and tool
finds the same fields in the same place.

Metadata lives in its **own collection** on the document. Each metadata record
has its own id; a node or edge points at one via a reference. Because the
records are first-class, two nodes may share one metadata record, and swapping
a node's entire presentation is a one-field change of the reference.

---

## 2. The entities

### Document

The unit of saving, loading, and validity. Plain JSON — readable by any
runtime without executing any consumer code.

- `id` — permanent identifier
- `version` — format version for future migration
- `nodes` — map of node records, keyed by node id
- `edges` — map of edge records, keyed by edge id
- `metadata` — map of metadata records, keyed by their own id (see §1);
  nodes and edges reference into this collection
- `meta` — document metadata (title, anything else advisory)
- `ext` — plugin slots (see §6)

Maps keyed by id, not arrays: lookup is direct, ids cannot collide, and
reordering never rewrites keys.

### Node

**Structure**
- `id` — permanent, never reused, never edited. Everything references this.
- `parent` — id of the containing node, or null for top level. **Any node can
  contain children** — this one pointer is the entire subgraph mechanism.
  Chains must be acyclic and end at null.
- `rank` — ordering among siblings. A string chosen so a new sibling can
  always be inserted between two others without renumbering the rest.
- `state` — `active` or `detached` (see §5).

**Metadata reference**
- `meta` — id of a record in the document's `metadata` collection, or null.
  The record (all fields optional, shape owned by the library):
  - `type` — name of a registered node type. Absent or unknown is legal (§4).
  - `label` — display text. Editing it touches nothing else.
  - `x`, `y` — coordinates. Absent means "not placed yet; renderer decides".
  - `collapsed` — subgraph folded shut. The library resolves which nodes are
    visible under it and which ancestor stands in for a hidden one
    (`visibleNodes`, `visibleAncestorOf`) — pure reads of this flag and
    containment. What a renderer draws with that is its own call.
  - `lockChildren` — children keep their positions relative to this node.

**Payload**
- `data` — the type's own content. The library stores it, round-trips it,
  and never reads it.
- `ext` — plugin slots.

### Edge

Connects **node to node**. There are no ports; where a type needs
distinguishable branches (a decision's yes/no), the edge's label carries it.

**Structure**
- `id`, `parent`, `rank`, `state` — same meaning as on nodes. `parent` lets a
  grouping node own edges (a sequence diagram's `alt` block groups messages);
  `rank` orders them (message order in time).
- `from`, `to` — node ids. Always ids, never labels: renaming a node must
  never touch an edge.

Edges may connect any two nodes **regardless of containment** — an edge from
outside a subgraph straight to a node inside it is legal. (Mermaid allows
this natively; how a collapsed subgraph draws such an edge is a renderer
decision, not a data question.)

**Metadata reference**
- `meta` — id of a record in the `metadata` collection, or null. Edge
  metadata fields:
  - `label` — display text; also the branch discriminator ("yes"/"no").
  - `style` — line/arrow appearance (dashed vs solid carries meaning in
    Mermaid, so round-tripping preserves it).
  - `curvature` — how the edge is drawn between its endpoints (curve control
    points / waypoints).

**Payload** — `data`, `ext`, as on nodes.

---

## 3. The type system — the point of the library

Consumers extend a base type class and register it under a name. A node's
`meta.type` selects the registered behavior.

A registered type may provide:

- **Hooks** — called during editing, inside the same atomic change:
  - `onCreate` — e.g. a scene auto-attaches its label-block child here
  - `onEdgeAdded` / `onEdgeRemoved` — e.g. a branch-split notices it gained
    or lost a branch and restructures or removes itself
  - `validate` — report warnings/errors about its own node
- **Containment rules** — which types it may contain (an act holds scenes).
  Checked when the types are present; advisory otherwise.
- **A data shape** — documentation/validation for its `data` payload.

The library itself contains **no domain behavior**: no branching logic, no
connection limits, no auto-inserted nodes. All of that is consumer code built
from the hooks. (The previous spec had the library trigger branch insertion
via port capacity — removed. Ports — removed. The hooks are sufficient.)

---

## 4. The portability promise

A saved graph **must load in a project that has none of its types installed**.
Unknown types are kept, flagged, and round-tripped untouched — never dropped,
never fatal. This is why `type` is metadata, why `data` is opaque, and why
validity (§7) depends only on structure.

---

## 5. Editing behavior

- **Atomic changes.** Every edit either fully applies — hooks run, rules
  checked — or the document is untouched. A hook that throws cannot leave a
  half-modified graph.
- **Three levels of removal:**
  1. **detach** — parked, wiring preserved, children go with it; reattachable
  2. **disconnect** — its edges are removed
  3. **purge** — permanent; refused while the node still has edges or children
- Change notification for renderers: **deferred** for now.

---

## 6. Plugin slots (`ext`)

Namespaced blocks on the document, on nodes, and on edges that the library
stores and returns byte-for-byte without reading. This is where an importer
parks constructs it cannot map, and where other tools attach their own data.

---

## 7. What the library enforces (the invariants)

Small on purpose — only structure:

1. A record's map key equals its `id`.
2. Every edge endpoint refers to an existing node.
3. `parent` chains are acyclic and end at null.
4. A `meta` reference, when present, resolves to an existing metadata record.
   (Metadata records nothing references are orphans — harmless, sweepable.)
5. A purge is refused while edges or children remain.
6. Detached wiring is preserved, never silently dropped.

Everything else — containment rules, payload shapes, "a split should have two
branches" — is type-level and advisory: warnings from `validate` hooks, not
structural failures.

---

## 8. Mermaid, at the boundary

**Each Mermaid graph type gets its own adapter** — one for flowchart, one for
sequence diagrams, one for ER — because the three are genuinely different
languages that happen to share a file extension. Each adapter translates its
dialect to and from this shape independently; adding a fourth dialect (or a
non-Mermaid format) is a new adapter, touching nothing else. All Mermaid
knowledge lives inside the adapters:

- Mermaid's node ids land in labels/metadata; our `id`s are always generated.
- Shape brackets map to type names via an adapter-owned table.
- Subgraphs map to containment; boundary-crossing edges import as-is.
- Labeled branch arrows map to edge labels ("yes"/"no").
- Unmappable constructs are parked in `ext` and reported, never dropped.

Export is the reverse and is allowed to be lossy toward Mermaid (payloads and
coordinates have no Mermaid syntax); the JSON is the source of truth.

**Adapters are deferred, but they discipline the shape now.** An adapter is
deliberately the library's *first ordinary consumer*: it must be buildable
using only the same public operations any frontend uses — create a node,
connect two nodes, set metadata — with no privileged access to internals. If
writing an importer ever requires a back door, the public API is wrong, not
the importer. The shape already carries the importer's requirements:

- ids are always generated; foreign identifiers ride in labels/metadata
- untyped nodes are legal, so a parser can build structure before semantics
- edges have `parent` and `rank`, so grouped/ordered constructs (a sequence
  diagram's blocks and message order) have somewhere to land
- `ext` parks anything unmappable, so no import ever silently drops content

---

## 9. Explicitly out

- Ports and port capacity/arity — removed; edge labels cover it.
- Portal nodes and the "edges may not cross a subgraph boundary" rule — removed.
- Library-triggered branch insertion — removed; consumer hooks.
- Import provenance (source line tracking) — dropped.
- Undo/redo, edit history, change attribution.
- Concurrent/multi-user editing.
- Cross-document links.
- Rendering anything: shapes, colors, components, layout.

---

## 10. Settled decisions

Recorded so the reasoning isn't lost:

1. **Metadata is a parallel collection with explicit references.** Metadata
   records have their own ids; nodes and edges point at them via `meta`.
   Chosen over a block-on-the-record for the sharing and swapping it enables;
   costs one extra invariant (§7.4) and the possibility of orphans.
2. **Visibility is resolved by the library, drawn by the renderer.**
   Given `collapsed`, which nodes are visible and which ancestor stands in
   for a hidden one are graph/metadata reads with no pixels involved, so
   they live in `lib/` (`visibleNodes`, `visibleAncestorOf`). Placing
   anything on screen from that — layout, how a redirected edge is drawn —
   stays renderer logic. (Revised from an earlier draft of this decision,
   which drew the line one function higher, at the renderer.)
3. **Edge metadata is `label`, `style`, `curvature`.**
4. **One adapter per Mermaid dialect**, not one adapter with three branches.
5. **No ports.** Node-to-node edges with labels; branch discrimination lives
   on the edge label.
6. **No library-side branching triggers, no capacity/arity.** Type hooks are
   the extension mechanism; consumers own all such behavior.
7. **Change notification is deferred.**
8. **Import provenance is dropped.**
