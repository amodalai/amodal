/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AccessConfig, ConnectionSpec} from './connection-schemas.js';

/**
 * A parsed endpoint from surface.md.
 */
export interface SurfaceEndpoint {
  method: string;
  path: string;
  description: string;
  included: boolean;
  /** For GraphQL connections: 'query' | 'mutation' | 'subscription' */
  operationType?: 'query' | 'mutation' | 'subscription';
}

/**
 * A fully loaded connection with all parsed components.
 */
export interface LoadedConnection {
  name: string;
  spec: ConnectionSpec;
  access: AccessConfig;
  surface: SurfaceEndpoint[];
  entities?: string;
  rules?: string;
  location: string;
}
