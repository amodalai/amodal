/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Resolve a config value from (in priority order):
 * 1. Agent .env file (cwd/.env)
 * 2. Global ~/.amodal/env
 * 3. Shell environment (process.env)
 */
export function resolveEnv(key: string, cwd: string): string | undefined {
  // 1. Agent .env
  const agentEnvPath = path.join(cwd, '.env');
  const agentValue = readEnvFile(agentEnvPath, key);
  if (agentValue !== undefined) return agentValue;

  // 2. Global ~/.amodal/.env
  const globalEnvPath = path.join(os.homedir(), '.amodal', '.env');
  const globalValue = readEnvFile(globalEnvPath, key);
  if (globalValue !== undefined) return globalValue;

  // 3. Shell environment
  return process.env[key];
}

/**
 * Read a single key from a .env-style file. Returns undefined if the file
 * does not exist, cannot be read, or does not contain the key.
 */
function readEnvFile(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const k = trimmed.slice(0, eqIndex).trim();
      const v = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (k === key) return v;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
