/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getRuntimeUrl } from '../../lib/config.js';
import { getBackend } from '../../lib/startup.js';
import { getUser } from '../middleware/auth.js';
import {
  buildEmbedSnippet,
  DEFAULT_EMBED_CONFIG,
  EMBED_CONFIG_API_PATH,
  EMBED_CONFIG_FILE_PATH,
  normalizeEmbedConfig,
  readEmbedConfigFromAmodalJson,
  writeEmbedConfigToAmodalJson,
  type EmbedConfig,
  type EmbedConfigResponse,
  type EmbedConfigSaveResponse,
} from '../../lib/embed-config.js';

export const embedConfigRoutes = new Hono();

function responseFor(config: EmbedConfig, source: EmbedConfigResponse['source']): EmbedConfigResponse {
  return {
    config,
    source,
    snippet: buildEmbedSnippet({ config, serverUrl: getRuntimeUrl() }),
  };
}

async function readCurrentConfig(userId: string, req: Request): Promise<EmbedConfigResponse> {
  const backend = await getBackend(req);
  const draft = await backend.readDraft(userId, EMBED_CONFIG_FILE_PATH);
  if (draft) {
    return responseFor(readEmbedConfigFromAmodalJson(draft.content), 'draft');
  }

  const workspace = await backend.getWorkspace();
  const amodalJson = workspace.files.find((file) => file.path === EMBED_CONFIG_FILE_PATH);
  if (!amodalJson) {
    return responseFor(DEFAULT_EMBED_CONFIG, 'default');
  }

  return responseFor(readEmbedConfigFromAmodalJson(amodalJson.content), 'file');
}

embedConfigRoutes.get(EMBED_CONFIG_API_PATH, async (c) => {
  const user = await getUser(c.req.raw);
  return c.json(await readCurrentConfig(user.userId, c.req.raw));
});

embedConfigRoutes.put(EMBED_CONFIG_API_PATH, async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend(c.req.raw);
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null || !('config' in body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must include a "config" object' } }, 400);
  }

  const config = normalizeEmbedConfig((body as Record<string, unknown>)['config']);
  const current = await readCurrentConfig(user.userId, c.req.raw);
  const workspace = await backend.getWorkspace();
  const amodalJson = workspace.files.find((file) => file.path === EMBED_CONFIG_FILE_PATH);
  const currentContent = current.source === 'draft'
    ? (await backend.readDraft(user.userId, EMBED_CONFIG_FILE_PATH))?.content
    : amodalJson?.content;

  if (!currentContent) {
    return c.json({
      error: {
        code: 'MISSING_CONFIG',
        message: `${EMBED_CONFIG_FILE_PATH} is required before embed settings can be saved`,
      },
    }, 404);
  }

  const content = writeEmbedConfigToAmodalJson(currentContent, config);
  await backend.saveDraft(user.userId, EMBED_CONFIG_FILE_PATH, content);

  const response: EmbedConfigSaveResponse = {
    ...responseFor(config, 'draft'),
    draftPath: EMBED_CONFIG_FILE_PATH,
  };
  return c.json(response);
});
