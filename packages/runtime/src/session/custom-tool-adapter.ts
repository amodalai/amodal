/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { LoadedTool, CustomToolExecutor, CustomToolContext } from '@amodalai/core';
import { resolveKey } from '../stores/key-resolver.js';
import { LOCAL_APP_ID } from '../constants.js';
import type { ManagedSession } from './session-manager.js';
import { log } from '../logger.js';

/**
 * Adapts a repo LoadedTool to the upstream tool registry interface.
 * Wraps the tool definition and delegates execution to the CustomToolExecutor.
 */
export class CustomToolAdapter {
  readonly name: string;
  readonly displayName: string;
  private readonly tool: LoadedTool;
  private readonly session: ManagedSession;
  private readonly executor: CustomToolExecutor;
  readonly kind = 'declarative' as const;

  readonly description: string;
  readonly parameterSchema: Record<string, unknown>;

  constructor(tool: LoadedTool, session: ManagedSession, executor: CustomToolExecutor) {
    this.name = tool.name;
    this.displayName = tool.name;
    this.description = tool.description;
    this.parameterSchema = tool.parameters;
    this.tool = tool;
    this.session = session;
    this.executor = executor;
  }

  get isReadOnly() {
    return this.tool.confirm === false;
  }

  get toolAnnotations() {
    return undefined;
  }

  getSchema(_modelId?: string) {
    return {
      name: this.name,
      description: this.description,
      parametersJsonSchema: this.parameterSchema,
    };
  }

  get schema() {
    return this.getSchema();
  }

  /**
   * Silently build an invocation (used by upstream tool execution flow).
   */
  /**
   * Build an invocation object from params — used by Scheduler.
   */
  build(params: Record<string, unknown>) {
    return {
      name: this.name,
      execute: async (abortSignal: AbortSignal) => this.validateBuildAndExecute(params, abortSignal),
    };
  }

  silentBuild(params: Record<string, unknown>) {
    return this.build(params);
  }

  /**
   * Build and execute in one step — matches the upstream DeclarativeTool interface.
   */
  async validateBuildAndExecute(
    params: Record<string, unknown>,
    abortSignal: AbortSignal,
  ): Promise<{ llmContent: string; returnDisplay?: string; error?: { message: string; type: string } }> {
    try {
      const ctx = this.buildContext(abortSignal);
      const result = await this.executor.execute(this.tool, params, ctx);
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      return { llmContent: content, returnDisplay: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        llmContent: `Error: ${message}`,
        returnDisplay: message,
        error: { message, type: 'EXECUTION_FAILED' },
      };
    }
  }

  private buildContext(signal: AbortSignal): CustomToolContext {
    const tool = this.tool;
    const session = this.session;
    const timeoutSignal = AbortSignal.timeout(tool.timeout);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

    return {
      async request(connection, endpoint, params) {
        const connections = session.config.getConnections();
        const connConfig = connections[connection];
        if (!connConfig) {
          throw new Error(`Connection "${connection}" not found`);
        }

        const method = params?.method ?? 'GET';
        if (tool.confirm === false && method !== 'GET') {
          throw new Error(
            `Tool "${tool.name}" has confirm: false — only GET requests are allowed.`,
          );
        }

         
        const conn = connConfig as Record<string, unknown>;
        const baseUrl = String(conn['base_url'] ?? '');

        if (!baseUrl) {
          throw new Error(`Connection "${connection}" has no base_url`);
        }

        // Build headers — start with defaults, apply auth from _request_config
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- internal config shape
        const reqConfig = conn['_request_config'] as {
          auth?: Array<{ header: string; value_template: string }>;
          default_headers?: Record<string, string>;
        } | undefined;

        if (reqConfig?.default_headers) {
          Object.assign(headers, reqConfig.default_headers);
        }

        if (reqConfig?.auth) {
          for (const authEntry of reqConfig.auth) {
            // value_template is pre-resolved by buildConnectionsMap
            headers[authEntry.header] = authEntry.value_template;
          }
        }

        const url = `${baseUrl}${endpoint}`;
        const fetchOpts: RequestInit = {
          method,
          signal: combinedSignal,
          headers,
        };
        if (params?.data) {
          fetchOpts.body = JSON.stringify(params.data);
        }

        const res = await fetch(url, fetchOpts);
        const body = await res.text();
        try {
           
          return JSON.parse(body) as unknown;
        } catch {
          return { text: body, status: res.status };
        }
      },

      async store(storeName: string, payload: Record<string, unknown>) {
        if (!session.storeBackend) {
          throw new Error('Store backend not available');
        }
        const stores = session.config.getStores();
        const storeDef = stores.find((s: {name: string}) => s.name === storeName);
        if (!storeDef) {
          throw new Error(`Store "${storeName}" not found`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- store entity shape
        const entityKey = (storeDef as unknown as {entity: {key: string}}).entity.key;
        const key = resolveKey(entityKey, payload);
        const appId = session.appId ?? LOCAL_APP_ID;
        await session.storeBackend.put(appId, storeName, key, payload, {});
        return { key };
      },

      async exec(command, options) {
        const { exec: execCb } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(execCb);
        try {
          const { stdout, stderr } = await execAsync(command, {
            signal: combinedSignal,
            timeout: options?.timeout ?? tool.timeout,
            cwd: options?.cwd,
          });
          return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- exec error shape
          const e = err as { stdout?: string; stderr?: string; code?: number };
          return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
        }
      },

      env(name: string) {
        if (!tool.env.includes(name)) return undefined;
        return process.env[name];
      },

      log(message: string) {
        log.info(message, `tool:${tool.name}`);
      },

      user: { roles: [] },

      signal: combinedSignal,
    };
  }
}
