/* core/index.js — the library's public surface.
 *
 * One import path for everything:
 *
 *   import GraphCore, { Graph, TypeRegistry, ops } from 'graph-node-draft';
 */
export { newId } from './model/ids.js';
export { PortFactory } from './model/port.js';
export { NodeFactory } from './model/node.js';
export { EdgeFactory } from './model/edge.js';
export { createDocument, DocumentFactory } from './model/document.js';
export { BaseNodeType } from './model/base-node-type.js';
export { rankBetween, nextRank, RankingService } from './services/ranking.js';
export { TypeRegistry } from './services/registry.js';
export { TopologyService } from './services/topology.js';
export { Graph } from './graph.js';
export { MutationContext } from './services/mutation.js';
export { validateDoc, validateDoc as validate, ValidationService } from './services/validation.js';
export { ops, OperationsService } from './services/ops.js';

import { newId } from './model/ids.js';
import { PortFactory } from './model/port.js';
import { NodeFactory } from './model/node.js';
import { EdgeFactory } from './model/edge.js';
import { createDocument, DocumentFactory } from './model/document.js';
import { BaseNodeType } from './model/base-node-type.js';
import { rankBetween, nextRank, RankingService } from './services/ranking.js';
import { TypeRegistry } from './services/registry.js';
import { TopologyService } from './services/topology.js';
import { Graph } from './graph.js';
import { MutationContext } from './services/mutation.js';
import { validateDoc, ValidationService } from './services/validation.js';
import { ops, OperationsService } from './services/ops.js';

/** The whole library as one object, for consumers that prefer a namespace. */
const GraphCore = {
  newId,
  rankBetween,
  nextRank,
  createDocument,
  BaseNodeType,
  TypeRegistry,
  Graph,
  ops,
  validate: validateDoc,
  DocumentFactory,
  NodeFactory,
  EdgeFactory,
  PortFactory,
  RankingService,
  TopologyService,
  MutationContext,
  ValidationService,
  OperationsService
};

export default GraphCore;
