/* lib/index.js — the library's public surface.
 *
 *   import GraphKit, { Graph, TypeRegistry, ops } from 'graph-node-draft';
 */
export { newId } from './model/ids.js';
export { Node, NodeFactory } from './model/Node.js';
export { Edge, EdgeFactory } from './model/Edge.js';
export { MetadataFactory } from './model/Metadata.js';
export { createDocument, documentFromJSON, DocumentFactory } from './model/Document.js';
export { BaseNodeType } from './model/BaseNodeType.js';
export { rankBetween, nextRank, RankingService } from './services/RankingService.js';
export { TypeRegistry } from './services/TypeRegistry.js';
export { TopologyService } from './services/TopologyService.js';
export { Graph } from './Graph.js';
export { MutationContext } from './services/MutationContext.js';
export { validateDoc, validateDoc as validate, ValidationService } from './services/ValidationService.js';
export { ops, OperationsService } from './services/OperationsService.js';

import { newId } from './model/ids.js';
import { Node, NodeFactory } from './model/Node.js';
import { Edge, EdgeFactory } from './model/Edge.js';
import { MetadataFactory } from './model/Metadata.js';
import { createDocument, documentFromJSON, DocumentFactory } from './model/Document.js';
import { BaseNodeType } from './model/BaseNodeType.js';
import { rankBetween, nextRank, RankingService } from './services/RankingService.js';
import { TypeRegistry } from './services/TypeRegistry.js';
import { TopologyService } from './services/TopologyService.js';
import { Graph } from './Graph.js';
import { MutationContext } from './services/MutationContext.js';
import { validateDoc, ValidationService } from './services/ValidationService.js';
import { ops, OperationsService } from './services/OperationsService.js';

/** The whole library as one object, for consumers that prefer a namespace. */
const GraphKit = {
  newId,
  rankBetween,
  nextRank,
  createDocument,
  documentFromJSON,
  BaseNodeType,
  TypeRegistry,
  Graph,
  ops,
  validate: validateDoc,
  DocumentFactory,
  Node,
  NodeFactory,
  Edge,
  EdgeFactory,
  MetadataFactory,
  RankingService,
  TopologyService,
  MutationContext,
  ValidationService,
  OperationsService
};

export default GraphKit;
