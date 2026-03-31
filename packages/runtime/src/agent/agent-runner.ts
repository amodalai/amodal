/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {
  EXPLORE_TOOL_NAME,
  EXPLORE_TOOL_SCHEMA,
  validateExploreRequest,
  resolveExploreModel,
  FailoverProvider,
  storeToJsonSchema,
  storeToToolName,
  findStoreByToolName,
} from '@amodalai/core';
import type {
  LLMToolDefinition,
  LLMToolResultMessage,
  LLMResponseBlock,
  LLMStreamEvent,
  LLMMessage,
} from '@amodalai/core';
import type {LoadedTool, LoadedStore} from '@amodalai/core';
import {resolveKey} from '../stores/key-resolver.js';
import type {AgentSession} from './agent-types.js';
import type {SSEEvent, SSESubagentEvent} from '../types.js';
import {SSEEventType} from '../types.js';
import {makeApiRequest} from './request-helper.js';
import {buildToolContext} from './tool-context-builder.js';
import {LocalToolExecutor} from './tool-executor-local.js';

const MAX_TURNS = 15;

/**
 * Runs an agent turn as a ReAct loop, yielding SSE events.
 *
 * Uses FailoverProvider for multi-provider support with retry + fallback.
 */
export async function* runAgentTurn(
  session: AgentSession,
  message: string,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  // Append user message
  session.conversationHistory.push({role: 'user', content: message});

  const modelConfig = session.runtime.repo.config.models.main;

  let provider: FailoverProvider;
  try {
    provider = new FailoverProvider(modelConfig);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    yield {
      type: SSEEventType.Error,
      message: `Provider initialization failed: ${errMsg}`,
      timestamp: ts(),
    };
    yield {type: SSEEventType.Done, timestamp: ts()};
    return;
  }

  const tools = buildTools(session);
  const systemPrompt = buildSystemPrompt(session);

  let turns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (turns < MAX_TURNS) {
    if (signal.aborted) {
      yield {type: SSEEventType.Error, message: 'Request aborted', timestamp: ts()};
      yield {type: SSEEventType.Done, timestamp: ts()};
      return;
    }

    turns++;

    try {
      const chatRequest = {
        model: modelConfig.model,
        systemPrompt,
        messages: session.conversationHistory,
        tools,
        maxTokens: 4096,
        signal,
      };

      // Use streaming when available for real-time text delivery
      if (provider.chatStream) {
        const {content, hasToolUse, toolResults, usage: streamUsage} = yield* processStream(
          provider.chatStream(chatRequest),
          session,
          signal,
        );

        // Store assistant message
        session.conversationHistory.push({role: 'assistant', content});
        if (streamUsage) {
          totalInputTokens += streamUsage.inputTokens;
          totalOutputTokens += streamUsage.outputTokens;
        }

        if (hasToolUse && toolResults.length > 0) {
          session.conversationHistory.push(...toolResults);
          continue;
        }
        break;
      }

      // Non-streaming fallback
      const response = await provider.chat(chatRequest);

      let hasToolUse = false;
      const toolResults: LLMToolResultMessage[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          const processed = processTextOutput(session, block.text);
          yield {type: SSEEventType.TextDelta, content: processed, timestamp: ts()};
        } else if (block.type === 'tool_use') {
          hasToolUse = true;

          yield {
            type: SSEEventType.ToolCallStart,
            tool_name: block.name,
            tool_id: block.id,
            parameters: block.input,
            timestamp: ts(),
          };

          // Emit ExploreStart before execution
          if (block.name === EXPLORE_TOOL_NAME) {
            yield {
              type: SSEEventType.ExploreStart,
              query: String(block.input['query'] ?? ''),
              timestamp: ts(),
            };
          }

          const startMs = Date.now();
          const execResult = await executeTool(session, block.name, block.input, block.id, signal);
          const durationMs = Date.now() - startMs;

          // Emit subagent events from explore
          if (execResult.subagentEvents) {
            for (const evt of execResult.subagentEvents) {
              yield evt;
            }
          }

          // Emit ExploreEnd after execution
          if (block.name === EXPLORE_TOOL_NAME && execResult.exploreResult) {
            yield {
              type: SSEEventType.ExploreEnd,
              summary: execResult.exploreResult.summary,
              tokens_used: execResult.exploreResult.tokensUsed,
              timestamp: ts(),
            };
          }

          yield {
            type: SSEEventType.ToolCallResult,
            tool_id: block.id,
            status: execResult.result.error ? 'error' : 'success',
            result: execResult.result.output,
            error: execResult.result.error,
            duration_ms: durationMs,
            timestamp: ts(),
          };

          toolResults.push({
            role: 'tool_result',
            toolCallId: block.id,
            content: execResult.result.error ?? execResult.result.output ?? '',
            isError: !!execResult.result.error,
          });
        }
      }

      session.conversationHistory.push({role: 'assistant', content: response.content});
      if (response.usage) {
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      if (hasToolUse && toolResults.length > 0) {
        session.conversationHistory.push(...toolResults);
        continue;
      }

      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield {type: SSEEventType.Error, message: `LLM error: ${errMsg}`, timestamp: ts()};
      break;
    }
  }

  if (turns >= MAX_TURNS) {
    yield {
      type: SSEEventType.Error,
      message: `Agent loop exceeded max turns (${MAX_TURNS})`,
      timestamp: ts(),
    };
  }

  const doneEvent: SSEEvent = {
    type: SSEEventType.Done,
    timestamp: ts(),
    usage: totalInputTokens > 0 ? {input_tokens: totalInputTokens, output_tokens: totalOutputTokens, cached_tokens: 0, total_tokens: totalInputTokens + totalOutputTokens} : undefined,
  };
  yield doneEvent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString();
}

