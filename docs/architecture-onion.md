# Onion architecture for the graph editor

Companion to `graph-model-design.md`. That document defines *what the model is*; this one defines *where each piece lives* and which direction dependencies are allowed to run.

---

## 1. The one rule

**Dependencies point inward. Always.** An outer ring may reference an inner ring; an inner ring may never reference an outer one. Where the domain needs something from the outside — storage, a parser, a clock — it declares an **interface it owns**, and an outer ring implements it. That is dependency inversion, and it is the entire mechanism by which the domain stays clean.

The practical test: **the domain package must compile and its tests must pass with every other package deleted.** If removing the Mermaid adapter breaks the domain, the arrow is pointing the wrong way.

Note how well this fits what you already asked for. "The editor must be agnostic to the data" and "outer rings depend on inner abstractions, never concretions" are the same sentence. The node type registry is the injected configuration that makes it true.

---

## 2. Ring map

| Ring | Contains | May depend on |
|---|---|---|
| **1. Domain model** | `Node`, `Edge`, `Port`, `GraphDocument` (aggregate root). Value objects: `NodeId`, `EdgeId`, `Endpoint`, `Rank`, `Key`, `TypeRef`, `LifecycleState`, `Arity`, `Cardinality`, `EdgeStyle`. Core invariants INV-1 to INV-4, INV-6 to INV-8, INV-11. | Nothing. Zero third-party imports. |
| **2. Domain services** | `TopologyIndex`, `ContainmentService`, `LifecycleService`, `RankingService`, `PortalBindingService`, `BranchInsertionPolicy`, `RulesetValidator` (INV-5, INV-9, INV-10). Port *interfaces*. | Ring 1. |
| **3. Application services** | Use cases, one per operation: `ImportDiagram`, `CreateNode`, `ConnectNodes`, `ReparentNode`, `DetachNode`, `AttachNode`, `DisconnectNode`, `PurgeNode`, `ValidateDocument`, `SetPresentation`. Orchestration and atomic write boundaries. | Rings 1–2. |
| **4. Infrastructure, presentation, tests** | JSON Schema validator, JSON serialiser, Mermaid import adapter, repositories, view store, id/rank/clock adapters, HTTP controllers, presentation adapter, layout adapter, renderer bindings, test suites. | Rings 1–3. |

---

## 3. What moves, relative to the current design doc

Restructuring surfaces three things the flat design left ambiguous. Two are corrections.

### 3.1 The JSON Schema is infrastructure, not the domain model

`graph-document.schema.json` describes **one serialisation of the aggregate**, not the aggregate itself. In Onion terms it belongs in ring 4, alongside the serialiser that uses it, and it validates at the boundary — on deserialise in, on serialise out.

This matters because the domain's invariants are richer than any schema can express. JSON Schema cannot state "parent chains are acyclic" or "port direction must be compatible". Those live as code in ring 1, enforced in constructors and mutator methods so an invalid `GraphDocument` is unconstructable. The schema is a cheap outer guard against malformed input, not the definition of validity.

Consequence: the domain must be expressible with no JSON at all. `Node` is a class with typed fields, not a decoded associative array. Deserialisation is a mapping step in ring 4.

### 3.2 There is no mutation log

An earlier draft proposed JSON Patch as a mutation log feeding an undo stack. Undo, redo and change attribution are now explicitly out of scope, so the whole mechanism is gone: no patch format, no domain events, no event-to-patch translator, no event publisher port.

What replaces it is the simplest thing that works. A ring-3 use case loads the aggregate, calls methods on it, and saves it. The entity enforces its invariants during those calls, so an invalid document is never constructed and never persisted.

The one property to preserve is **atomicity**: invariants span records, so a save either fully applies or does not apply. That is a repository concern in ring 4, satisfied by writing the document as a unit.

If undo is ever wanted, the id-keyed maps make a structural diff easy to add as a ring-4 concern at that point. Nothing in rings 1–3 should anticipate it.

### 3.3 The `view` separation becomes structural

D9 separated presentation into a parallel collection. Onion turns that from a convention into a boundary: `ViewStore` is a **distinct port with a distinct adapter**, and rings 1 and 2 contain no geometry type at all — no `x`, no `collapsed`, no `lockChildren`.

`SetPresentation` is a ring-3 use case that talks only to `ViewStore`. It never loads the document, which is exactly why dragging a node cannot dirty a Scene's prose.

This is a good sign about D9. Onion would have forced the same split on first principles, which suggests the earlier decision was structural rather than stylistic.

---

## 4. Ports the domain owns

Declared in ring 2, implemented in ring 4. Named for what the domain needs, not for the technology that satisfies it — `DiagramSourceParser`, never `MermaidClient`.

