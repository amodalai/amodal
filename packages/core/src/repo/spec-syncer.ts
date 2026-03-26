/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedConnection} from './connection-types.js';
import type {ParsedEndpoint} from './openapi-parser.js';
import type {SurfaceEndpoint} from './connection-types.js';
import type {EndpointChange} from './drift-detector.js';
import {fetchAndParseSpec} from './openapi-parser.js';
import {detectDrift} from './drift-detector.js';
import {fetchAndParseGraphQLSchema} from './graphql-parser.js';
import {detectGraphQLDrift} from './graphql-drift-detector.js';

export interface SyncPlan {
  connectionName: string;
  added: Array<ParsedEndpoint | {name: string; operationType: string}>;
  removed: SurfaceEndpoint[];
  changed: Array<EndpointChange | {name: string; operationType: string; changes: string[]}>;
  unchanged: string[];
}

/**
 * Build a sync plan for a connection by fetching its spec
 * and comparing against the current surface endpoints.
 *
 * Supports OpenAPI and GraphQL connections.
 */
export async function buildSyncPlan(connection: LoadedConnection): Promise<SyncPlan> {
  if (connection.spec.format === 'graphql') {
    return buildGraphQLSyncPlan(connection);
  }

  // Only sync OpenAPI connections
  if (connection.spec.format !== 'openapi') {
    return {
      connectionName: connection.name,
      added: [],
      removed: [],
      changed: [],
      unchanged: connection.surface.map((ep) => `${ep.method} ${ep.path}`),
    };
  }

  // Derive spec URL from the source base URL
  const baseUrl = connection.spec.source.replace(/\/$/, '');
  const specUrl = `${baseUrl}/openapi.json`;

  // Build auth for the spec fetch
  let auth: {header: string; value: string} | undefined;
  if (connection.spec.auth) {
    const token = connection.spec.auth.token ?? '';
    if (connection.spec.auth.type === 'bearer') {
      auth = {
        header: connection.spec.auth.header ?? 'Authorization',
        value: `${connection.spec.auth.prefix ?? 'Bearer'} ${token}`,
      };
    } else if (connection.spec.auth.type === 'api-key') {
      auth = {
        header: connection.spec.auth.header ?? 'X-API-Key',
        value: token,
      };
    }
  }

  const specEndpoints = await fetchAndParseSpec(specUrl, auth);

  // Only compare included surface endpoints
  const includedSurface = connection.surface.filter((ep) => ep.included);

  const drift = detectDrift(specEndpoints, includedSurface);

  return {
    connectionName: connection.name,
    ...drift,
  };
}

async function buildGraphQLSyncPlan(connection: LoadedConnection): Promise<SyncPlan> {
  const baseUrl = connection.spec.source.replace(/\/$/, '');

  let auth: {header: string; value: string} | undefined;
  if (connection.spec.auth) {
    const token = connection.spec.auth.token ?? '';
    if (connection.spec.auth.type === 'bearer') {
      auth = {
        header: connection.spec.auth.header ?? 'Authorization',
        value: `${connection.spec.auth.prefix ?? 'Bearer'} ${token}`,
      };
    } else if (connection.spec.auth.type === 'api-key') {
      auth = {
        header: connection.spec.auth.header ?? 'X-API-Key',
        value: token,
      };
    }
  }

  const schemaOps = await fetchAndParseGraphQLSchema(baseUrl, auth);
  const includedSurface = connection.surface.filter((ep) => ep.included);
  const drift = detectGraphQLDrift(schemaOps, includedSurface);

  return {
    connectionName: connection.name,
    ...drift,
  };
}