function buildSystemPrompt(session: AgentSession): string {
  const parts = [session.runtime.compiledContext.systemPrompt];

  const planReminder = session.planModeManager.getPlanningReminder();
  if (planReminder) {
    parts.push(planReminder);
  }

  const approvedPlan = session.planModeManager.getApprovedPlanContext();
  if (approvedPlan) {
    parts.push(approvedPlan);
  }

  return parts.join('\n\n');
}

function buildTools(session: AgentSession): LLMToolDefinition[] {
  const tools: LLMToolDefinition[] = [];

  // Request tool (for connected systems)
  tools.push({
    name: 'request',
    description: 'Make HTTP requests to connected systems. Specify connection name, method, endpoint, and optional params/data.',
    parameters: {
      type: 'object',
      properties: {
        connection: {type: 'string', description: 'Connection name'},
        method: {type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']},
        endpoint: {type: 'string', description: 'API endpoint path'},
        params: {type: 'object', description: 'Query parameters'},
        data: {description: 'Request body'},
        intent: {type: 'string', enum: ['read', 'write', 'confirmed_write']},
      },
      required: ['connection', 'method', 'endpoint', 'intent'],
    },
  });

  // Explore tool
  tools.push({
    name: EXPLORE_TOOL_NAME,
    description: EXPLORE_TOOL_SCHEMA.description,
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string', description: 'What to investigate'},
        endpoint_hints: {
          type: 'array',
          items: {type: 'string'},
          description: 'Optional endpoint paths to prioritize',
        },
        model: {
          type: 'string',
          description: 'Optional: "simple" for lightweight, "default" for standard, "advanced" for primary model, or "provider:model" for specific',
        },
      },
      required: ['query'],
    },
  });

  // Plan mode tools
  tools.push({
    name: 'enter_plan_mode',
    description: 'Enter planning mode. Write operations will be blocked until a plan is approved.',
    parameters: {
      type: 'object',
      properties: {
        reason: {type: 'string', description: 'Why planning mode is needed'},
      },
    },
  });

  tools.push({
    name: 'exit_plan_mode',
    description: 'Exit planning mode.',
    parameters: {
      type: 'object',
      properties: {},
    },
  });

  // Custom tools from tools/ directory
  for (const tool of session.runtime.repo.tools) {
    // Skip tools marked as hidden from the LLM
    if (tool.confirm === 'never') {
      continue;
    }
    tools.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  }

  // MCP tools from connected MCP servers
  if (session.mcpManager) {
    for (const mcpTool of session.mcpManager.getDiscoveredTools()) {
      tools.push({
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.parameters,
      });
    }
  }

  // Store write tools (one per store — schema as parameters for structured output)
  for (const store of session.runtime.repo.stores) {
    tools.push({
      name: storeToToolName(store.name),
      description: `Store a ${store.entity.name} to the ${store.name} collection.`,
      parameters: storeToJsonSchema(store),
    });
  }

  // Store query tool (single tool for reading from any store)
  if (session.runtime.repo.stores.length > 0) {
    tools.push({
      name: 'query_store',
      description: 'Query documents from a store collection. Use "key" for a single document or "filter" for a list.',
      parameters: {
        type: 'object',
        properties: {
          store: {
            type: 'string',
            enum: session.runtime.repo.stores.map((s) => s.name),
            description: 'The store to query',
          },
          key: {type: 'string', description: 'Get a specific document by key'},
          filter: {type: 'object', description: 'Filter by field values (equality match)'},
          sort: {type: 'string', description: 'Sort field, prefix with - for descending'},
          limit: {type: 'number', description: 'Max documents to return (default: 20)'},
        },
        required: ['store'],
      },
    });
  }

  // Shell execution tool (opt-in via config.sandbox.shellExec)
  if (session.runtime.repo.config.sandbox?.shellExec) {
    tools.push({
      name: 'shell_exec',
      description: 'Execute a shell command. Use for data transformation, computation, scripting, or anything that benefits from code execution.',
      parameters: {
        type: 'object',
        properties: {
          command: {type: 'string', description: 'The shell command to execute'},
        },
        required: ['command'],
      },
    });
  }

  return tools;
}

