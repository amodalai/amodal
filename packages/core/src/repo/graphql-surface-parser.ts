/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {SurfaceEndpoint} from './connection-types.js';

type ParserState = 'scanning' | 'included' | 'excluded';

const GRAPHQL_HEADING_RE = /^###\s+(QUERY|MUTATION|SUBSCRIPTION)\s+(\S+)/;
const INCLUDED_HEADING_RE = /^##\s+Included/i;
const EXCLUDED_HEADING_RE = /^##\s+Excluded/i;

/**
 * Parse a GraphQL surface.md content into SurfaceEndpoint[].
 *
 * GraphQL operations use ### QUERY, ### MUTATION, ### SUBSCRIPTION headings
 * instead of HTTP method + path headings.
 *
 * The method field stores the operation type (QUERY, MUTATION, SUBSCRIPTION).
 * The path field stores the operation name.
 */
export function parseGraphQLSurface(content: string): SurfaceEndpoint[] {
  const lines = content.split('\n');
  const endpoints: SurfaceEndpoint[] = [];
  let state: ParserState = 'scanning';
  let hasIncludedSection = false;
  let currentEndpoint: SurfaceEndpoint | null = null;
  const descriptionLines: string[] = [];

  function flushEndpoint(): void {
    if (currentEndpoint) {
      currentEndpoint.description = descriptionLines.join('\n').trim();
      endpoints.push(currentEndpoint);
      descriptionLines.length = 0;
      currentEndpoint = null;
    }
  }

  for (const line of lines) {
    if (INCLUDED_HEADING_RE.test(line)) {
      flushEndpoint();
      state = 'included';
      hasIncludedSection = true;
      continue;
    }
    if (EXCLUDED_HEADING_RE.test(line)) {
      flushEndpoint();
      state = 'excluded';
      continue;
    }

    const gqlMatch = GRAPHQL_HEADING_RE.exec(line);
    if (gqlMatch) {
      flushEndpoint();
      const included = state !== 'excluded';
      currentEndpoint = {
        method: gqlMatch[1],
        path: gqlMatch[2],
        description: '',
        included,
      };
      continue;
    }

    if (currentEndpoint) {
      descriptionLines.push(line);
    }
  }

  flushEndpoint();

  // Same convention as REST: if no explicit Included section, all are included
  if (!hasIncludedSection) {
    // All endpoints already default to included
  }

  return endpoints;
}

/**
 * Detect whether content is a GraphQL surface (uses QUERY/MUTATION/SUBSCRIPTION headings).
 */
export function isGraphQLSurface(content: string): boolean {
  return GRAPHQL_HEADING_RE.test(content);
}
