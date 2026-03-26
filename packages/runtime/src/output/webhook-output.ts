/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AutomationResult } from '../types.js';

/**
 * POST automation result as JSON to a generic webhook URL.
 */
export async function sendWebhookOutput(
  target: string,
  result: AutomationResult,
): Promise<void> {
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      automation: result.automation,
      response: result.response,
      tool_calls: result.tool_calls,
      duration_ms: result.duration_ms,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Webhook failed: ${response.status} ${response.statusText}`,
    );
  }
}
