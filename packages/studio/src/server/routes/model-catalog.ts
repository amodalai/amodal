/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Hono} from 'hono';
import {MODEL_PRICING} from '@amodalai/core';
import {
  MODEL_CONFIG_FILE_PATH,
  MODELS_CATALOG_API_PATH,
  buildModelCatalog,
  readModelsFromConfigFile,
  writeMainModelToConfigFile,
  type ModelCatalogRuntimeConfig,
  type ModelCatalogSaveResponse,
} from '../../lib/model-catalog.js';
import type {ModelConfig} from '@amodalai/types';
import {resolveRuntimeContext} from '../../lib/runtime-client.js';
import {getBackend} from '../../lib/startup.js';
import {getUser} from '../middleware/auth.js';

const RUNTIME_CONFIG_PATH = '/api/config';
const MODEL_CATALOG_TIMEOUT_MS = 5_000;

export const modelCatalogRoutes = new Hono();

class ModelCatalogRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCatalogRuntimeError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchRuntimeConfig(req: Request): Promise<ModelCatalogRuntimeConfig> {
  const {runtimeUrl} = await resolveRuntimeContext(req);
  const response = await fetch(`${runtimeUrl}${RUNTIME_CONFIG_PATH}`, {
    signal: AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ModelCatalogRuntimeError(`Runtime returned ${String(response.status)} for model catalog config`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: runtime config response
  return await response.json() as ModelCatalogRuntimeConfig;
}

async function readDraftModels(userId: string): Promise<Record<string, ModelConfig> | null> {
  const backend = await getBackend();
  const draft = await backend.readDraft(userId, MODEL_CONFIG_FILE_PATH);
  return draft ? readModelsFromConfigFile(draft.content) : null;
}

modelCatalogRoutes.get(MODELS_CATALOG_API_PATH, async (c) => {
  const user = await getUser(c.req.raw);
  const runtimeConfig = await fetchRuntimeConfig(c.req.raw);
  const draftModels = await readDraftModels(user.userId);
  if (draftModels) {
    return c.json(buildModelCatalog({...runtimeConfig, models: draftModels}, MODEL_PRICING, 'draft'));
  }
  return c.json(buildModelCatalog(runtimeConfig, MODEL_PRICING));
});

modelCatalogRoutes.put(MODELS_CATALOG_API_PATH, async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  const body = await c.req.json() as unknown;

  if (!isRecord(body) || !('model' in body)) {
    return c.json({error: {code: 'BAD_REQUEST', message: 'Request body must include a "model" object'}}, 400);
  }
  const model = body['model'];
  if (
    !isRecord(model) ||
    typeof model['provider'] !== 'string' ||
    typeof model['model'] !== 'string'
  ) {
    return c.json({error: {code: 'BAD_REQUEST', message: 'Model must include provider and model strings'}}, 400);
  }

  const currentDraft = await backend.readDraft(user.userId, MODEL_CONFIG_FILE_PATH);
  const workspace = await backend.getWorkspace();
  const amodalJson = workspace.files.find((file) => file.path === MODEL_CONFIG_FILE_PATH);
  const currentContent = currentDraft?.content ?? amodalJson?.content;
  if (!currentContent) {
    return c.json({
      error: {
        code: 'MISSING_CONFIG',
        message: `${MODEL_CONFIG_FILE_PATH} is required before model settings can be saved`,
      },
    }, 404);
  }

  const nextModel: ModelConfig = {
    provider: model['provider'],
    model: model['model'],
  };
  const content = writeMainModelToConfigFile(currentContent, nextModel);
  await backend.saveDraft(user.userId, MODEL_CONFIG_FILE_PATH, content);

  const runtimeConfig = await fetchRuntimeConfig(c.req.raw);
  const draftModels = readModelsFromConfigFile(content) ?? {main: nextModel};
  const response: ModelCatalogSaveResponse = {
    ...buildModelCatalog({...runtimeConfig, models: draftModels}, MODEL_PRICING, 'draft'),
    source: 'draft',
    draftPath: MODEL_CONFIG_FILE_PATH,
  };
  return c.json(response);
});
