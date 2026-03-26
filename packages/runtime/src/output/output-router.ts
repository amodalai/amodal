/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AutomationOutput } from '@amodalai/core';
import type { AutomationResult } from '../types.js';
import { sendSlackOutput } from './slack-output.js';
import { sendWebhookOutput } from './webhook-output.js';
import { sendEmailOutput } from './email-output.js';

/**
 * Route automation output to the configured channel.
 * Errors are caught and logged — output failures must never crash the server.
 */
export async function routeOutput(
  output: AutomationOutput,
  result: AutomationResult,
): Promise<boolean> {
  try {
    switch (output.channel) {
      case 'slack':
        await sendSlackOutput(output.target, result);
        return true;
      case 'webhook':
        await sendWebhookOutput(output.target, result);
        return true;
      case 'email':
        await sendEmailOutput(output.target, result);
        return true;
      default:
        process.stderr.write(
          `[WARN] Unknown output channel: ${output.channel as string}\n`,
        );
        return false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[ERROR] Output routing failed for ${output.channel}:${output.target}: ${message}\n`,
    );
    return false;
  }
}
