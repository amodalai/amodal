/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import type {SessionRuntime} from './session-setup.js';
import type {AgentBundle} from '../repo/repo-types.js';
import type {ModelConfig} from '../repo/config-schema.js';
import type {ConnectionsMap} from '../templates/connections.js';
import {
  prepareExploreConfig,
  resolveExploreModel,
  validateExploreRequest,
  EXPLORE_TOOL_NAME,
  EXPLORE_TOOL_SCHEMA,
} from './explore-tool.js';
import type {ExploreRequest} from './explore-tool.js';

const mainModel: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
};

const exploreModel: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-20250514',
};

const testConnections: ConnectionsMap = {
  crm_api: {base_url: 'https://crm.example.com', api_key: 'sk-test'},
  erp_api: {base_url: 'https://erp.example.com', api_key: 'sk-erp'},
};

function makeSessionRuntime(overrides?: {
  simpleModel?: ModelConfig;
  exploreSystemPrompt?: string;
  connectionsMap?: ConnectionsMap;
}): SessionRuntime {
  const models: {main: ModelConfig; simple?: ModelConfig; advanced?: ModelConfig} = {
    main: mainModel,
  };
  if (overrides?.simpleModel) {
    models['simple'] = overrides.simpleModel;
  }

  const repo = {
    config: {models},
  } as unknown as AgentBundle;

  return {
    repo,
    exploreContext: {
      systemPrompt: overrides?.exploreSystemPrompt ?? 'You are an explore agent.',
      tokenUsage: {total: 4096, used: 100, remaining: 3996, sectionBreakdown: {}},
      sections: [],
    },
    connectionsMap: overrides?.connectionsMap ?? testConnections,
    // Remaining fields are unused by explore-tool but required by SessionRuntime
    scrubTracker: {} as SessionRuntime['scrubTracker'],
    fieldScrubber: {} as SessionRuntime['fieldScrubber'],
    outputGuard: {} as SessionRuntime['outputGuard'],
    actionGate: {} as SessionRuntime['actionGate'],
    contextCompiler: {} as SessionRuntime['contextCompiler'],
    compiledContext: {systemPrompt: '', tokenUsage: {total: 0, used: 0, remaining: 0, sectionBreakdown: {}}, sections: []},
    outputPipeline: {} as SessionRuntime['outputPipeline'],
    telemetry: {} as SessionRuntime['telemetry'],
    userRoles: [],
    sessionId: 'test-session-id',
    isDelegated: false,
  };
}

describe('prepareExploreConfig', () => {
  it('uses explore model when available in config', () => {
    const runtime = makeSessionRuntime({simpleModel: exploreModel});
    const config = prepareExploreConfig(runtime);
    expect(config.model).toEqual(exploreModel);
  });

  it('falls back to main model when no explore model', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime);
    expect(config.model).toEqual(mainModel);
  });

  it('sets readOnly to true', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime);
    expect(config.readOnly).toBe(true);
  });

  it('default maxTurns is 10', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime);
    expect(config.maxTurns).toBe(10);
  });

  it('custom maxTurns overrides default', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime, {maxTurns: 5});
    expect(config.maxTurns).toBe(5);
  });

  it('default maxDepth is 2', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime);
    expect(config.maxDepth).toBe(2);
  });

  it('custom maxDepth overrides default', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime, {maxDepth: 4});
    expect(config.maxDepth).toBe(4);
  });

  it('system prompt comes from runtime.exploreContext', () => {
    const runtime = makeSessionRuntime({exploreSystemPrompt: 'Custom explore prompt'});
    const config = prepareExploreConfig(runtime);
    expect(config.systemPrompt).toBe('Custom explore prompt');
  });

  it('connectionsMap passed through from runtime', () => {
    const customMap: ConnectionsMap = {slack: {webhook: 'https://hooks.slack.com/test'}};
    const runtime = makeSessionRuntime({connectionsMap: customMap});
    const config = prepareExploreConfig(runtime);
    expect(config.connectionsMap).toBe(customMap);
  });

  it('availableModels contains both main and explore', () => {
    const runtime = makeSessionRuntime({simpleModel: exploreModel});
    const config = prepareExploreConfig(runtime);
    expect(config.availableModels.main).toEqual(mainModel);
    expect(config.availableModels.simple).toEqual(exploreModel);
  });

  it('availableModels has no explore when not configured', () => {
    const runtime = makeSessionRuntime();
    const config = prepareExploreConfig(runtime);
    expect(config.availableModels.main).toEqual(mainModel);
    expect(config.availableModels.simple).toBeUndefined();
  });
});