interface ToolResult {
  output?: string;
  error?: string;
}

interface ToolExecutionResult {
  result: ToolResult;
  subagentEvents?: SSESubagentEvent[];
  exploreResult?: {summary: string; tokensUsed: number};
}

async function executeTool(
  session: AgentSession,
  toolName: string,
  args: Record<string, unknown>,
  toolId: string,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case 'request':
      return {result: await executeRequestTool(session, args, signal)};
    case EXPLORE_TOOL_NAME:
      return executeExploreTool(session, args, toolId, signal);
    case 'enter_plan_mode':
      return {result: await executePlanModeEnter(session, args)};
    case 'exit_plan_mode':
      return {result: await executePlanModeExit(session)};
    case 'shell_exec':
      return {result: await executeShellExecTool(session, args, signal)};
    case 'query_store':
      return {result: await executeQueryStore(session, args)};
    default: {
      // Check store write tools (store_* prefix)
      if (toolName.startsWith('store_')) {
        const store = findStoreByToolName(session.runtime.repo.stores, toolName);
        if (store) {
          return {result: await executeStorePut(session, store, args)};
        }
      }

      // Check custom tools
      const customTool = session.runtime.repo.tools.find((t) => t.name === toolName);
      if (customTool) {
        return {result: await executeCustomTool(session, customTool, args, signal)};
      }

      // Check MCP tools (namespaced as serverName__toolName)
      if (session.mcpManager?.isMcpTool(toolName)) {
        return {result: await executeMcpTool(session, toolName, args)};
      }

      // Build helpful error for unknown tools
      if (toolName.includes('__')) {
        const [serverName] = toolName.split('__', 2);
        const mcpTools = session.mcpManager?.getDiscoveredTools() ?? [];
        const fromServer = mcpTools.filter((t) => t.serverName === serverName);
        if (fromServer.length > 0) {
          const names = fromServer.map((t) => t.name).slice(0, 10).join(', ');
          return {result: {error: `MCP tool "${toolName}" not found on server "${serverName}". Available: ${names}`}};
        }
        const servers = [...new Set(mcpTools.map((t) => t.serverName))];
        return {result: {error: `MCP server "${serverName}" not found. Available MCP servers: ${servers.join(', ') || '(none)'}. MCP tools use the format: serverName__toolName`}};
      }

      return {result: {error: `Unknown tool: "${toolName}". Available tools: request, explore, enter_plan_mode, exit_plan_mode`}};
    }
  }
}

