/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared test helpers for provider integration tests.
 *
 * Resolves API keys from environment, provides ready-to-use
 * ProviderConfig objects, and skip helpers for tests that need
 * real provider keys.
 *
 * Usage:
 * ```ts
 * import { testProviders, hasAnyProvider } from './test-providers.js';
 *
 * describe.skipIf(!hasAnyProvider)('my integration test', () => {
 *   it('calls the LLM', async () => {
 *     const config = testProviders.cheapest()!; // smallest/fastest available
 *     const provider = createProvider(config);
 *     const result = await provider.generateText({ ... });
 *   });
 * });
 * ```
 */

import type {ProviderConfig} from '../providers/types.js';

// ---------------------------------------------------------------------------
// Env var → provider mapping (single source of truth)
// ---------------------------------------------------------------------------

interface ProviderEntry {
  provider: string;
  envVar: string;
  /** Cheapest/fastest model for tests */
  cheapModel: string;
  /** Standard model for tests */
  standardModel: string;
}

const PROVIDER_ENTRIES: ProviderEntry[] = [
  {provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY', cheapModel: 'claude-haiku-4-5-20251001', standardModel: 'claude-sonnet-4-20250514'},
  {provider: 'openai', envVar: 'OPENAI_API_KEY', cheapModel: 'gpt-4o-mini', standardModel: 'gpt-4o'},
  {provider: 'google', envVar: 'GOOGLE_API_KEY', cheapModel: 'gemini-2.5-flash', standardModel: 'gemini-2.5-pro'},
  {provider: 'deepseek', envVar: 'DEEPSEEK_API_KEY', cheapModel: 'deepseek-chat', standardModel: 'deepseek-chat'},
];

// ---------------------------------------------------------------------------
// Resolved configs
// ---------------------------------------------------------------------------

function resolveConfig(entry: ProviderEntry, model: string): ProviderConfig | null {
  const apiKey = process.env[entry.envVar];
  if (!apiKey) return null;
  return {provider: entry.provider, model, apiKey};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const testProviders = {
  /** Get a ProviderConfig for a specific provider, or null if key missing */
  get(provider: string): ProviderConfig | null {
    const entry = PROVIDER_ENTRIES.find((e) => e.provider === provider);
    if (!entry) return null;
    return resolveConfig(entry, entry.cheapModel);
  },

  /** Get the cheapest available provider config (for fast tests) */
  cheapest(): ProviderConfig | null {
    for (const entry of PROVIDER_ENTRIES) {
      const config = resolveConfig(entry, entry.cheapModel);
      if (config) return config;
    }
    return null;
  },

  /** Get all available provider configs (cheap models) */
  all(): ProviderConfig[] {
    return PROVIDER_ENTRIES
      .map((entry) => resolveConfig(entry, entry.cheapModel))
      .filter((c): c is ProviderConfig => c !== null);
  },

  /** Get a config with an intentionally invalid key (for failover tests) */
  invalid(provider?: string): ProviderConfig {
    const p = provider ?? 'anthropic';
    const entry = PROVIDER_ENTRIES.find((e) => e.provider === p) ?? PROVIDER_ENTRIES[0];
    return {provider: entry.provider, model: entry.cheapModel, apiKey: 'sk-invalid-key-00000'};
  },

  /** Check if a specific provider key is available */
  has(provider: string): boolean {
    const entry = PROVIDER_ENTRIES.find((e) => e.provider === provider);
    return entry ? Boolean(process.env[entry.envVar]) : false;
  },
};

/** True if at least one provider API key is available */
export const hasAnyProvider = testProviders.all().length > 0;