describe('validateExploreRequest', () => {
  const config = prepareExploreConfig(makeSessionRuntime());

  it('valid request returns null', () => {
    const request: ExploreRequest = {query: 'Find all contacts', parentDepth: 0};
    expect(validateExploreRequest(request, config)).toBeNull();
  });

  it('request exceeding maxDepth returns error message', () => {
    const request: ExploreRequest = {query: 'test', parentDepth: 3};
    const result = validateExploreRequest(request, config);
    expect(result).toContain('max depth');
  });

  it('empty query returns error message', () => {
    const request: ExploreRequest = {query: '', parentDepth: 0};
    const result = validateExploreRequest(request, config);
    expect(result).toContain('empty');
  });

  it('request at exact maxDepth is rejected', () => {
    const request: ExploreRequest = {query: 'test', parentDepth: 2};
    const result = validateExploreRequest(request, config);
    expect(result).not.toBeNull();
  });

  it('request at depth 0 is valid', () => {
    const request: ExploreRequest = {query: 'test query', parentDepth: 0};
    expect(validateExploreRequest(request, config)).toBeNull();
  });

  it('request at depth 1 with maxDepth 2 is valid', () => {
    const request: ExploreRequest = {query: 'test query', parentDepth: 1};
    expect(validateExploreRequest(request, config)).toBeNull();
  });
});

describe('resolveExploreModel', () => {
  const configWithExplore = prepareExploreConfig(makeSessionRuntime({simpleModel: exploreModel}));
  const configWithoutExplore = prepareExploreConfig(makeSessionRuntime());

  it('returns default model when no param given', () => {
    expect(resolveExploreModel(configWithExplore)).toEqual(exploreModel);
    expect(resolveExploreModel(configWithExplore, undefined)).toEqual(exploreModel);
  });

  it('"simple" returns explore model', () => {
    expect(resolveExploreModel(configWithExplore, 'simple')).toEqual(exploreModel);
  });

  it('"simple" falls back to default when no explore model configured', () => {
    expect(resolveExploreModel(configWithoutExplore, 'simple')).toEqual(mainModel);
  });

  it('"default" returns the default explore model', () => {
    expect(resolveExploreModel(configWithExplore, 'default')).toEqual(exploreModel);
  });

  it('"advanced" returns main model', () => {
    expect(resolveExploreModel(configWithExplore, 'advanced')).toEqual(mainModel);
  });

  it('case insensitive', () => {
    expect(resolveExploreModel(configWithExplore, 'SIMPLE')).toEqual(exploreModel);
    expect(resolveExploreModel(configWithExplore, 'Advanced')).toEqual(mainModel);
  });

  it('"provider:model" returns literal override', () => {
    const result = resolveExploreModel(configWithExplore, 'openai:gpt-4o-mini');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('"provider:model" inherits credentials from default model', () => {
    const configWithCreds = prepareExploreConfig(makeSessionRuntime({simpleModel: exploreModel}));
    configWithCreds.model = {...exploreModel, credentials: {OPENAI_API_KEY: 'test-key'}};
    const result = resolveExploreModel(configWithCreds, 'openai:gpt-4o-mini');
    expect(result.credentials).toEqual({OPENAI_API_KEY: 'test-key'});
  });

  it('unrecognized alias returns default model', () => {
    expect(resolveExploreModel(configWithExplore, 'unknown')).toEqual(exploreModel);
  });
});

describe('EXPLORE_TOOL_SCHEMA', () => {
  it('has required query field', () => {
    expect(EXPLORE_TOOL_SCHEMA.parameters.required).toContain('query');
    expect(EXPLORE_TOOL_SCHEMA.parameters.properties['query']).toBeDefined();
  });

  it('has optional endpoint_hints field', () => {
    expect(EXPLORE_TOOL_SCHEMA.parameters.properties['endpoint_hints']).toBeDefined();
    expect(EXPLORE_TOOL_SCHEMA.parameters.required).not.toContain('endpoint_hints');
  });

  it('has optional model field', () => {
    expect(EXPLORE_TOOL_SCHEMA.parameters.properties['model']).toBeDefined();
    expect(EXPLORE_TOOL_SCHEMA.parameters.required).not.toContain('model');
  });

  it('name is explore', () => {
    expect(EXPLORE_TOOL_SCHEMA.name).toBe('explore');
    expect(EXPLORE_TOOL_NAME).toBe('explore');
  });
});
