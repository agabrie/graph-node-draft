/**
 * REFERENCE CUSTOM NODE — Branch split
 *
 * This file lives in the CONSUMING PROJECT, not in the graph-node library.
 *
 * The split is the canonical example of a node type that sits outside anything
 * the library understands. The library knows nothing about branching, fan-out,
 * auto-insertion or auto-collapse. It only knows:
 *
 *   - a port declares a capacity
 *   - when a connection would exceed that capacity, ask a registered handler
 *   - node types may react to their own edges changing
 *   - all mutations are staged and applied atomically
 *
 * Everything else below is project code. If this file is deleted, the library
 * still works — connections that exceed capacity are simply refused.
 *
 * Writing this was the audit: the four capabilities in `MutationContext` marked
 * REQUIRED are exactly what the library must expose for a type like this to be
 * implementable from outside. Nothing more was needed.
 */

/* ------------------------------------------------------------------ *
 * Library surface this file depends on.
 * In real use these come from the library package; declared here so the
 * example is self-contained and type-checkable on its own.
 * ------------------------------------------------------------------ */

type NodeId = string;
type EdgeId = string;
type PortId = string;

type Direction = 'in' | 'out' | 'inout';

interface PortSpec {
  direction: Direction;
  label?: string;
  /** null means unbounded. Renamed from `arity` — same thing, plainer word. */
  capacity: number | null;
  role?: string;
}

interface ResolvedPort extends PortSpec {
  id: PortId;
}

interface Endpoint {
  node: NodeId;
  port: PortId;
}

interface EdgeRecord {
  id: EdgeId;
  from: Endpoint;
  to: Endpoint;
  parent: NodeId | null;
  state: 'active' | 'detached';
}

interface NodeRecord {
  id: NodeId;
  type: string;
  label?: string;
  parent: NodeId | null;
  state: 'active' | 'detached';
  data: Record<string, unknown>;
  ext?: Record<string, unknown>;
}

/** Describes a connection the library was asked to make but could not. */
interface OverflowAttempt {
  source: Endpoint;
  target: Endpoint;
  edgeType: string;
}

interface TypeDescriptor {
  allowsChildren: boolean;
  ports: Record<PortId, PortSpec>;
  dataSchema?: Record<string, unknown>;
  /** Type name to consult when an out-port of this type overflows. */
  onOverflow?: string;
}

/**
 * Every mutation goes through this. Nothing is applied until all hooks have
 * returned and the library has re-checked its invariants, so a hook that throws
 * leaves the document untouched rather than half-written.
 */
interface MutationContext {
  // --- reads ---
  node(id: NodeId): NodeRecord;
  parentOf(id: NodeId): NodeId | null;
  childCount(id: NodeId): number;
  portsOf(id: NodeId): ResolvedPort[];
  activeEdgesTo(id: NodeId): EdgeRecord[];
  activeEdgesFrom(id: NodeId): EdgeRecord[];
  activeEdgesFromPort(id: NodeId, port: PortId): EdgeRecord[];
  edgesFromEndpoint(e: Endpoint): EdgeRecord[];
  hasDetachedEdges(id: NodeId): boolean;

  // --- writes ---
  createNode(spec: {
    type: string;
    label?: string;
    parent: NodeId | null;
    data?: Record<string, unknown>;
    ports?: Record<PortId, PortSpec>;
  }): NodeId;
  createEdge(spec: { type?: string; from: Endpoint; to: Endpoint; label?: string }): EdgeId;

  /** REQUIRED for insertion and collapse. Moves one end of an existing edge. */
  retargetEdge(id: EdgeId, to: Endpoint): void;
  removeEdge(id: EdgeId): void;

  /** REQUIRED for a variable number of outputs. Instance-level port mutation. */
  addPort(id: NodeId, port: PortId, spec: PortSpec): void;
  removePort(id: NodeId, port: PortId): void;

  /** REQUIRED for collapse. Removes this node and joins its neighbours. */
  spliceSelf(): void;
  /** REQUIRED for collapse. Removes this node and any edges still touching it. */
  removeSelfAndEdges(): void;

  warn(message: string): void;
}

interface ValidationIssue {
  level: 'warn' | 'error';
  message: string;
  nodeId?: NodeId;
}

