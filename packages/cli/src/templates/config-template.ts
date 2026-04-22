/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export interface ConfigTemplateOptions {
  name: string;
  provider: 'anthropic' | 'openai' | 'google';
}

/**
 * Generates the default config.json content for a new project.
 */
export function generateConfigTemplate(options: ConfigTemplateOptions): string {
  const modelMap: Record<string, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    google: 'gemini-2.0-flash',
  };

  const model = modelMap[options.provider] ?? modelMap['anthropic'];

  const config = {
    name: options.name,
    version: '1.0.0',
    models: {
      main: {
        provider: options.provider,
        model,
      },
    },
  };

  return JSON.stringify(config, null, 2) + '\n';
}