async function executeRequestTool(
  session: AgentSession,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  const connectionName = String(args['connection'] ?? '');
  const method = String(args['method'] ?? 'GET');
  const endpoint = String(args['endpoint'] ?? '');
  const intent = String(args['intent'] ?? 'read');
  const params = args['params'];
  const data = args['data'];

  // Action gate for writes
  if (intent === 'write' || intent === 'confirmed_write') {
    if (session.planModeManager.isActive()) {
      return {error: 'Write operations are blocked in plan mode. Present your plan for approval first.'};
    }

    const gateResult = session.runtime.actionGate.evaluate(endpoint, connectionName);
    if (gateResult['decision'] === 'never') {
      return {error: `Write to ${endpoint} is blocked: ${gateResult['reason'] ?? 'policy'}`};
    }

    if (gateResult['decision'] === 'confirm' && intent !== 'confirmed_write') {
      return {error: `Write to ${endpoint} requires confirmation. Re-call with intent: "confirmed_write".`};
    }
  }

  return makeApiRequest(session, connectionName, method, endpoint, params, data, signal);
}

// Lazy-initialized executor (shared across all custom tool calls)
let localToolExecutor: LocalToolExecutor | null = null;

async function executeCustomTool(
  session: AgentSession,
  tool: LoadedTool,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  // Confirmation gating for tools that require it
  if (tool.confirm === true || tool.confirm === 'review') {
    if (session.planModeManager.isActive()) {
      return {error: 'Custom tool writes are blocked in plan mode. Present your plan for approval first.'};
    }
  }

  const ctx = buildToolContext(session, tool, signal);

  if (!localToolExecutor) {
    localToolExecutor = new LocalToolExecutor();
  }

  const executor = session.toolExecutor ?? localToolExecutor;

  try {
    const result = await executor.execute(tool, args, ctx);
    return {output: JSON.stringify(result)};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {error: message};
  }
}

async function executeMcpTool(
  session: AgentSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!session.mcpManager) {
    return {error: 'MCP is not configured'};
  }

  try {
    const result = await session.mcpManager.callTool(toolName, args);

    if (result.isError) {
      const errorText = result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
      return {error: errorText || 'MCP tool returned an error'};
    }

    const output = result.content
      .map((c) => {
        if (c.type === 'text' && c.text) return c.text;
        if (c.type === 'image' && c.data) return `[image: ${c.mimeType ?? 'unknown'}]`;
        return `[${c.type}]`;
      })
      .join('\n');

    return {output};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('unreachable')) {
      return {error: `MCP server for "${toolName}" is unreachable: ${message}. The MCP server may have crashed or the URL may be wrong.`};
    }
    if (message.includes('401') || message.includes('403') || message.includes('missing_token') || message.includes('invalid_token')) {
      return {error: `MCP authentication failed for "${toolName}": ${message}. Check that the auth headers and credentials are configured correctly in amodal.json.`};
    }
    return {error: `MCP tool call failed for "${toolName}": ${message}`};
  }
}

async function executeShellExecTool(
  session: AgentSession,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  const command = String(args['command'] ?? '');
  if (!command) {
    return {error: 'Missing required parameter: command'};
  }

  const shellExecutor = session.shellExecutor;
  if (!shellExecutor) {
    return {error: 'Shell execution is not available'};
  }

  const maxTimeout = session.runtime.repo.config.sandbox?.maxTimeout ?? 30000;

  try {
    const result = await shellExecutor.exec(command, maxTimeout, signal);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return {output: `Exit code: ${result.exitCode}\n${output}`};
  } catch (err) {
    if (signal.aborted) {
      return {error: 'Shell execution aborted'};
    }
    return {error: err instanceof Error ? err.message : String(err)};
  }
}

// ---------------------------------------------------------------------------
// Store tools
// ---------------------------------------------------------------------------

async function executeStorePut(
  session: AgentSession,
  store: LoadedStore,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!session.storeBackend) {
    return {error: 'Store backend is not configured'};
  }

  // Block writes in plan mode
  if (session.planModeManager.isActive()) {
    return {error: 'Store writes are blocked in plan mode. Present your plan for approval first.'};
  }

  // Resolve key from template
  let key: string;
  try {
    key = resolveKey(store.entity.key, args);
  } catch (err) {
    return {error: err instanceof Error ? err.message : String(err)};
  }

  try {
    const result = await session.storeBackend.put(
      session.appId,
      store.name,
      key,
      args,
      {},
    );
    return {output: JSON.stringify(result)};
  } catch (err) {
    return {error: err instanceof Error ? err.message : String(err)};
  }
}

