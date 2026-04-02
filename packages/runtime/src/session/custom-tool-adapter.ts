/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { LoadedTool, CustomToolExecutor, CustomToolContext } from '@amodalai/core';
import type { ManagedSession } from './session-manager.js';

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

        const baseUrl = typeof connConfig === 'object' && connConfig !== null && 'baseUrl' in connConfig
          ? String((connConfig as Record<string, unknown>)['baseUrl'] ?? '')
          : '';

        if (!baseUrl) {
          throw new Error(`Connection "${connection}" has no baseUrl`);
        }

        const url = `${baseUrl}${endpoint}`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        // Apply connection auth
         
        const conn = connConfig as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth config shape
        const auth = conn['auth'] as Record<string, unknown> | undefined;
        if (auth) {
          const token = String(auth['token'] ?? '');
          const header = String(auth['header'] ?? 'Authorization');
          const prefix = auth['prefix'] ? `${String(auth['prefix'])} ` : '';
          // Resolve env: references
          const resolvedToken = token.startsWith('env:')
            ? process.env[token.slice(4)] ?? ''
            : token;
          if (resolvedToken) {
            headers[header] = `${prefix}${resolvedToken}`;
          }
        }

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
        process.stderr.write(`[TOOL:${tool.name}] ${message}\n`);
      },

      user: { roles: [] },

      signal: combinedSignal,
    };
  }
}
