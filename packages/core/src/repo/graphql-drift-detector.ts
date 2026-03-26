/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ParsedGraphQLOperation} from './graphql-parser.js';
import type {SurfaceEndpoint} from './connection-types.js';

export interface GraphQLDriftResult {
  added: ParsedGraphQLOperation[];
  removed: SurfaceEndpoint[];
  changed: GraphQLOperationChange[];
  unchanged: string[];
}

export interface GraphQLOperationChange {
  name: string;
  operationType: string;
  changes: string[];
}

/**
 * Detect drift between a parsed GraphQL schema and a surface definition.
 *
 * - Added: in schema but not in surface
 * - Removed: in surface but not in schema
 * - Changed: in both but with differences (e.g., description changed)
 * - Unchanged: in both with no differences
 */
export function detectGraphQLDrift(
  schemaOps: ParsedGraphQLOperation[],
  surfaceEndpoints: SurfaceEndpoint[],
): GraphQLDriftResult {
  const schemaMap = new Map<string, ParsedGraphQLOperation>();
  for (const op of schemaOps) {
    schemaMap.set(operationKey(op.operationType, op.name), op);
  }

  const surfaceMap = new Map<string, SurfaceEndpoint>();
  for (const ep of surfaceEndpoints) {
    surfaceMap.set(operationKey(ep.method, ep.path), ep);
  }

  const added: ParsedGraphQLOperation[] = [];
  const changed: GraphQLOperationChange[] = [];
  const unchanged: string[] = [];

  for (const [key, op] of schemaMap) {
    const surface = surfaceMap.get(key);
    if (!surface) {
      added.push(op);
    } else {
      const changes = compareOperation(op, surface);
      if (changes.length > 0) {
        changed.push({
          name: op.name,
          operationType: op.operationType,
          changes,
        });
      } else {
        unchanged.push(key);
      }
    }
  }

  const removed: SurfaceEndpoint[] = [];
  for (const [key, ep] of surfaceMap) {
    if (!schemaMap.has(key)) {
      removed.push(ep);
    }
  }

  return {added, removed, changed, unchanged};
}

function operationKey(operationType: string, name: string): string {
  return `${operationType.toUpperCase()} ${name}`;
}

function compareOperation(
  schemaOp: ParsedGraphQLOperation,
  surfaceEp: SurfaceEndpoint,
): string[] {
  const changes: string[] = [];

  // Compare descriptions (if both present)
  if (
    schemaOp.description &&
    surfaceEp.description &&
    schemaOp.description !== surfaceEp.description
  ) {
    changes.push('description changed');
  }

  return changes;
}