| Port | Purpose | Typical adapter |
|---|---|---|
| `DocumentRepository` | Load and persist a `GraphDocument` aggregate | Postgres, filesystem, S3 |
| `ViewStore` | Load and persist presentation, keyed by node id | Same database, separate table, or per-user store |
| `NodeTypeRegistry` | Resolve a `TypeRef` to a `NodeTypeSpec` — ports, arity, `allowsChildren`, `allowedChildTypes`, ruleset | JSON file loader, cached |
| `DiagramSourceParser` | Foreign diagram text to a provisional domain graph | Mermaid Node sidecar; later Graphviz, PlantUML |
| `IdGenerator` | Mint `NodeId` / `EdgeId` | ULID or UUIDv7 library |
| `RankGenerator` | Fractional index between two ranks | `fractional-indexing` or a LexoRank port |
| `Clock` | Timestamps on `meta` | System clock; fixed clock in tests |
| `LayoutEngine` | Assign coordinates to unplaced nodes | Any graph-layout library; **ring 4 only, never a domain signature** |

`LayoutEngine` is the interesting exclusion. Layout produces geometry, geometry is presentation, and the domain has no geometry type — so layout never appears in a domain signature. It is a ring-4 collaborator of the renderer and of `SetPresentation`.

### The registry, which is the awkward one

`NodeTypeRegistry` is data authored as JSON in the outer world, yet ring 2 needs it to check arity and containment rules. Resolution:

- Ring 2 defines the interface and the domain-typed return: `NodeTypeSpec { ports: Map<PortId, PortSpec>, allowsChildren: bool, allowedChildTypes: TypeRef[], dataSchema: opaque }`.
- Ring 4 implements it by loading `node-types.registry.json`, resolving `extends` chains, and mapping into those domain types.
- **Renderer bindings are not in this file at all.** Which widget or icon draws a type is ring-4 data in a ring-4 file, reached through a separate `RendererBindings` interface that only the presentation adapter implements.

An earlier draft had `component` and `icon` inside the registry. That was ring-4 data sharing a file with ring-2 data, and it is why those fields felt wrong the moment portability came up: a backend service resolving port arity had to load configuration describing a user interface it does not have. They are now removed. The Mermaid bracket and arrow tables moved out for the same reason, into `mermaid-import.map.json` owned by the import adapter.

`dataSchema` stays opaque inward. Ring 1 never validates `node.data` — that is delegated to a ring-4 validator and to whatever renders the type. The domain's contract is "`data` is an opaque map", which is what makes the model data-agnostic in the first place.

---

## 5. The Mermaid importer is an anti-corruption layer

Textbook case. Mermaid's model is genuinely foreign: global id scope, boundary-crossing edges, shape semantics encoded in bracket characters, whitespace-significant mindmaps. None of it may leak inward.

`ImportDiagram` (ring 3) orchestrates:

1. `DiagramSourceParser` (ring 4) parses text and returns a **provisional graph in domain terms** — the adapter, not the domain, owns bracket-to-`TypeRef` translation via the registry's `shapeMatchOrder`.
2. `ContainmentService` assigns `parent` from subgraph membership.
3. `PortalBindingService` finds boundary-crossing edges and inserts `core.portal` nodes, splitting each into level-local segments (INV-5).
4. `RulesetValidator` applies kind rules.
5. `DocumentRepository` persists. `ViewStore` receives **nothing** — a fresh import has no coordinates, so the layout engine places everything on first render.
6. Warnings return to the caller for the import summary.

The one deliberate leak is `source` provenance — raw substrings, line numbers, the original text. It is inert data the domain never interprets, which is the only reason it is acceptable inward. If you ever find domain logic branching on `source.raw`, the anti-corruption layer has failed.

---

## 6. Directory layout

```
packages/
  domain/                        ring 1 — no dependencies whatsoever
    Entity/         Node  Edge  Port  GraphDocument
    ValueObject/    NodeId  EdgeId  Endpoint  Rank  Key  TypeRef
                    LifecycleState  Arity  Cardinality  EdgeStyle
    Exception/      InvariantViolation  PortIncompatible  CycleDetected

  domain-service/                ring 2 — depends on domain only
    TopologyIndex        ContainmentService     LifecycleService
    RankingService       PortalBindingService   BranchInsertionPolicy
    RulesetValidator
    Port/           DocumentRepository  ViewStore  NodeTypeRegistry
                    DiagramSourceParser  IdGenerator  RankGenerator
                    Clock  EventPublisher

  application/                   ring 3 — depends on rings 1-2
    UseCase/        ImportDiagram  CreateNode  ConnectNodes  ReparentNode
                    DetachNode  AttachNode  DisconnectNode  PurgeNode
                    ValidateDocument  SetPresentation
    Event/          NodeDetached  EdgeConnected  NodeReparented …

  infrastructure/                ring 4
    Persistence/    PostgresDocumentRepository  PostgresViewStore
    Serialization/  JsonDocumentSerializer  graph-document.schema.json
    Registry/       JsonNodeTypeRegistry  node-types.registry.json
    Mermaid/        MermaidSidecarParser  mermaid-import.map.json
    Support/        UlidGenerator  LexoRankGenerator  SystemClock

  http/                          ring 4 — controllers, DTOs
  presentation/                  ring 4 — renderer bindings, layout adapter, UI
```

