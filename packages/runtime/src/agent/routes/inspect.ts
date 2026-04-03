/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {SessionManager} from '../../session/session-manager.js';

export interface InspectRouterOptions {
  sessionManager: SessionManager;
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

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.get('/inspect/context', async (_req: Request, res: Response) => {
    try {
      const repo = options.sessionManager.getBundle()!;
      if (!repo) {
        res.status(500).json({error: {code: 'INSPECT_FAILED', message: 'No repo available'}});
        return;
      }

      // Get MCP server info from persistent inspect manager
      const mcpManager = await options.sessionManager.getInspectMcpManager();
      const mcpServers = mcpManager
        ? mcpManager.getServerInfo().map((s: { name: string; status: string; tools: unknown[]; error?: string }) => ({
            name: s.name,
            status: s.status,
            toolCount: s.tools.length,
            error: s.error,
          }))
        : [];

      // Check connection health in parallel (REST only — MCP health checked via McpManager)
      const connectionEntries = Array.from(repo.connections.entries());
      const healthChecks = await Promise.allSettled(
        connectionEntries.map(async ([name, conn]: [string, { spec: { protocol?: string; baseUrl?: string; testPath?: string } }]) => {
          if (conn.spec.protocol === 'mcp' || !conn.spec.baseUrl) {
            return {name, status: 'connected' as const, error: undefined};
          }
          const health = await checkRestHealth(conn.spec.baseUrl, conn.spec.testPath);
          return {name, status: health.ok ? 'connected' as const : 'error' as const, error: health.error};
        }),
      );

      const connections = connectionEntries.map(([name]: [string, unknown], i: number) => {
        const result = healthChecks[i];
        if (result && result.status === 'fulfilled') {
          return result.value;
        }
        return {name, status: 'error' as const, error: 'Health check failed'};
      });

      // Build system prompt matching the real session path (buildDefaultPrompt)
      // Also compute per-item token contributions for the breakdown UI
      const modelId = repo.config?.models?.['main']?.model ?? '';
      let systemPrompt = '';
      const contributions: Array<{name: string; category: string; tokens: number; filePath?: string}> = [];

      try {
        const { buildDefaultPrompt, resolveScopeLabels, generateFieldGuidance, generateAlternativeLookupGuidance } = await import('@amodalai/core');
        const est = (text: string) => Math.ceil(text.length / 4);

        const connArray = repo.connections?.size ? Array.from(repo.connections.values()).map((conn: {name: string; surface?: Array<{included: boolean; method: string; path: string; description: string}>; entities?: string; rules?: string}) => ({
          name: conn.name,
          endpoints: (conn.surface ?? []).filter((ep) => ep.included).map((ep) => ({method: ep.method, path: ep.path, description: ep.description})),
          entities: conn.entities,
          rules: conn.rules,
        })) : undefined;
        const skillArray = repo.skills?.map((s: {name: string; description?: string; trigger?: string; body?: string}) => ({name: s.name, description: s.description ?? '', trigger: s.trigger, body: s.body ?? ''}));
        const knowledgeArray = repo.knowledge?.map((k: {name: string; title?: string; body?: string}) => ({name: k.name, title: k.title, body: k.body ?? ''}));

        // Compute scope/field/alt guidance same as session-manager
        let scopeLabels: Record<string, string> = {};
        let fieldGuidance: string | undefined;
        let altLookup: string | undefined;
        if (repo.connections?.size) {
          const scopeResult = resolveScopeLabels(repo.connections, []);
          scopeLabels = scopeResult.scopeLabels;
          fieldGuidance = generateFieldGuidance(repo.connections, []);
          altLookup = generateAlternativeLookupGuidance(repo.connections);
        }

        // Full prompt (matches session-manager)
        systemPrompt = repo.config?.basePrompt ?? buildDefaultPrompt({
          name: repo.config?.name ?? 'Agent',
          description: repo.config?.description,
          agentContext: String(repo.config?.userContext ?? repo.config?.description ?? ''),
          agentOverride: repo.agents?.main,
          connections: connArray,
          skills: skillArray,
          knowledge: knowledgeArray,
          fieldGuidance,
          scopeLabels,
          alternativeLookupGuidance: altLookup,
        });

        // Per-item contributions
        const baseOnly = buildDefaultPrompt({name: repo.config?.name ?? 'Agent', description: repo.config?.description});
        contributions.push({name: 'Base prompt', category: 'system', tokens: est(baseOnly)});

        if (repo.agents?.main) {
          contributions.push({name: 'Agent override', category: 'system', tokens: est(repo.agents.main)});
        }

        // Individual connections
        if (repo.connections?.size) {
          for (const [, conn] of repo.connections) {
            const surface = (conn.surface ?? []).filter((ep: {included: boolean}) => ep.included);
            const parts: string[] = [];
            for (const ep of surface) {
              parts.push(`${ep.method} ${ep.path} — ${ep.description}`);
            }
            if (conn.entities) parts.push(conn.entities);
            if (conn.rules) parts.push(conn.rules);
            contributions.push({name: conn.name, category: 'connection', tokens: est(parts.join('\n')), filePath: `connections/${conn.name}/surface.md`});
          }
        }

        // Individual skills
        if (repo.skills) {
          for (const skill of repo.skills) {
            const parts = [skill.description ?? ''];
            if (skill.trigger) parts.push(skill.trigger);
            if (skill.body) parts.push(skill.body);
            contributions.push({name: skill.name, category: 'skill', tokens: est(parts.join('\n')), filePath: `skills/${skill.name}/SKILL.md`});
          }
        }

        // Individual knowledge docs
        if (repo.knowledge) {
          for (const doc of repo.knowledge) {
            const knowledgePath = doc.location ? doc.location.replace(/^.*?\/(knowledge\/)/, '$1') : undefined;
            contributions.push({name: doc.title ?? doc.name, category: 'knowledge', tokens: est(doc.body ?? ''), filePath: knowledgePath});
          }
        }

        if (fieldGuidance) {
          contributions.push({name: 'Field guidance', category: 'system', tokens: est(fieldGuidance)});
        }
        if (altLookup) {
          contributions.push({name: 'Alternative lookups', category: 'system', tokens: est(altLookup)});
        }
      } catch {
        const { buildDefaultPrompt } = await import('@amodalai/core');
        systemPrompt = repo.config?.basePrompt ?? buildDefaultPrompt({
          name: repo.config?.name ?? 'Agent',
          description: repo.config?.description,
        });
      }

      // Sort by tokens descending, take top 10
      contributions.sort((a, b) => b.tokens - a.tokens);

      const { getModelContextWindow } = await import('@amodalai/core');
      const contextWindow = getModelContextWindow(modelId);
      const estimatedTokens = Math.ceil(systemPrompt.length / 4);
      const tokenUsage = {
        total: contextWindow,
        used: estimatedTokens,
        remaining: contextWindow - estimatedTokens,
        sectionBreakdown: Object.fromEntries(contributions.map((c) => [c.name, c.tokens])),
      };

      res.json({
        repo_path: options.repoPath,
        name: repo.config?.name ?? '',
        model: modelId,
        provider: repo.config?.models?.['main']?.provider ?? '',
        system_prompt: systemPrompt,
        system_prompt_length: systemPrompt.length,
        token_usage: tokenUsage,
        contributions,
        connections,
        mcpServers,
        skills: repo.skills.map((s: { name: string }) => s.name),
        automations: repo.automations.map((a: { name: string }) => a.name),
        knowledge: repo.knowledge.map((k: { name: string }) => k.name),
      });
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
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.get('/inspect/connections/:name', async (_req: Request, res: Response) => {
    const repo = options.sessionManager.getBundle()!;
    const connName = _req.params['name'] ?? '';
    const conn = repo.connections.get(connName);

    if (!conn) {
      res.status(404).json({error: {code: 'NOT_FOUND', message: 'Connection not found'}});
      return;
    }

    // MCP connections defined in connections/ folder — return tools from MCP manager
    if (conn.spec.protocol === 'mcp') {
      try {
        const mcpManager = await options.sessionManager.getInspectMcpManager();
        const serverInfo = mcpManager?.getServerInfo().find((s) => s.name === connName);
        const allTools = mcpManager?.getDiscoveredTools() ?? [];
        const serverTools = allTools
          .filter((t) => t.serverName === connName)
          .map((t) => ({
            name: t.originalName,
            qualifiedName: t.name,
            description: t.description,
            parameters: t.parameters,
          }));

        res.json({
          name: connName,
          kind: 'mcp',
          status: serverInfo?.status ?? 'unknown',
          error: serverInfo?.error ?? null,
          transport: conn.spec.transport ?? 'unknown',
          command: conn.spec.command ?? null,
          url: conn.spec.url ?? null,
          tools: serverTools,
          location: conn.location,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({error: {code: 'INSPECT_FAILED', message: msg}});
      }
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
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
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
      const repo = options.sessionManager.getBundle()!;
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
    const repo = options.sessionManager.getBundle()!;
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
    const repo = options.sessionManager.getBundle()!;
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
