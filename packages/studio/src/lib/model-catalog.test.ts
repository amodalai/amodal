/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it} from 'vitest';
import {buildModelCatalog, buildModelConfigSnippet, readModelsFromConfigFile, writeMainModelToConfigFile} from './model-catalog';

const pricingTable = {
  'claude-sonnet-4-20250514': {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000},
  'gemini-2.5-flash': {inputPerMToken: 300_000, outputPerMToken: 2_500_000},
  'openai/gpt-oss-120b': {inputPerMToken: 150_000, outputPerMToken: 600_000},
};

describe('buildModelCatalog', () => {
  it('marks the current configured model and provider status', () => {
    const catalog = buildModelCatalog({
      models: {
        main: {provider: 'google', model: 'gemini-2.5-flash'},
      },
      providerStatuses: [
        {provider: 'google', envVar: 'GOOGLE_API_KEY', keySet: true, verified: true},
      ],
    }, pricingTable);

    const current = catalog.models.find((model) => model.model === 'gemini-2.5-flash');
    expect(current).toMatchObject({
      provider: 'google',
      configuredAliases: ['main'],
      isCurrent: true,
      keySet: true,
      verified: true,
    });
    expect(catalog.currentModel).toEqual({provider: 'google', model: 'gemini-2.5-flash'});
  });

  it('builds an amodal.json models.main snippet', () => {
    const catalog = buildModelCatalog({}, pricingTable);
    const model = catalog.models.find((entry) => entry.model === 'claude-sonnet-4-20250514');
    expect(model).toBeDefined();
    if (!model) expect.fail('Expected catalog to include claude-sonnet-4-20250514');
    expect(buildModelConfigSnippet(model)).toContain('"provider": "anthropic"');
    expect(buildModelConfigSnippet(model)).toContain('"model": "claude-sonnet-4-20250514"');
  });

  it('uses explicit metadata for hosted slash-form model ids', () => {
    const catalog = buildModelCatalog({
      providerStatuses: [
        {provider: 'groq', envVar: 'GROQ_API_KEY', keySet: true, verified: true},
      ],
    }, pricingTable);

    const hosted = catalog.models.find((model) => model.model === 'openai/gpt-oss-120b');
    expect(hosted).toMatchObject({
      provider: 'groq',
      label: 'GPT OSS 120B',
      context: '128K',
      keySet: true,
      verified: true,
    });
  });

  it('marks unknown context when no metadata is available', () => {
    const catalog = buildModelCatalog({}, {
      'vendor/new-model': {inputPerMToken: 1, outputPerMToken: 2},
    });

    expect(catalog.models[0]?.context).toBe('unknown');
  });

  it('writes selected model to amodal.json without dropping other fields', () => {
    const updated = writeMainModelToConfigFile(JSON.stringify({
      name: 'agent',
      version: '1.0.0',
      models: {
        simple: {provider: 'google', model: 'gemini-2.5-flash'},
      },
    }), {provider: 'anthropic', model: 'claude-sonnet-4-20250514'});

    const models = readModelsFromConfigFile(updated);
    expect(models).toEqual({
      main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
      simple: {provider: 'google', model: 'gemini-2.5-flash'},
    });
    expect(JSON.parse(updated)).toMatchObject({name: 'agent', version: '1.0.0'});
  });
});