/** Base class provided by the library. Subclass it; register the subclass. */
declare abstract class BaseNodeType {
  static type: string;
  static label: string;
  static describe(): TypeDescriptor;

  readonly id: NodeId;
  readonly data: Record<string, unknown>;
  readonly ext?: Record<string, unknown>;

  onCreate?(ctx: MutationContext): void;
  onEdgeAdded?(ctx: MutationContext, edge: EdgeRecord): void;
  onEdgeRemoved?(ctx: MutationContext, edge: EdgeRecord): void;
  onBeforePurge?(ctx: MutationContext): boolean;
  validate?(ctx: MutationContext): ValidationIssue[];
}

declare const registry: {
  register(...types: Array<typeof BaseNodeType>): void;
};

/* ------------------------------------------------------------------ *
 * PROJECT CODE STARTS HERE
 * ------------------------------------------------------------------ */

type SplitOrigin = 'auto' | 'authored';

interface SplitData {
  /**
   * Whether the editor created this split to resolve an overflow, or the user
   * placed it deliberately. Only `auto` splits are removed automatically.
   * Defaults to `authored` so anything undeclared is treated as content.
   */
  origin?: SplitOrigin;
  /** Author-supplied branching condition. Its presence blocks auto-collapse. */
  condition?: string;
}

export class BranchSplitNode extends BaseNodeType {
  static type = 'project.branchSplit';
  static label = 'Branch split';

  static describe(): TypeDescriptor {
    return {
      // Universal in this model: any node may become a subgraph. A split that
      // gains children stops being machinery and becomes authored structure.
      allowsChildren: true,
      ports: {
        in: { direction: 'in', capacity: null },
        'out.0': { direction: 'out', capacity: 1 },
        'out.1': { direction: 'out', capacity: 1 },
      },
      dataSchema: {
        type: 'object',
        properties: {
          origin: { type: 'string', enum: ['auto', 'authored'], default: 'authored' },
          condition: { type: 'string' },
        },
      },
    };
  }

  private get splitData(): SplitData {
    return this.data as SplitData;
  }

  /* ---------------- insertion ---------------- */

  /**
   * Called by the library when a connection would exceed an out-port's
   * capacity, for any node type whose descriptor sets
   * `onOverflow: 'project.branchSplit'`.
   *
   * Return true if handled. Return false to let the library refuse the
   * connection as it would with no handler registered.
   */
  static handleOverflow(ctx: MutationContext, attempt: OverflowAttempt): boolean {
    const existing = ctx.edgesFromEndpoint(attempt.source);

    // Only the capacity-of-one case is ours. Anything else is not a fan-out
    // situation and the library should apply its normal refusal.
    if (existing.length !== 1) return false;

    const prior = existing[0];
    // Capture before retargeting, or we lose where the original edge pointed.
    const originalTarget: Endpoint = { ...prior.to };

    // Stay in the same container as the source, so the resulting edges remain
    // level-local and no boundary portals are needed.
    const split = ctx.createNode({
      type: BranchSplitNode.type,
      label: 'Branch',
      parent: ctx.parentOf(attempt.source.node),
      data: { origin: 'auto' } satisfies SplitData,
    });

    // Retarget rather than delete-and-recreate: the source port's occupancy is
    // unchanged, so its capacity cannot be violated part-way through.
    ctx.retargetEdge(prior.id, { node: split, port: 'in' });
    ctx.createEdge({ from: { node: split, port: 'out.0' }, to: originalTarget });
    ctx.createEdge({ from: { node: split, port: 'out.1' }, to: attempt.target });

    return true;
  }

  /* ---------------- growth ---------------- */

  /** Keep exactly one spare output so the user can always drag another branch. */
  onEdgeAdded(ctx: MutationContext, edge: EdgeRecord): void {
    if (edge.from.node !== this.id) return;

    const outs = ctx.portsOf(this.id).filter((p) => p.direction === 'out');
    const spare = outs.filter((p) => ctx.activeEdgesFromPort(this.id, p.id).length === 0);
    if (spare.length > 0) return;

    ctx.addPort(this.id, `out.${outs.length}`, { direction: 'out', capacity: 1 });
  }