Three notes on placement. `graph-document.schema.json` sits beside its serialiser rather than at the root, because that is where its one consumer lives — the physical location makes §3.1 hard to forget. `mermaid-import.map.json` sits inside `Mermaid/` for the same reason: it is the adapter's lookup table, and nothing above ring 4 may read it. And `node-types.registry.json` sits in `infrastructure/Registry/` even though ring 2 depends on the *interface*, which is the normal Onion asymmetry: interface inward, data and implementation outward.

Note also what `presentation/` is not: it is a sibling of `http/`, one adapter among several, with no privileged position. Swapping it out touches exactly one directory. Nothing in rings 1–3 names it.

---

## 7. Enforce the rule mechanically

Layer discipline that is not machine-checked decays within a quarter. Both of your runtimes have tooling.

**PHP — `qossmic/deptrac`:**

```yaml
deptrac:
  paths: [./packages]
  layers:
    - name: Domain
      collectors: [{ type: directory, value: packages/domain/.* }]
    - name: DomainService
      collectors: [{ type: directory, value: packages/domain-service/.* }]
    - name: Application
      collectors: [{ type: directory, value: packages/application/.* }]
    - name: Infrastructure
      collectors: [{ type: directory, value: packages/(infrastructure|http)/.* }]
  ruleset:
    Domain: ~                                  # depends on nothing
    DomainService: [Domain]
    Application: [Domain, DomainService]
    Infrastructure: [Domain, DomainService, Application]
```

`Domain: ~` is the load-bearing line: an empty ruleset means any outbound dependency from ring 1 fails the build.

**JS/TS — `dependency-cruiser`:**

```js
forbidden: [
  { name: 'domain-is-pure',
    from: { path: '^packages/domain/' },
    to:   { pathNot: '^packages/domain/' } },
  { name: 'no-inward-from-infra',
    from: { path: '^packages/(domain|domain-service)/' },
    to:   { path: '^packages/(infrastructure|http|presentation)/' } },
  { name: 'no-layout-libs-inward',
    from: { path: '^packages/(domain|domain-service)/' },
    to:   { dependencyTypes: ['npm'] } }
]
```

Run both in CI. The third rule is the blunt version of "ring 1 and 2 have no third-party dependencies at all" — no layout library, no validator, no id generator. That is stricter than most codebases need, and it is exactly the guarantee that makes the domain portable: a package with zero npm or Composer dependencies cannot be coupled to a rendering stack by accident.

---

## 8. What this buys, concretely

- **Ring 1 tests need no mocks and no fixtures.** Construct a `GraphDocument`, attempt an illegal edge, assert it throws. No database, no schema file, no framework bootstrap. These are the tests you will run thousands of times a day.
- **Ring 2 tests need in-memory fakes only** — an array-backed `DocumentRepository` is about fifteen lines.
- **The presentation question answers itself.** Any renderer is one ring-4 adapter beside the HTTP controllers, with no privileged position. Replacing it touches one package, and rings 1–3 do not name it. This is the structural version of the portability audit in §19 of the design doc.
- **The importer is replaceable.** Adding PlantUML means one new `DiagramSourceParser` adapter and zero changes to rings 1–3.
- **Per-user layout becomes a swapped adapter,** because `ViewStore` was already a separate port.

## 9. Costs, stated plainly

Onion is not free and it is worth naming the price before you commit.

- **Mapping code.** JSON to domain objects and back, by hand or via a mapper. Real, unavoidable, and the main tax.
- **More files, more indirection.** A single node rename touches a use case, an entity method, a repository call and a controller. For a CRUD screen this would be absurd overhead; for a graph model with eleven cross-record invariants and three foreign import formats it pays.
- **The registry straddles rings** and needs two interfaces onto one file (§4). Slightly awkward no matter how you arrange it.
- **Temptation to leak for performance.** Loading a whole aggregate to move one node is wasteful, which is exactly why `SetPresentation` bypasses the document entirely and talks to `ViewStore` alone. Expect two or three more such carve-outs, and make each one an explicit, named use case rather than a quiet shortcut.

If your graph documents stay small and single-user, a simpler layered arrangement — domain plus services plus adapters, three rings — captures most of the benefit. The full four-ring split earns its keep once you have concurrent editors, a second import format, or a second consumer.
