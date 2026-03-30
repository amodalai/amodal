/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {AgentSessionManager} from '../session-manager.js';

export interface InspectRouterOptions {
  sessionManager: AgentSessionManager;
  repoPath: string;
}

export function createInspectRouter(options: InspectRouterOptions): Router {
  const router = Router();

  router.get('/inspect/context', async (_req: Request, res: Response) => {
    try {
      // Create a temporary session to inspect the compiled context
      const session = await options.sessionManager.create('__inspect__');

      const runtime = session.runtime;
      const compiled = runtime.compiledContext;

      res.json({
        repo_path: options.repoPath,
        name: runtime.repo.config.name ?? '',
        model: runtime.repo.config.models?.['main']?.model ?? '',
        provider: runtime.repo.config.models?.['main']?.provider ?? '',
        system_prompt_length: compiled.systemPrompt.length,
        token_usage: compiled.tokenUsage,
        sections: compiled.sections.map((s) => ({
          name: s.name,
          tokens: s.tokens,
          priority: s.priority,
          trimmed: s.trimmed,
        })),
        connections: Array.from(runtime.repo.connections.keys()),
        skills: runtime.repo.skills.map((s) => s.name),
        automations: runtime.repo.automations.map((a) => a.name),
        knowledge: runtime.repo.knowledge.map((k) => k.name),
      });

      // Clean up the temporary session
      options.sessionManager.destroy(session.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'INSPECT_FAILED', message: msg}});
    }
  });

  return router;
}
