/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AutomationResult } from '../types.js';

/**
 * Stub email output — logs a warning that email is not yet implemented.
 */
export async function sendEmailOutput(
  target: string,
  result: AutomationResult,
): Promise<void> {
  process.stderr.write(
    `[WARN] Email output not implemented. Would send automation "${result.automation}" result to ${target}\n`,
  );
}
