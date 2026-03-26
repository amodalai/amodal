/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {
  AmodalRepo,
  LoadedSkill,
} from './repo-types.js';
import type {LoadedTool} from './tool-types.js';
import {ToolJsonSchema} from './tool-types.js';
import {RepoError} from './repo-types.js';
import type {LoadedConnection} from './connection-types.js';
import {
  parseConfig,
  parseConnection,
  parseSkill,
  parseKnowledge,
  parseAutomation,
  parseEval,
} from './parsers.js';

/**
 * The tree response from GET /api/repo/tree.
 */
interface RepoTree {
  connections: string[];
  skills: string[];
  agents: string[];
  knowledge: string[];
  automations: string[];
  evals: string[];
  tools: string[];
}

/**
 * Fetch a text resource from the platform API.
 * Returns null on 404, throws on other errors.
 */
async function fetchText(
  baseUrl: string,
  path: string,
  apiKey: string,
  timeout = 30000,
): Promise<string | null> {
  const url = `${baseUrl}${path}`;
  let response: Response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/plain, application/json',
      },
    });
    clearTimeout(timer);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RepoError('PLATFORM_FETCH_FAILED', `Request timed out: ${url}`, err);
    }
    throw new RepoError('PLATFORM_FETCH_FAILED', `Failed to fetch ${url}`, err);
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new RepoError(
      'PLATFORM_FETCH_FAILED',
      `HTTP ${String(response.status)} fetching ${url}`,
    );
  }

  return response.text();
}

/**
 * Fetch and parse JSON from the platform API.
 */
async function fetchJson<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  timeout = 30000,
): Promise<T> {
  const text = await fetchText(baseUrl, path, apiKey, timeout);
  if (text === null) {
    throw new RepoError('PLATFORM_FETCH_FAILED', `Resource not found: ${path}`);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(text) as T;
  } catch (err) {
    throw new RepoError('CONFIG_PARSE_FAILED', `Invalid JSON from ${path}`, err);
  }
}

/**
 * Load a single connection from the platform API.
 */
async function loadPlatformConnection(
  baseUrl: string,
  apiKey: string,
  name: string,
): Promise<LoadedConnection> {
  const basePath = `/api/repo/connections/${name}`;

  const [specJson, accessJson, surfaceMd, entitiesMd, rulesMd] = await Promise.all([
    fetchText(baseUrl, `${basePath}/spec`, apiKey),
    fetchText(baseUrl, `${basePath}/access`, apiKey),
    fetchText(baseUrl, `${basePath}/surface`, apiKey),
    fetchText(baseUrl, `${basePath}/entities`, apiKey),
    fetchText(baseUrl, `${basePath}/rules`, apiKey),
  ]);

  if (!specJson) {
    throw new RepoError('READ_FAILED', `Missing spec.json for connection "${name}"`);
  }
  if (!accessJson) {
    throw new RepoError('READ_FAILED', `Missing access.json for connection "${name}"`);
  }

  return parseConnection(
    name,
    {
      specJson,
      accessJson,
      surfaceMd: surfaceMd ?? undefined,
      entitiesMd: entitiesMd ?? undefined,
      rulesMd: rulesMd ?? undefined,
    },
    `${baseUrl}${basePath}`,
  );
}

/**
 * Load the full amodal repo from the platform API.
 */