async function executeQueryStore(
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!session.storeBackend) {
    return {error: 'Store backend is not configured'};
  }

  const storeName = String(args['store'] ?? '');
  if (!storeName) {
    return {error: 'Missing required parameter: store'};
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tool args from LLM
  const key = args['key'] as string | undefined;

  try {
    if (key) {
      // Single document lookup
      const doc = await session.storeBackend.get(session.appId, storeName, key);
      if (!doc) {
        return {output: JSON.stringify({found: false, key})};
      }
      return {output: JSON.stringify({found: true, ...doc})};
    }

    // List with optional filtering
    const result = await session.storeBackend.list(session.appId, storeName, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      filter: args['filter'] as Record<string, unknown> | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tool args from LLM
      sort: args['sort'] as string | undefined,
      limit: typeof args['limit'] === 'number' ? args['limit'] : 20,
    });
    return {output: JSON.stringify(result)};
  } catch (err) {
    return {error: err instanceof Error ? err.message : String(err)};
  }
}

// ---------------------------------------------------------------------------
// Explore tool
// ---------------------------------------------------------------------------

async function executeExploreTool(
  session: AgentSession,
  args: Record<string, unknown>,
  parentToolId: string,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  const query = String(args['query'] ?? '');
  const endpointHints = Array.isArray(args['endpoint_hints'])
    ? args['endpoint_hints'].filter((h): h is string => typeof h === 'string')
    : undefined;
  const modelOverride = typeof args['model'] === 'string' ? args['model'] : undefined;

  const validationError = validateExploreRequest(
    {query, endpointHints, parentDepth: 0},
    session.exploreConfig,
  );

  if (validationError) {
    return {result: {error: validationError}};
  }

  // Resolve model override against available models
  const effectiveModel = resolveExploreModel(session.exploreConfig, modelOverride);

  const {result, events, tokensUsed} = await runExploreAgent(
    session,
    query,
    endpointHints,
    0,
    parentToolId,
    signal,
    effectiveModel,
  );

  return {
    result,
    subagentEvents: events,
    exploreResult: {summary: result.output ?? '', tokensUsed},
  };
}

// ---------------------------------------------------------------------------
// Explore sub-agent
// ---------------------------------------------------------------------------

