/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ModelConfig} from '@amodalai/types';
import {MODEL_META, modelDisplayName, modelToProvider} from './model-pricing';

export const MODELS_CATALOG_API_PATH = '/api/models/catalog';
export const MODEL_CONFIG_FILE_PATH = 'amodal.json';

export interface RuntimeProviderStatus {
  provider: string;
  envVar: string;
  keySet: boolean;
  verified: boolean;
}

export interface ModelCatalogRuntimeConfig {
  models?: Record<string, ModelConfig>;
  providerStatuses?: RuntimeProviderStatus[];
}

export interface ModelCatalogPricing {
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken?: number;
  cacheWritePerMToken?: number;
}

export type ModelCatalogPricingTable = Record<string, ModelCatalogPricing>;

export interface ModelCatalogEntry {
  provider: string;
  model: string;
  label: string;
  context: string;
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken?: number;
  cacheWritePerMToken?: number;
  configuredAliases: string[];
  isCurrent: boolean;
  keySet: boolean;
  verified: boolean;
}

export interface ModelCatalogResponse {
  currentModel: ModelConfig | null;
  configuredModels: Array<{alias: string; config: ModelConfig}>;
  providerStatuses: RuntimeProviderStatus[];
  models: ModelCatalogEntry[];
  source: 'runtime' | 'draft';
  draftPath?: typeof MODEL_CONFIG_FILE_PATH;
}

export interface ModelCatalogSaveRequest {
  model: ModelConfig;
}

export interface ModelCatalogSaveResponse extends ModelCatalogResponse {
  source: 'draft';
  draftPath: typeof MODEL_CONFIG_FILE_PATH;
}

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'deepseek', 'groq', 'mistral', 'xai'];

function providerRank(provider: string): number {
  const rank = PROVIDER_ORDER.indexOf(provider);
  return rank === -1 ? PROVIDER_ORDER.length : rank;
}

function providerStatusMap(providerStatuses: RuntimeProviderStatus[]): Map<string, RuntimeProviderStatus> {
  const statuses = new Map<string, RuntimeProviderStatus>();
  for (const status of providerStatuses) {
    statuses.set(status.provider, status);
  }
  return statuses;
}

function configuredAliasMap(configuredModels: Array<{alias: string; config: ModelConfig}>): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const {alias, config} of configuredModels) {
    const existing = aliases.get(config.model) ?? [];
    existing.push(alias);
    aliases.set(config.model, existing);
  }
  return aliases;
}

export function buildModelCatalog(
  runtimeConfig: ModelCatalogRuntimeConfig,
  pricingTable: ModelCatalogPricingTable,
  source: ModelCatalogResponse['source'] = 'runtime',
): ModelCatalogResponse {
  const configuredModels = Object.entries(runtimeConfig.models ?? {}).map(([alias, config]) => ({alias, config}));
  const currentModel = runtimeConfig.models?.main ?? null;
  const statuses = providerStatusMap(runtimeConfig.providerStatuses ?? []);
  const aliases = configuredAliasMap(configuredModels);

  const models = Object.entries(pricingTable)
    .map(([model, pricing]): ModelCatalogEntry => {
      const provider = modelToProvider(model);
      const status = statuses.get(provider);
      return {
        provider,
        model,
        label: modelDisplayName(model),
        context: MODEL_META[model]?.context ?? 'unknown',
        inputPerMToken: pricing.inputPerMToken,
        outputPerMToken: pricing.outputPerMToken,
        ...(pricing.cacheReadPerMToken !== undefined ? {cacheReadPerMToken: pricing.cacheReadPerMToken} : {}),
        ...(pricing.cacheWritePerMToken !== undefined ? {cacheWritePerMToken: pricing.cacheWritePerMToken} : {}),
        configuredAliases: aliases.get(model) ?? [],
        isCurrent: currentModel?.model === model,
        keySet: status?.keySet ?? false,
        verified: status?.verified ?? false,
      };
    })
    .sort((a, b) => (
      Number(b.isCurrent) - Number(a.isCurrent) ||
      Number(b.verified) - Number(a.verified) ||
      Number(b.keySet) - Number(a.keySet) ||
      providerRank(a.provider) - providerRank(b.provider) ||
      a.model.localeCompare(b.model)
    ));

  return {
    currentModel,
    configuredModels,
    providerStatuses: runtimeConfig.providerStatuses ?? [],
    models,
    source,
    ...(source === 'draft' ? {draftPath: MODEL_CONFIG_FILE_PATH} : {}),
  };
}

export function buildModelConfigSnippet(model: ModelCatalogEntry): string {
  return `${JSON.stringify({
    models: {
      main: {
        provider: model.provider,
        model: model.model,
      },
    },
  }, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ModelCatalogConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelCatalogConfigError';
  }
}

export function parseModelConfigFile(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new ModelCatalogConfigError(`${MODEL_CONFIG_FILE_PATH} must contain a JSON object`);
  }
  return parsed;
}

export function readModelsFromConfigFile(content: string): Record<string, ModelConfig> | null {
  const parsed = parseModelConfigFile(content);
  const rawModels = parsed['models'];
  if (!isRecord(rawModels)) return null;
  const models: Record<string, ModelConfig> = {};
  for (const [alias, value] of Object.entries(rawModels)) {
    if (!isRecord(value)) continue;
    const provider = value['provider'];
    const model = value['model'];
    if (typeof provider !== 'string' || typeof model !== 'string') continue;
    models[alias] = {
      provider,
      model,
      ...(typeof value['region'] === 'string' ? {region: value['region']} : {}),
      ...(typeof value['baseUrl'] === 'string' ? {baseUrl: value['baseUrl']} : {}),
    };
  }
  return models;
}

export function writeMainModelToConfigFile(content: string, model: ModelConfig): string {
  const parsed = parseModelConfigFile(content);
  const existingModels = isRecord(parsed['models']) ? parsed['models'] : {};
  parsed['models'] = {
    ...existingModels,
    main: {
      provider: model.provider,
      model: model.model,
      ...(model.region ? {region: model.region} : {}),
      ...(model.baseUrl ? {baseUrl: model.baseUrl} : {}),
    },
  };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
