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
        name: runtime.repo.config?.name ?? '',
        model: runtime.repo.config?.models?.['main']?.model ?? '',
        provider: runtime.repo.config?.models?.['main']?.provider ?? '',
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

  /** Health check — used by the UI "Connected" indicator. */
  router.get('/inspect/health', (_req: Request, res: Response) => {
    res.json({status: 'ok'});
  });

  /** Connection detail by name. */
  router.get('/inspect/connections/:name', async (req: Request, res: Response) => {
    try {
      const session = await options.sessionManager.create('__inspect__');
      const conn = session.runtime.repo.connections.get(req.params['name'] ?? '');
      options.sessionManager.destroy(session.id);

      if (!conn) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'Connection not found'}});
        return;
      }

      res.json({
        name: conn.name,
        spec: {baseUrl: conn.spec.baseUrl, format: conn.spec.format, authType: conn.spec.auth?.type ?? 'none'},
        surface: conn.surface.filter((e) => e.included).map((e) => ({
          method: e.method,
          path: e.path,
          description: e.description,
        })),
        entities: conn.entities ?? null,
        rules: conn.rules ?? null,
        location: conn.location,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'INSPECT_FAILED', message: msg}});
    }
  });

  /** Skill detail by name. */
  router.get('/inspect/skills/:name', async (req: Request, res: Response) => {
    try {
      const session = await options.sessionManager.create('__inspect__');
      const skill = session.runtime.repo.skills.find((s) => s.name === req.params['name']);
      options.sessionManager.destroy(session.id);

      if (!skill) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'Skill not found'}});
        return;
      }

      res.json({
        name: skill.name,
        description: skill.description,
        trigger: skill.trigger ?? null,
        body: skill.body,
        location: skill.location,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'INSPECT_FAILED', message: msg}});
    }
  });

  /** Knowledge document detail by name. */
  router.get('/inspect/knowledge/:name', async (req: Request, res: Response) => {
    try {
      const session = await options.sessionManager.create('__inspect__');
      const doc = session.runtime.repo.knowledge.find((k) => k.name === req.params['name']);
      options.sessionManager.destroy(session.id);

      if (!doc) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'Knowledge document not found'}});
        return;
      }

      res.json({
        name: doc.name,
        title: doc.title,
        body: doc.body,
        location: doc.location,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'INSPECT_FAILED', message: msg}});
    }
  });

  return router;
}
