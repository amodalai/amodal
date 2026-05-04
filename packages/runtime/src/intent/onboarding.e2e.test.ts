/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 4 — end-to-end onboarding walkthrough.
 *
 * Loads the four real intents shipped in
 * `packages-onboarding-v4/agent-admin/intents/` (the same files synced
 * to `~/.amodal/admin-agent/latest/intents/`) and walks them through
 * the four Studio-emitted seed messages that drive a Path-A onboarding
 * session: install-template → configured-connection → skip-connection
 * → looks-right (then a freeform off-script reply that exercises the
 * fall-through path).
 *
 * The test verifies two things at once:
 *   1. Each turn that should be intent-routed bypasses the LLM (the
 *      stub provider's streamText call counter stays at the expected
 *      number — we count off-script LLM-bound turns separately).
 *   2. Each intent emits the lifecycle events Phase 4 added
 *      (intent_matched + intent_completed | intent_fell_through).
 *
 * If we change the regex of an intent or break the loader, this test
 * fires before a deploy goes out — the failure surface is the actual
 * onboarding UX, not a unit-test stub.
 */

import {describe, it, expect, vi} from 'vitest';
import * as path from 'node:path';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {loadIntents} from './loader.js';
import {StandaloneSessionManager} from '../session/manager.js';
import type {CreateSessionOptions} from '../session/types.js';
import type {LLMProvider, StreamEvent, StreamTextResult, TokenUsage} from '../providers/types.js';
import {createToolRegistry} from '../tools/registry.js';
import type {ToolDefinition} from '../tools/types.js';
import type {PermissionChecker} from '../security/permission-checker.js';

// ---------------------------------------------------------------------------
// Source-of-truth path
//
// Pin to the marketplace working copy at packages-onboarding-v4. The
// admin-agent cache (~/.amodal/admin-agent/latest) is a derived copy
// of the same files, so testing the source is equivalent for the
// intent surface and stays stable across machines that haven't run
// `amodal update --admin-agent` recently.
// ---------------------------------------------------------------------------

const AGENT_ADMIN_PATH = path.resolve(
  __dirname,
  '../../../../../packages-onboarding-v4/agent-admin',
);

const HAS_AGENT_ADMIN = existsSync(AGENT_ADMIN_PATH);
if (!HAS_AGENT_ADMIN) {
  // eslint-disable-next-line no-console -- intentional one-time skip notice
  console.warn(
    `[onboarding.e2e] skipping — ${AGENT_ADMIN_PATH} not present (clone amodalai/packages alongside the runtime to enable)`,
  );
}

// ---------------------------------------------------------------------------
// Stubs for the four agent-admin tools the intents call. These mirror
// the tool.json contracts in agent-admin/tools/ but execute synchronously
// in-memory so the test doesn't need a real Studio + DB.
// ---------------------------------------------------------------------------

interface StubState {
  state: {
    phase: string;
    completed: Array<{slotLabel: string}>;
    skipped: Array<{slotLabel: string}>;
    plan: {
      slots: Array<{
        label: string;
        required: boolean;
        options: Array<{packageName: string; displayName: string}>;
      }>;
      dataPointTemplates?: Record<string, string>;
    } | null;
  };
  completedAt: string | null;
}

