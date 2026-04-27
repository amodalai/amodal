/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { listEvalRuns } from '../../lib/eval-queries.js';
import { runEvalSuite } from '../../lib/eval-runner.js';
import { resolveRuntimeContext } from '../../lib/runtime-client.js';

export const evalsRoutes = new Hono();

// Run an eval by name — resolves runtime URL from JWT or env
evalsRoutes.post('/api/evals/run', async (c) => {
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null || !('evalName' in body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must include "evalName"' } }, 400);
  }

  const evalName = String((body as Record<string, unknown>)['evalName']);
  const { runtimeUrl, agentId } = await resolveRuntimeContext(c.req.raw);
  const runId = await runEvalSuite(evalName, runtimeUrl, agentId);
  return c.json({ runId });
});

// List eval runs for a suite (by suiteId = "agentId:evalName")
evalsRoutes.get('/api/evals/runs/by-suite/:suiteId', async (c) => {
  const suiteId = c.req.param('suiteId');
  const runs = await listEvalRuns(suiteId);
  return c.json({ runs });
});

// List eval runs by eval name + agentId
evalsRoutes.get('/api/evals/runs/by-eval/:name', async (c) => {
  const name = c.req.param('name');
  const agentId = c.req.query('agentId') ?? '';
  if (!agentId) {
    return c.json({ runs: [] });
  }
  const suiteId = `${agentId}:${name}`;
  const runs = await listEvalRuns(suiteId);
  return c.json({ runs });
});

// Arena models — returns available models for arena comparison
evalsRoutes.get('/api/evals/arena/models', async (c) => {
  const { runtimeUrl } = await resolveRuntimeContext(c.req.raw);
  try {
    const res = await fetch(`${runtimeUrl}/api/config`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return c.json({ models: [] });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary
    const config = await res.json() as Record<string, unknown>;
    const modelsRaw = config['models'];
    const models = typeof modelsRaw === 'object' && modelsRaw !== null
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by typeof check
      ? modelsRaw as Record<string, unknown>
      : undefined;
    // Don't early-return — still check providerStatuses even without explicit models config

    const modelsPerProvider: Record<string, string[]> = {
      google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview'],
      anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
      openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
      groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      deepseek: ['deepseek-chat', 'deepseek-reasoner'],
      xai: ['grok-2', 'grok-3-mini'],
    };

    const result: Array<{name: string; provider: string; model: string}> = [];
    const includedModels = new Set<string>();

    for (const [name, cfg] of Object.entries(models ?? {})) {
      if (cfg && typeof cfg === 'object' && 'provider' in cfg && 'model' in cfg) {
        const provider = String((cfg as Record<string, unknown>)['provider']);
        result.push({
          name,
          provider,
          model: String((cfg as Record<string, unknown>)['model']),
        });
        includedModels.add(`${provider}/${String((cfg as Record<string, unknown>)['model'])}`);
      }
    }

    // Add all known models for providers with API keys set
    const providerStatuses = config['providerStatuses'];
    if (Array.isArray(providerStatuses)) {
      for (const status of providerStatuses) {
        if (
          status &&
          typeof status === 'object' &&
          'provider' in status &&
          'keySet' in status
        ) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by typeof + in checks
          const ps = status as Record<string, unknown>;
          const provider = String(ps['provider']);
          const keySet = Boolean(ps['keySet']);
          if (keySet && provider in modelsPerProvider) {
            for (const model of modelsPerProvider[provider]) {
              const key = `${provider}/${model}`;
              if (!includedModels.has(key)) {
                result.push({name: `${provider}/${model}`, provider, model});
                includedModels.add(key);
              }
            }
          }
        }
      }
    }

    return c.json({ models: result });
  } catch {
    return c.json({ models: [] });
  }
});
