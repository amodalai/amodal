/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared test-environment helpers for the smoke + e2e integration test
 * suites. Both test files need to (a) pull API keys out of the repo-root
 * `.env.test` file, and (b) pick a default provider target from whichever
 * key happens to be configured. This module is the single source of
 * truth for that logic so the two suites can't drift.
 *
 * `.env.test` is gitignored — it never enters the repo. When absent,
 * gated tests skip rather than fail.
 */

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// `__dirname` is not available under ESM; derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __fixturesDir = resolve(__filename, '..');

/**
 * Ordered preference list of provider targets. Cheap/fast ones first so
 * the default pick minimizes cost for contributors. Both suites consume
 * this list; keep them in lockstep by editing in one place.
 */
export const TARGET_PREFERENCE: readonly string[] = ['google', 'anthropic', 'openai', 'groq'];

/**
 * Load API keys from `<repo-root>/.env.test` into `process.env` without
 * overwriting existing values. Idempotent — safe to call from multiple
 * test files. Silently no-ops when the file is missing (gated tests
 * will then skip at describe-time).
 */
export function loadTestEnv(): void {
  try {
    const envPath = resolve(__fixturesDir, '../../../../.env.test');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key && value && !process.env[key.trim()]) {
          process.env[key.trim()] = value.trim();
        }
      }
    }
  } catch { /* no .env.test — tests will skip */ }
}

/**
 * Walk a preference list and return the name of the first target whose
 * `apiKeyEnv` is set in `process.env`. When nothing is configured,
 * returns the head of the preference chain so error messages can name
 * a concrete target rather than "undefined".
 */
export function defaultTargetName<T extends {apiKeyEnv: string}>(
  targets: Record<string, T>,
  preference: readonly string[] = TARGET_PREFERENCE,
): string {
  for (const name of preference) {
    const target = targets[name];
    if (target && process.env[target.apiKeyEnv]) return name;
  }
  return preference[0] ?? '';
}