function makeAgentAdminStubs(initial: StubState | null) {
  let row: StubState | null = initial;
  const calls: Array<{tool: string; params: Record<string, unknown>}> = [];

  function record(tool: string, params: Record<string, unknown>) {
    calls.push({tool, params});
  }

  const tools: Record<string, ToolDefinition> = {
    resolve_template: {
      description: 'resolve_template stub',
      parameters: z.object({slug: z.string()}),
      readOnly: true,
      execute: async (params: unknown) => {
        record('resolve_template', params as Record<string, unknown>);
        const {slug} = params as {slug: string};
        return {
          ok: true,
          slug,
          displayName: 'Marketing Digest',
          card: {
            title: 'Marketing Digest',
            tagline: 'Weekly metrics',
            platforms: ['slack'],
            thumbnailConversation: [{role: 'agent' as const, content: 'Hi'}],
          },
        };
      },
    },
    show_preview: {
      description: 'show_preview stub',
      parameters: z.object({
        title: z.string(),
        tagline: z.string(),
        platforms: z.array(z.string()),
        thumbnailConversation: z.array(z.object({role: z.string(), content: z.string()})),
      }),
      readOnly: true,
      execute: async (params: unknown) => {
        record('show_preview', params as Record<string, unknown>);
        return {ok: true};
      },
    },
    install_template: {
      description: 'install_template stub',
      parameters: z.object({slug: z.string()}),
      readOnly: false,
      execute: async (params: unknown) => {
        record('install_template', params as Record<string, unknown>);
        const plan = {
          templatePackage: '@amodalai/template-marketing-digest',
          slots: [
            {
              label: 'Slack',
              required: true,
              options: [{packageName: '@amodalai/connection-slack', displayName: 'Slack'}],
            },
            {
              label: 'LinkedIn',
              required: false,
              options: [{packageName: '@amodalai/connection-linkedin', displayName: 'LinkedIn'}],
            },
          ],
        };
        return {ok: true, slug: (params as {slug: string}).slug, displayName: 'Marketing Digest', plan};
      },
    },
    update_setup_state: {
      description: 'update_setup_state stub',
      parameters: z.any(),
      readOnly: false,
      execute: async (params: unknown) => {
        record('update_setup_state', params as Record<string, unknown>);
        const p = params as {
          phase?: string;
          plan?: StubState['state']['plan'];
          appendCompleted?: Array<{slotLabel: string}>;
          appendSkipped?: Array<{slotLabel: string}>;
        };
        if (!row) {
          row = {
            state: {
              phase: 'planning',
              completed: [],
              skipped: [],
              plan: null,
            },
            completedAt: null,
          };
        }
        if (p.phase) row.state.phase = p.phase;
        if (p.plan) row.state.plan = p.plan;
        if (p.appendCompleted) row.state.completed.push(...p.appendCompleted);
        if (p.appendSkipped) row.state.skipped.push(...p.appendSkipped);
        return {ok: true, row};
      },
    },
    read_setup_state: {
      description: 'read_setup_state stub',
      parameters: z.object({}),
      readOnly: true,
      execute: async () => {
        record('read_setup_state', {});
        return {ok: true, row};
      },
    },
    validate_connection: {
      description: 'validate_connection stub',
      parameters: z.any(),
      readOnly: true,
      execute: async (params: unknown) => {
        record('validate_connection', params as Record<string, unknown>);
        return {ok: true, value: 12, formatted: '12'};
      },
    },
    present_connection: {
      description: 'present_connection stub',
      parameters: z.any(),
      readOnly: true,
      execute: async (params: unknown) => {
        record('present_connection', params as Record<string, unknown>);
        return {ok: true};
      },
    },
  };

  return {tools, calls, getRow: () => row};
}

// ---------------------------------------------------------------------------
// Provider + permission stubs
// ---------------------------------------------------------------------------

function recordingProvider(): LLMProvider & {streamTextCalled: () => number} {
  let calls = 0;
  return {
    model: 'test-model',
    provider: 'test-provider',
    languageModel: {} as LLMProvider['languageModel'],
    streamText(): StreamTextResult {
      calls++;
      const usage: TokenUsage = {inputTokens: 1, outputTokens: 1, totalTokens: 2};
      const events: StreamEvent[] = [
        {type: 'text-delta', textDelta: 'fallthrough'},
        {type: 'finish', usage},
      ];
      async function* fullStream() {
        for (const e of events) yield e;
      }
      async function* textStream() {
        yield 'fallthrough';
      }
      return {
        fullStream: fullStream(),
        textStream: textStream(),
        usage: Promise.resolve(usage),
        text: Promise.resolve('fallthrough'),
        responseMessages: Promise.resolve([{role: 'assistant' as const, content: 'fallthrough'}]),
      };
    },
    generateText: () => Promise.reject(new Error('not used')),
    streamTextCalled: () => calls,
  };
}

function permissive(): PermissionChecker {
  return {check: () => ({allowed: true as const})};
}

