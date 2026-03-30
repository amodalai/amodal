/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/**
 * Load a .env file into process.env.
 * Supports comments (#), `export` prefix, and quoted values.
 * Does not override existing env vars.
 */
export function loadEnvFile(dir: string): void {
  const envPath = resolve(dir, '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.replace(/^export\s+/, '').match(/^([^=]+)=(.*)/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}