  /* ---------------- collapse ---------------- */

  /**
   * A split that no longer branches is machinery with nothing to do. Remove it
   * and join its neighbours directly — the inverse of handleOverflow.
   *
   * Requests removal through ctx rather than deleting itself, so the library
   * applies it after all hooks have run.
   */
  onEdgeRemoved(ctx: MutationContext, _edge: EdgeRecord): void {
    if (!this.isCollapsible(ctx)) return;

    const ins = ctx.activeEdgesTo(this.id).length;
    const outs = ctx.activeEdgesFrom(this.id).length;

    if (ins === 1 && outs === 1) {
      ctx.spliceSelf();
    } else if (ins <= 1 && outs === 0) {
      ctx.removeSelfAndEdges();
    } else if (ins === 0) {
      ctx.removeSelfAndEdges();
    }
  }

  private isCollapsible(ctx: MutationContext): boolean {
    // The user never made this, so removing it is not destroying their work.
    if (this.splitData.origin !== 'auto') return false;

    // It became a real subgraph. That is authored structure, not machinery.
    if (ctx.childCount(this.id) > 0) return false;

    // Collapsing destroys an id. Any plugin data attached to it would vanish
    // silently, and the plugin has no way to know.
    if (this.ext && Object.keys(this.ext).length > 0) return false;

    // Detached means the user deliberately parked a connection for later.
    if (ctx.hasDetachedEdges(this.id)) return false;

    // Somebody typed a condition into it. That is intent.
    if (this.splitData.condition) return false;

    return true;
  }

  /* ---------------- lint ---------------- */

  /** Authored splits are never removed automatically, only reported. */
  validate(ctx: MutationContext): ValidationIssue[] {
    if (this.splitData.origin === 'auto') return [];

    const ins = ctx.activeEdgesTo(this.id).length;
    const outs = ctx.activeEdgesFrom(this.id).length;
    if (ins > 1 || outs > 1) return [];
    if (ctx.childCount(this.id) > 0) return [];

    return [{
      level: 'warn',
      nodeId: this.id,
      message: `Split has ${ins} in / ${outs} out and no children — it is not branching. Remove it?`,
    }];
  }
}

/* ------------------------------------------------------------------ *
 * Wiring. Any node type that should grow splits instead of refusing a
 * second connection points at this type in its own descriptor.
 * ------------------------------------------------------------------ */

export class SceneNode extends BaseNodeType {
  static type = 'project.scene';
  static label = 'Scene';

  static describe(): TypeDescriptor {
    return {
      allowsChildren: true,
      ports: {
        in: { direction: 'in', capacity: null },
        // Capacity of one is what makes a second connection overflow…
        out: { direction: 'out', capacity: 1 },
      },
      // …and this is what the library consults when it does.
      onOverflow: BranchSplitNode.type,
      dataSchema: {
        type: 'object',
        properties: {
          synopsis: { type: 'string' },
          prose: { type: 'string' },
        },
      },
    };
  }
}

registry.register(BranchSplitNode, SceneNode);

/* ------------------------------------------------------------------ *
 * What the library must guarantee for the above to be safe
 *
 * 1. Staging. createNode / createEdge / retargetEdge / addPort / spliceSelf all
 *    record intent. Nothing is visible to other hooks or persisted until the
 *    batch commits, so a throwing hook cannot leave a split half-inserted.
 *
 * 2. No hook re-entry within a batch. handleOverflow creates edges; those must
 *    not immediately re-fire onEdgeAdded on the same split mid-insertion.
 *    Hooks fire once, after the batch settles.
 *
 * 3. Capacity is checked once, after hooks. `out` is at capacity during
 *    handleOverflow by definition; the check must run on the committed result,
 *    not the intermediate state.
 *
 * 4. Unknown types are tolerated. A document containing project.branchSplit
 *    must still load in a runtime that has not registered this class — kept,
 *    flagged, and rendered with a fallback. Otherwise a backend or an older
 *    build cannot open the file.
 *
 * 5. Collapse is not undoable. There is no undo stack in this model, so the
 *    preconditions in isCollapsible are the only safety net. The mitigation is
 *    that the inverse is cheap: connect a second edge and a split reappears.
 * ------------------------------------------------------------------ */
