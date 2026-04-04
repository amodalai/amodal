/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Dispatch tool.
 *
 * Allows the model to delegate a sub-task to a child agent with a
 * subset of tools. The EXECUTING state handler intercepts this tool
 * by name and transitions to DISPATCHING — the execute() function
 * here is a safety net that should never be reached.
 *
 * Circular dependency avoidance: this file does NOT import from
 * the agent loop. The dispatch tool is just a schema definition.
 * The actual child agent execution lives in states/dispatching.ts.
 */

import {z} from 'zod';
import type {ToolDefinition} from './types.js';
import {ToolExecutionError} from '../errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DISPATCH_TOOL_NAME = 'dispatch_task';

const DEFAULT_CHILD_MAX_TURNS = 10;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const DispatchParamsSchema = z.object({
  /** Name for the child agent (used in SSE events and logging) */
  agent_name: z.string().describe('A short descriptive name for the sub-agent (e.g. "data-fetcher", "entity-profiler")'),
  /** Which tools the child agent can use (must be a subset of available tools) */
  tools: z.array(z.string()).describe('List of tool names the child agent can use'),
  /** The task prompt for the child agent */
  prompt: z.string().describe('The task description for the child agent to complete'),
  /** Max turns for the child agent (default: 10) */
  max_turns: z.number().int().positive().optional().describe('Maximum number of LLM turns the child agent can take'),
});

export type DispatchParams = z.infer<typeof DispatchParamsSchema>;

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * Create the dispatch_task tool definition.
 *
 * The tool is intercepted by the EXECUTING state handler before execute()
 * is called. The EXECUTING handler reads the args, strips dispatch_task
 * from the child's tool list (preventing recursion), and transitions to
 * DISPATCHING state.
 */
export function createDispatchTool(): ToolDefinition {
  return {
    description: `Delegate a sub-task to a child agent that runs independently with its own tool set. Use this when a task can be broken into parallel or sequential sub-tasks, each requiring specific tools. The child agent completes its task and returns a text summary.

The child agent has access only to the tools you specify — choose the minimum set needed. The child cannot dispatch further sub-agents.

Use dispatch_task when:
- A task involves multiple independent data-gathering steps
- You need to query different connections in parallel
- A sub-task is self-contained and doesn't need conversation context`,

    parameters: DispatchParamsSchema,

    readOnly: false,
    metadata: {category: 'system'},

    async execute(): Promise<unknown> {
      // The EXECUTING state handler intercepts dispatch_task by name and
      // transitions to DISPATCHING. If execute() is called directly, the
      // interception was bypassed — this is a bug.
      throw new ToolExecutionError(
        'dispatch_task must be intercepted by the EXECUTING state handler — direct execution is not supported',
        {toolName: DISPATCH_TOOL_NAME, callId: 'unknown', context: {}},
      );
    },
  };
}

export {DEFAULT_CHILD_MAX_TURNS};
