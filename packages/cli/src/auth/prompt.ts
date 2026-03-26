/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import prompts from 'prompts';
import {
  findMissingEnvVars,
  upsertEnvEntries,
} from '@amodalai/core';
import type {PackageAuth} from '@amodalai/core';

import type {AuthResult} from './types.js';

export interface PromptCredentialsOptions {
  auth: PackageAuth;
  envFilePath: string;
  dryRun?: boolean;
}

/**
 * Extract all required env var names from any auth type.
 */
export function getRequiredEnvVars(auth: PackageAuth): string[] {
  const vars: string[] = [];

  // Collect from envVars map (all auth types can have this)
  if (auth['envVars']) {
    vars.push(...Object.keys(auth['envVars']));
  }

  // For api_key, also extract $VAR references from headers values
  if (auth.type === 'api_key' && auth['headers']) {
    for (const value of Object.values(auth['headers'])) {
      const match = /\$\{?([A-Z_][A-Z0-9_]*)\}?/.exec(value);
      if (match && !vars.includes(match[1])) {
        vars.push(match[1]);
      }
    }
  }

  return vars;
}

/**
 * Prompt user for missing credentials and write them to the env file.
 */
export async function promptForCredentials(
  options: PromptCredentialsOptions,
): Promise<AuthResult> {
  const {auth, envFilePath, dryRun} = options;
  const required = getRequiredEnvVars(auth);

  if (required.length === 0) {
    return {
      credentials: {},
      summary: 'No credentials required',
    };
  }

  const missing = await findMissingEnvVars(envFilePath, required);

  if (missing.length === 0) {
    return {
      credentials: {},
      summary: 'All credentials already set',
    };
  }

  if (dryRun) {
    return {
      credentials: {},
      summary: `Missing credentials: ${missing.join(', ')}`,
    };
  }

  const descriptions = auth['envVars'] ?? {};
  const collected: Record<string, string> = {};

  for (const varName of missing) {
    const description = descriptions[varName];
    const message = description
      ? `${varName} (${description})`
      : varName;

    const response = await prompts({
      type: 'password',
      name: 'value',
      message,
    });

    // User cancelled (Ctrl+C)
    if (response['value'] === undefined) {
      return {
        credentials: collected,
        summary: `Cancelled. ${Object.keys(collected).length} of ${missing.length} credentials collected`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    collected[varName] = response['value'] as string;
  }

  await upsertEnvEntries(envFilePath, collected);

  return {
    credentials: collected,
    summary: `Set ${Object.keys(collected).length} credential${Object.keys(collected).length === 1 ? '' : 's'}`,
  };
}
