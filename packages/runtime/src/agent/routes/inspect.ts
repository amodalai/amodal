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

/**
 * Check if a REST connection's base URL is reachable.
 * Quick HEAD request with a short timeout — we just want to know if the server responds.
 */
async function checkRestHealth(baseUrl: string, testPath?: string): Promise<{ok: boolean; error?: string}> {
  const url = testPath ? `${baseUrl}${testPath}` : baseUrl;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    });
    // Accept any non-5xx response as "reachable" — auth errors (401/403) still mean the server is up
    return {ok: res.status < 500};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {ok: false, error: msg};
  }
}

export function createInspectRouter(options: InspectRouterOptions): Router {
  const router = Router();

  router.get('/inspect/context', async (_req: Request, res: Response) => {
    try {
      // Create a temporary session to inspect the compiled context
      const session = await options.sessionManager.create('__inspect__');

      const runtime = session.runtime;
      const compiled = runtime.compiledContext;
      const repo = runtime.repo;

      // Get MCP server info from persistent inspect manager
      const mcpManager = await options.sessionManager.getInspectMcpManager();
      const mcpServers = mcpManager
        ? mcpManager.getServerInfo().map((s) => ({
            name: s.name,
            status: s.status,
            toolCount: s.tools.length,
            error: s.error,
          }))
        : [];

      // Check connection health in parallel (REST only — MCP health checked via McpManager)
      const connectionEntries = Array.from(repo.connections.entries());
      const healthChecks = await Promise.allSettled(
        connectionEntries.map(async ([name, conn]) => {
          if (conn.spec.protocol === 'mcp' || !conn.spec.baseUrl) {
            return {name, status: 'connected' as const, error: undefined};
          }
          const health = await checkRestHealth(conn.spec.baseUrl, conn.spec.testPath);
          return {name, status: health.ok ? 'connected' as const : 'error' as const, error: health.error};
        }),
      );

      const connections = connectionEntries.map(([name], i) => {
        const result = healthChecks[i];
        if (result && result.status === 'fulfilled') {
          return result.value;
        }
        return {name, status: 'error' as const, error: 'Health check failed'};
      });

      res.json({
        repo_path: options.repoPath,
        name: runtime.repo.config?.name ?? '',
        model: runtime.repo.config?.models?.['main']?.model ?? '',
        provider: runtime.repo.config?.models?.['main']?.provider ?? '',
        system_prompt: compiled.systemPrompt,
        system_prompt_length: compiled.systemPrompt.length,
        token_usage: compiled.tokenUsage,
        sections: compiled.sections.map((s) => ({
          name: s.name,
          tokens: s.tokens,
          priority: s.priority,
          trimmed: s.trimmed,
        })),
        connections,
        mcpServers,
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

  /** Connection detail by name — reads repo directly, no session needed. */
  router.get('/inspect/connections/:name', (_req: Request, res: Response) => {
    const repo = options.sessionManager.getRepo();
    const conn = repo.connections.get(_req.params['name'] ?? '');

    if (!conn) {
      res.status(404).json({error: {code: 'NOT_FOUND', message: 'Connection not found'}});
      return;
    }

    res.json({
      name: conn.name,
      kind: 'rest',
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
  });

  /** MCP server detail by name — returns tools with parameter schemas. */
  router.get('/inspect/mcp/:name', async (_req: Request, res: Response) => {
    try {
      const mcpManager = await options.sessionManager.getInspectMcpManager();
      if (!mcpManager) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'No MCP servers configured'}});
        return;
      }

      const serverName = _req.params['name'] ?? '';
      const serverInfo = mcpManager.getServerInfo().find((s) => s.name === serverName);
      if (!serverInfo) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'MCP server not found'}});
        return;
      }

      // Get full tool info with parameter schemas
      const allTools = mcpManager.getDiscoveredTools();
      const serverTools = allTools
        .filter((t) => t.serverName === serverName)
        .map((t) => ({
          name: t.originalName,
          qualifiedName: t.name,
          description: t.description,
          parameters: t.parameters,
        }));

      // Get transport info from repo config
      const repo = options.sessionManager.getRepo();
      const mcpConfig = repo.mcpServers?.[serverName];

      res.json({
        name: serverName,
        kind: 'mcp',
        status: serverInfo.status,
        error: serverInfo.error ?? null,
        transport: mcpConfig?.transport ?? 'unknown',
        command: mcpConfig?.command ?? null,
        url: mcpConfig?.url ?? null,
        tools: serverTools,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'INSPECT_FAILED', message: msg}});
    }
  });

  /** Skill detail by name — reads repo directly, no session needed. */
  router.get('/inspect/skills/:name', (_req: Request, res: Response) => {
    const repo = options.sessionManager.getRepo();
    const skill = repo.skills.find((s) => s.name === _req.params['name']);

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
  });

  /** Knowledge document detail by name — reads repo directly, no session needed. */
  router.get('/inspect/knowledge/:name', (_req: Request, res: Response) => {
    const repo = options.sessionManager.getRepo();
    const doc = repo.knowledge.find((k) => k.name === _req.params['name']);

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
  });

  return router;
}