async function runExploreAgent(
  session: AgentSession,
  query: string,
  endpointHints: string[] | undefined,
  parentDepth: number,
  parentToolId: string,
  signal: AbortSignal,
  modelOverride?: import('@amodalai/core').ModelConfig,
): Promise<{result: ToolResult; events: SSESubagentEvent[]; tokensUsed: number}> {
  const config = session.exploreConfig;
  const events: SSESubagentEvent[] = [];
  let tokensUsed = 0;

  const effectiveModel = modelOverride ?? config.model;

  let provider: FailoverProvider;
  try {
    provider = new FailoverProvider(effectiveModel);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    events.push({
      type: SSEEventType.SubagentEvent,
      parent_tool_id: parentToolId,
      agent_name: 'explore',
      event_type: 'error',
      error: `Provider init failed: ${errMsg}`,
      timestamp: ts(),
    });
    return {result: {error: `Explore provider failed: ${errMsg}`}, events, tokensUsed};
  }

  // Build sub-agent tools: always request (read-only)
  const subTools: LLMToolDefinition[] = [{
    name: 'request',
    description: 'Make HTTP requests to connected systems (read-only).',
    parameters: {
      type: 'object',
      properties: {
        connection: {type: 'string', description: 'Connection name'},
        method: {type: 'string', enum: ['GET']},
        endpoint: {type: 'string', description: 'API endpoint path'},
        params: {type: 'object', description: 'Query parameters'},
        intent: {type: 'string', enum: ['read']},
      },
      required: ['connection', 'method', 'endpoint', 'intent'],
    },
  }];

  // Allow nested explore if depth permits
  if (parentDepth + 1 < config.maxDepth) {
    subTools.push({
      name: EXPLORE_TOOL_NAME,
      description: EXPLORE_TOOL_SCHEMA.description,
      parameters: {
        type: 'object',
        properties: {
          query: {type: 'string', description: 'What to investigate'},
          endpoint_hints: {
            type: 'array',
            items: {type: 'string'},
            description: 'Optional endpoint paths to prioritize',
          },
          model: {
            type: 'string',
            description: 'Optional: "simple", "default", "complex", or "provider:model"',
          },
        },
        required: ['query'],
      },
    });
  }

  // Build initial message
  const hintsStr = endpointHints?.length ? `\nEndpoint hints: ${endpointHints.join(', ')}` : '';
  const conversation: LLMMessage[] = [
    {role: 'user', content: `Investigate: ${query}${hintsStr}`},
  ];

  let summaryParts: string[] = [];

  for (let turn = 0; turn < config.maxTurns; turn++) {
    if (signal.aborted) {
      events.push({
        type: SSEEventType.SubagentEvent,
        parent_tool_id: parentToolId,
        agent_name: 'explore',
        event_type: 'error',
        error: 'Aborted',
        timestamp: ts(),
      });
      return {result: {error: 'Explore sub-agent aborted'}, events, tokensUsed};
    }

    let response;
    try {
      response = await provider.chat({
        model: effectiveModel.model,
        systemPrompt: config.systemPrompt,
        messages: conversation,
        tools: subTools,
        maxTokens: 4096,
        signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      events.push({
        type: SSEEventType.SubagentEvent,
        parent_tool_id: parentToolId,
        agent_name: 'explore',
        event_type: 'error',
        error: errMsg,
        timestamp: ts(),
      });
      return {result: {error: `Explore LLM error: ${errMsg}`}, events, tokensUsed};
    }

    if (response.usage) {
      tokensUsed += response.usage.inputTokens + response.usage.outputTokens;
    }

    let hasToolUse = false;
    const toolResults: LLMToolResultMessage[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        summaryParts.push(block.text);
        events.push({
          type: SSEEventType.SubagentEvent,
          parent_tool_id: parentToolId,
          agent_name: 'explore',
          event_type: 'thought',
          text: block.text,
          timestamp: ts(),
        });
      } else if (block.type === 'tool_use') {
        hasToolUse = true;

        events.push({
          type: SSEEventType.SubagentEvent,
          parent_tool_id: parentToolId,
          agent_name: 'explore',
          event_type: 'tool_call_start',
          tool_name: block.name,
          tool_args: block.input,
          timestamp: ts(),
        });

        let toolResult: ToolResult;
        if (block.name === 'request') {
          toolResult = await executeSubAgentRequest(session, block.input, signal);
        } else if (block.name === EXPLORE_TOOL_NAME) {
          // Nested explore
          const nestedQuery = String(block.input['query'] ?? '');
          const nestedHints = Array.isArray(block.input['endpoint_hints'])
            ? (block.input['endpoint_hints'] as unknown[]).filter((h): h is string => typeof h === 'string')
            : undefined;
          const nestedModelParam = typeof block.input['model'] === 'string' ? block.input['model'] : undefined;
          const nestedModel = resolveExploreModel(config, nestedModelParam);
          const nested = await runExploreAgent(
            session, nestedQuery, nestedHints,
            parentDepth + 1, parentToolId, signal, nestedModel,
          );
          events.push(...nested.events);
          tokensUsed += nested.tokensUsed;
          toolResult = nested.result;
        } else {
          toolResult = {error: `Unknown tool in explore: ${block.name}`};
        }

        events.push({
          type: SSEEventType.SubagentEvent,
          parent_tool_id: parentToolId,
          agent_name: 'explore',
          event_type: 'tool_call_end',
          tool_name: block.name,
          result: toolResult.error ?? toolResult.output,
          timestamp: ts(),
        });

        toolResults.push({
          role: 'tool_result',
          toolCallId: block.id,
          content: toolResult.error ?? toolResult.output ?? '',
          isError: !!toolResult.error,
        });
      }
    }

    conversation.push({role: 'assistant', content: response.content});

    if (hasToolUse && toolResults.length > 0) {
      conversation.push(...toolResults);
      summaryParts = []; // Reset — final text is the real summary
      continue;
    }

    // No tool use — sub-agent is done
    break;
  }

  const summary = summaryParts.join('\n').trim() || 'No findings.';

  events.push({
    type: SSEEventType.SubagentEvent,
    parent_tool_id: parentToolId,
    agent_name: 'explore',
    event_type: 'complete',
    result: summary,
    timestamp: ts(),
  });

  return {result: {output: summary}, events, tokensUsed};
}

async function executeSubAgentRequest(
  session: AgentSession,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  // Force read-only intent
  const readOnlyArgs = {...args, intent: 'read', method: 'GET'};
  return executeRequestTool(session, readOnlyArgs, signal);
}

function executePlanModeEnter(
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const reason = typeof args['reason'] === 'string' ? args['reason'] : undefined;
  session.planModeManager.enter(reason);
  return Promise.resolve({output: 'Plan mode activated. Present your plan for approval.'});
}

function executePlanModeExit(session: AgentSession): Promise<ToolResult> {
  session.planModeManager.exit();
  return Promise.resolve({output: 'Plan mode deactivated.'});
}

/**
 * Process a streaming LLM response, yielding SSE events and accumulating
 * the complete response for conversation history.
 */
async function* processStream(
  stream: AsyncGenerator<LLMStreamEvent>,
  session: AgentSession,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent, {content: LLMResponseBlock[]; hasToolUse: boolean; toolResults: LLMToolResultMessage[]; usage?: {inputTokens: number; outputTokens: number}}> {
  const content: LLMResponseBlock[] = [];
  const toolResults: LLMToolResultMessage[] = [];
  let hasToolUse = false;
  let turnUsage: {inputTokens: number; outputTokens: number} | undefined;

  // Accumulate text and tool call data from stream events
  let currentText = '';
  const toolInputBuffers = new Map<string, {name: string; json: string}>();

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta': {
        currentText += event.text;
        const processed = processTextOutput(session, event.text);
        yield {type: SSEEventType.TextDelta, content: processed, timestamp: ts()};
        break;
      }

      case 'tool_use_start':
        hasToolUse = true;
        toolInputBuffers.set(event.id, {name: event.name, json: ''});
        yield {
          type: SSEEventType.ToolCallStart,
          tool_name: event.name,
          tool_id: event.id,
          parameters: {},
          timestamp: ts(),
        };
        break;

      case 'tool_use_delta': {
        const buf = toolInputBuffers.get(event.id);
        if (buf) {
          buf.json += event.inputDelta;
        }
        break;
      }

      case 'tool_use_end': {
        // Flush any accumulated text
        if (currentText) {
          content.push({type: 'text', text: currentText});
          currentText = '';
        }

        const toolName = toolInputBuffers.get(event.id)?.name ?? '';
        content.push({type: 'tool_use', id: event.id, name: toolName, input: event.input});
        toolInputBuffers.delete(event.id);

        // Emit ExploreStart before execution
        if (toolName === EXPLORE_TOOL_NAME) {
          yield {
            type: SSEEventType.ExploreStart,
            query: String(event.input['query'] ?? ''),
            timestamp: ts(),
          };
        }

        // Execute the tool
        const startMs = Date.now();
        const execResult = await executeTool(session, toolName, event.input, event.id, signal);
        const durationMs = Date.now() - startMs;

        // Emit subagent events from explore
        if (execResult.subagentEvents) {
          for (const evt of execResult.subagentEvents) {
            yield evt;
          }
        }

        // Emit ExploreEnd after execution
        if (toolName === EXPLORE_TOOL_NAME && execResult.exploreResult) {
          yield {
            type: SSEEventType.ExploreEnd,
            summary: execResult.exploreResult.summary,
            tokens_used: execResult.exploreResult.tokensUsed,
            timestamp: ts(),
          };
        }

        yield {
          type: SSEEventType.ToolCallResult,
          tool_id: event.id,
          status: execResult.result.error ? 'error' : 'success',
          result: execResult.result.output,
          error: execResult.result.error,
          duration_ms: durationMs,
          timestamp: ts(),
        };

        toolResults.push({
          role: 'tool_result',
          toolCallId: event.id,
          content: execResult.result.error ?? execResult.result.output ?? '',
          isError: !!execResult.result.error,
        });
        break;
      }

      case 'message_end':
        // Flush any remaining text
        if (currentText) {
          content.push({type: 'text', text: currentText});
          currentText = '';
        }
        if (event.usage) {
          turnUsage = event.usage;
        }
        break;

      default:
        break;
    }
  }

  // Flush any remaining text not flushed by message_end
  if (currentText) {
    content.push({type: 'text', text: currentText});
  }

  return {content, hasToolUse, toolResults, usage: turnUsage};
}

function processTextOutput(session: AgentSession, text: string): string {
  const result = session.runtime.outputPipeline.process(text);
  session.runtime.telemetry.logGuard({
    output: result.output,
    modified: result.modified,
    blocked: result.blocked,
    findings: result.findings,
  });
  return result.output;
}
