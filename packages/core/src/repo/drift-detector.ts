/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ParsedEndpoint} from './openapi-parser.js';
import type {SurfaceEndpoint} from './connection-types.js';

export interface EndpointChange {
  endpoint: string;
  changes: string[];
}

export interface DriftResult {
  /** Endpoints in the spec but not in the surface */
  added: ParsedEndpoint[];
  /** Endpoints in the surface but not in the spec */
  removed: SurfaceEndpoint[];
  /** Endpoints in both but with differences */
  changed: EndpointChange[];
  /** Endpoint keys that match and have no drift */
  unchanged: string[];
}

/**
 * Compare parsed OpenAPI spec endpoints against surface endpoint definitions.
 * Returns a drift result showing added, removed, changed, and unchanged endpoints.
 */
export function detectDrift(
  specEndpoints: ParsedEndpoint[],
  surfaceEndpoints: SurfaceEndpoint[],
): DriftResult {
  // Build lookup maps
  const specMap = new Map<string, ParsedEndpoint>();
  for (const ep of specEndpoints) {
    specMap.set(endpointKey(ep.method, ep.path), ep);
  }

  const surfaceMap = new Map<string, SurfaceEndpoint>();
  for (const ep of surfaceEndpoints) {
    surfaceMap.set(endpointKey(ep.method, ep.path), ep);
  }

  const added: ParsedEndpoint[] = [];
  const removed: SurfaceEndpoint[] = [];
  const changed: EndpointChange[] = [];
  const unchanged: string[] = [];

  // Check for added/changed endpoints (in spec but not in surface, or different)
  for (const [key, specEp] of specMap) {
    const surfaceEp = surfaceMap.get(key);
    if (!surfaceEp) {
      added.push(specEp);
      continue;
    }

    // Compare
    const changes = compareEndpoints(specEp, surfaceEp);
    if (changes.length > 0) {
      changed.push({endpoint: key, changes});
    } else {
      unchanged.push(key);
    }
  }

  // Check for removed endpoints (in surface but not in spec)
  for (const [key, surfaceEp] of surfaceMap) {
    if (!specMap.has(key)) {
      removed.push(surfaceEp);
    }
  }

  return {added, removed, changed, unchanged};
}

function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Compare a spec endpoint with a surface endpoint and return a list of changes.
 */
function compareEndpoints(spec: ParsedEndpoint, surface: SurfaceEndpoint): string[] {
  const changes: string[] = [];

  // Check deprecation
  if (spec.deprecated) {
    changes.push('deprecated in spec');
  }

  // Check description/summary changes
  if (spec.summary && surface.description && spec.summary !== surface.description) {
    changes.push('description updated');
  }

  return changes;
}
