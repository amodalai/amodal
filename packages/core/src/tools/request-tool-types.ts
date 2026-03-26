/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import type { FieldScrubber } from '../security/field-scrubber.js';
import type { ActionGate } from '../security/action-gate.js';

/**
 * Zod schema for the `request` tool parameters.
 */
export const RequestToolParamsSchema = z.object({
  connection: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  endpoint: z.string().min(1),
  params: z.record(z.string()).optional(),
  data: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
  intent: z.enum(['read', 'write', 'confirmed_write']),
});

export type RequestToolParams = z.infer<typeof RequestToolParamsSchema>;

export const REQUEST_TOOL_NAME = 'request';

/**
 * Optional security configuration for the request tool.
 */
export interface RequestSecurityConfig {
  fieldScrubber?: FieldScrubber;
  actionGate?: ActionGate;
  planModeActive?: () => boolean;
}
