/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {SurfaceEndpoint} from './connection-types.js';

type ParserState = 'scanning' | 'included' | 'excluded';

const ENDPOINT_HEADING_RE = /^###\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/;
const INCLUDED_HEADING_RE = /^##\s+Included/i;
const EXCLUDED_HEADING_RE = /^##\s+Excluded/i;

/**
 * Parse surface.md content into SurfaceEndpoint[].
 *
 * States:
 * - scanning: before any ## Included / ## Excluded heading
 * - included: inside ## Included section
 * - excluded: inside ## Excluded section
 *
 * If no ## Included heading is found, all ### endpoints are treated as included.
 */
export function parseSurface(content: string): SurfaceEndpoint[] {
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
    // Check for section headings
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

    // Check for endpoint headings
    const endpointMatch = ENDPOINT_HEADING_RE.exec(line);
    if (endpointMatch) {
      flushEndpoint();
      const included = state === 'excluded' ? false : true;
      currentEndpoint = {
        method: endpointMatch[1],
        path: endpointMatch[2],
        description: '',
        included,
      };
      continue;
    }

    // Accumulate description lines
    if (currentEndpoint) {
      descriptionLines.push(line);
    }
  }

  // Flush last endpoint
  flushEndpoint();

  // If no ## Included section was found, all endpoints are included (already the default)
  // If there was an included section, endpoints found in scanning state
  // (before any section) should also be treated as included
  if (!hasIncludedSection) {
    // All endpoints already have included = true (scanning state default)
  }

  return endpoints;
}
