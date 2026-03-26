/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AutomationResult } from '../types.js';

/**
 * Format automation result for Slack and POST to webhook URL.
 */
export async function sendSlackOutput(
  target: string,
  result: AutomationResult,
): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Automation: ${result.automation}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: result.response || '_No response_',
      },
    },
  ];

  if (result.tool_calls.length > 0) {
    const toolSummary = result.tool_calls
      .map(
        (tc) =>
          `• ${tc.tool_name}: ${tc.status}${tc.error ? ` (${tc.error})` : ''}`,
      )
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Tool calls:*\n${toolSummary}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    text: {
      type: 'mrkdwn',
      text: `Duration: ${result.duration_ms}ms`,
    },
  });

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    throw new Error(
      `Slack webhook failed: ${response.status} ${response.statusText}`,
    );
  }
}