export async function loadRepoFromPlatform(
  apiUrl: string,
  apiKey: string,
): Promise<AmodalRepo> {
  // Normalize URL — strip trailing slash
  const baseUrl = apiUrl.replace(/\/+$/, '');

  // Fetch config
  const configText = await fetchText(baseUrl, '/api/repo/config', apiKey);
  if (configText === null) {
    throw new RepoError('CONFIG_NOT_FOUND', 'Config not found on platform');
  }
  const config = parseConfig(configText);

  // Fetch directory tree
  const tree = await fetchJson<RepoTree>(baseUrl, '/api/repo/tree', apiKey);

  // Load all sections in parallel
  const [connections, skills, agents, knowledge, automations, evals, tools] = await Promise.all([
    // Connections
    (async () => {
      const map = new Map<string, LoadedConnection>();
      const loaded = await Promise.all(
        tree.connections.map(async (name) => {
          const conn = await loadPlatformConnection(baseUrl, apiKey, name);
          return [name, conn] as const;
        }),
      );
      for (const [name, conn] of loaded) {
        map.set(name, conn);
      }
      return map;
    })(),

    // Skills
    Promise.all(
      tree.skills.map(async (name) => {
        const content = await fetchText(
          baseUrl,
          `/api/repo/skills/${name}`,
          apiKey,
        );
        if (!content) return null;
        return parseSkill(content, `${baseUrl}/api/repo/skills/${name}`);
      }),
    ).then((results) => results.filter((s): s is LoadedSkill => s !== null)),

    // Agents
    (async () => {
      const [main, explore] = await Promise.all([
        fetchText(baseUrl, '/api/repo/agents/main', apiKey),
        fetchText(baseUrl, '/api/repo/agents/explore', apiKey),
      ]);
      return {
        main: main ?? undefined,
        explore: explore ?? undefined,
        subagents: [],
      };
    })(),

    // Knowledge
    Promise.all(
      tree.knowledge.map(async (name) => {
        const content = await fetchText(
          baseUrl,
          `/api/repo/knowledge/${name}`,
          apiKey,
        );
        if (!content) {
          return parseKnowledge('', name, `${baseUrl}/api/repo/knowledge/${name}`);
        }
        return parseKnowledge(content, name, `${baseUrl}/api/repo/knowledge/${name}`);
      }),
    ),

    // Automations
    Promise.all(
      tree.automations.map(async (name) => {
        const content = await fetchText(
          baseUrl,
          `/api/repo/automations/${name}`,
          apiKey,
        );
        if (!content) {
          return parseAutomation('', name, `${baseUrl}/api/repo/automations/${name}`);
        }
        return parseAutomation(content, name, `${baseUrl}/api/repo/automations/${name}`);
      }),
    ),

    // Evals
    Promise.all(
      tree.evals.map(async (name) => {
        const content = await fetchText(
          baseUrl,
          `/api/repo/evals/${name}`,
          apiKey,
        );
        if (!content) {
          return parseEval('', name, `${baseUrl}/api/repo/evals/${name}`);
        }
        return parseEval(content, name, `${baseUrl}/api/repo/evals/${name}`);
      }),
    ),

    // Tools
    Promise.all(
      (tree.tools ?? []).map(async (name) => {
        const content = await fetchText(
          baseUrl,
          `/api/repo/tools/${name}/tool.json`,
          apiKey,
        );
        if (!content) return null;
        let raw: unknown;
        try {
          raw = JSON.parse(content);
        } catch {
          return null;
        }
        const parsed = ToolJsonSchema.safeParse(raw);
        if (!parsed.success) return null;
        const toolJson = parsed.data;
        const tool: LoadedTool = {
          name: toolJson.name ?? name,
          description: toolJson.description,
          parameters: toolJson.parameters,
          confirm: toolJson.confirm,
          timeout: toolJson.timeout,
          env: toolJson.env,
          handlerPath: `${baseUrl}/api/repo/tools/${name}/handler`,
          location: `${baseUrl}/api/repo/tools/${name}`,
          hasPackageJson: false,
          hasSetupScript: false,
          hasRequirementsTxt: false,
          hasDockerfile: false,
          sandboxLanguage: toolJson.sandbox?.language ?? 'typescript',
        };
        if (toolJson.responseShaping) {
          tool.responseShaping = toolJson.responseShaping;
        }
        return tool;
      }),
    ).then((results) => results.filter((t): t is LoadedTool => t !== null)),
  ]);

  return {
    source: 'platform',
    origin: baseUrl,
    config,
    connections,
    skills,
    agents,
    knowledge,
    automations,
    evals,
    tools,
    stores: [],
  };
}