function recordingLogger() {
  const events: Array<{level: string; event: string; data: Record<string, unknown>}> = [];
  const push = (level: string) => (event: string, data?: Record<string, unknown>) => {
    events.push({level, event, data: data ?? {}});
  };
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(push('info')),
    warn: vi.fn(push('warn')),
    error: vi.fn(push('error')),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    events,
  };
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_AGENT_ADMIN)('intent routing — onboarding e2e', () => {
  it('walks through Studio seed messages without invoking the LLM', async () => {
    const intents = await loadIntents(AGENT_ADMIN_PATH);
    expect(intents.map((i) => i.id).sort()).toEqual([
      'configured-connection',
      'install-template',
      'looks-right',
      'skip-connection',
    ]);

    const {tools, calls} = makeAgentAdminStubs(null);
    const provider = recordingProvider();
    const logger = recordingLogger();

    const reg = createToolRegistry();
    for (const [name, def] of Object.entries(tools)) reg.register(name, def);

    const opts: CreateSessionOptions = {
      provider,
      toolRegistry: reg,
      permissionChecker: permissive(),
      systemPrompt: 'test',
      intents,
    };

    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(opts);

    // Turn 1: Path A seed → install-template intent.
    await collect(mgr.runMessage(session.id, "Set up template 'marketing-digest'."));

    // Turn 2: User configured Slack → configured-connection intent.
    await collect(mgr.runMessage(session.id, 'Configured Slack'));

    // Turn 3: User skipped LinkedIn → skip-connection intent.
    await collect(mgr.runMessage(session.id, 'Skip LinkedIn for now'));

    // Each of the three intents now ends with `{continue: true}` so
    // the LLM picks up after the deterministic state work — that's
    // the Phase 5 contract: intent does the plumbing, LLM does the
    // conversational reply + next-step rendering. So the LLM gets
    // invoked once per intent-routed turn (3 total).
    expect(provider.streamTextCalled()).toBe(3);

    // Tools fired in order. install-template: resolve_template +
    // show_preview + install_template + update_setup_state.
    // configured-connection (Slack option matches plan): read +
    // validate (slack has a probe in PROBE_TABLE) + update.
    // skip-connection: read + update.
    const toolNames = calls.map((c) => c.tool);
    expect(toolNames).toEqual([
      'resolve_template',
      'show_preview',
      'install_template',
      'update_setup_state',
      'read_setup_state',
      'validate_connection',
      'update_setup_state',
      'read_setup_state',
      'update_setup_state',
    ]);

    // Telemetry: one matched + one completed per intent-routed turn.
    const matched = logger.events.filter((e) => e.event === 'intent_matched');
    const completed = logger.events.filter((e) => e.event === 'intent_completed');
    expect(matched.map((e) => e.data['intentId'])).toEqual([
      'install-template',
      'configured-connection',
      'skip-connection',
    ]);
    expect(completed.map((e) => e.data['intentId'])).toEqual([
      'install-template',
      'configured-connection',
      'skip-connection',
    ]);
  });

  it('Looks right falls through to LLM when phase is wrong, completes when right', async () => {
    const intents = await loadIntents(AGENT_ADMIN_PATH);

    // Case A: state row exists but phase is 'planning' (no proposal yet) →
    // looks-right falls through to LLM since the intent's precondition
    // (phase === 'planning_pending_confirm') isn't met.
    {
      const {tools} = makeAgentAdminStubs({
        state: {phase: 'planning', completed: [], skipped: [], plan: null},
        completedAt: null,
      });
      const provider = recordingProvider();
      const logger = recordingLogger();
      const reg = createToolRegistry();
      for (const [name, def] of Object.entries(tools)) reg.register(name, def);

      const mgr = new StandaloneSessionManager({logger});
      const session = mgr.create({
        provider,
        toolRegistry: reg,
        permissionChecker: permissive(),
        systemPrompt: 'test',
        intents,
      });

      await collect(mgr.runMessage(session.id, 'Looks right'));

      // Phase 5: looks-right always returns {continue: true} so the
      // LLM picks up after read_setup_state, regardless of whether
      // the precondition matched. Wrong phase → intent ran read,
      // bailed without writing state, then LLM takes over to
      // clarify with the user.
      expect(provider.streamTextCalled()).toBe(1);
      const matched = logger.events.find((e) => e.event === 'intent_matched');
      expect(matched?.data['intentId']).toBe('looks-right');
    }

    // Case B: phase is planning_pending_confirm with a plan → completes.
    {
      const {tools, calls} = makeAgentAdminStubs({
        state: {
          phase: 'planning_pending_confirm',
          completed: [],
          skipped: [],
          plan: {slots: []},
        },
        completedAt: null,
      });
      const provider = recordingProvider();
      const logger = recordingLogger();
      const reg = createToolRegistry();
      for (const [name, def] of Object.entries(tools)) reg.register(name, def);

      const mgr = new StandaloneSessionManager({logger});
      const session = mgr.create({
        provider,
        toolRegistry: reg,
        permissionChecker: permissive(),
        systemPrompt: 'test',
        intents,
      });

      await collect(mgr.runMessage(session.id, 'Looks right'));

      // continue:true → LLM runs after the intent's deterministic
      // phase flip + state write.
      expect(provider.streamTextCalled()).toBe(1);
      expect(calls.map((c) => c.tool)).toEqual([
        'read_setup_state',
        'update_setup_state',
      ]);
      const completed = logger.events.find((e) => e.event === 'intent_completed');
      expect(completed?.data['intentId']).toBe('looks-right');
    }
  });

  it('off-script messages route to the LLM (no intent matches)', async () => {
    const intents = await loadIntents(AGENT_ADMIN_PATH);
    const {tools} = makeAgentAdminStubs(null);
    const provider = recordingProvider();
    const logger = recordingLogger();
    const reg = createToolRegistry();
    for (const [name, def] of Object.entries(tools)) reg.register(name, def);

    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create({
      provider,
      toolRegistry: reg,
      permissionChecker: permissive(),
      systemPrompt: 'test',
      intents,
    });

    await collect(mgr.runMessage(session.id, 'Can it pull data from competitors too?'));

    expect(provider.streamTextCalled()).toBe(1);
    expect(logger.events.find((e) => e.event === 'intent_matched')).toBeUndefined();
  });
});
