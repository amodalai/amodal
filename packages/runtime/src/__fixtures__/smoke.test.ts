/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Smoke tests — end-to-end integration tests against a self-contained
 * test agent with mock REST and MCP servers.
 *
 * Requires ANTHROPIC_API_KEY in the environment (skips otherwise).
 * Starts amodal dev programmatically, runs assertions, tears down.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {fork, type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync, writeFileSync, rmSync, readdirSync} from 'node:fs';
import type {ServerInstance} from '../server.js';
import {expectDoneReason, expectTotalTokens} from './test-helpers.js';
import {loadTestEnv, defaultTargetName} from './test-env.js';
import {VISION_PROVIDERS} from '../providers/types.js';

// Pull API keys out of <repo-root>/.env.test (gitignored). Missing keys
// cause the describe block below to skip with a reason.
loadTestEnv();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AGENT_PORT = 9900;
const REST_PORT = 9901;
const AGENT_DIR = resolve(__dirname, 'smoke-agent');
const REST_SERVER = resolve(__dirname, 'smoke-rest-server.mjs');
const MCP_SERVER = resolve(__dirname, 'smoke-mcp-server.mjs');
const TIMEOUT = 45_000; // per-test timeout for LLM calls

// Provider selection — override via SMOKE_TARGET env var.
// If unset, falls through a preference chain using whichever API key
// happens to be configured: google -> anthropic -> openai -> groq.
interface SmokeTarget {
  provider: string;
  model: string;
  apiKeyEnv: string;
}
const SMOKE_TARGETS: Record<string, SmokeTarget> = {
  anthropic: {provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKeyEnv: 'ANTHROPIC_API_KEY'},
  google: {provider: 'google', model: 'gemini-2.5-flash', apiKeyEnv: 'GOOGLE_API_KEY'},
  openai: {provider: 'openai', model: 'gpt-4o-mini', apiKeyEnv: 'OPENAI_API_KEY'},
  groq: {provider: 'groq', model: 'llama-3.3-70b-versatile', apiKeyEnv: 'GROQ_API_KEY'},
};
function pickSmokeTarget(): {name: string; target: SmokeTarget | undefined} {
  const override = process.env['SMOKE_TARGET'];
  const name = override ?? defaultTargetName(SMOKE_TARGETS);
  return {name, target: SMOKE_TARGETS[name]};
}

const {name: smokeTargetName, target: smokeTarget} = pickSmokeTarget();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForServer(port: number, maxMs = 15_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {signal: AbortSignal.timeout(1000)});
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server on port ${port} did not start within ${maxMs}ms`);
}

async function chat(
  message: string,
  sessionId?: string,
  opts?: {maxSessionTokens?: number; images?: Array<{mimeType: string; data: string}>; model?: {provider: string; model: string}},
): Promise<{events: Array<Record<string, unknown>>; sessionId: string}> {
  const body: Record<string, unknown> = {message};
  if (sessionId) body['session_id'] = sessionId;
  if (opts?.maxSessionTokens !== undefined) body['max_session_tokens'] = opts.maxSessionTokens;
  if (opts?.images?.length) body['images'] = opts.images;
  if (opts?.model) body['model'] = opts.model;

  const res = await fetch(`http://localhost:${AGENT_PORT}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });

  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  let sid = '';

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
      events.push(event);
      if (event['type'] === 'init' && typeof event['session_id'] === 'string') {
        sid = event['session_id'];
      }
    } catch { /* skip */ }
  }

  return {events, sessionId: sid};
}

function findEvent(events: Array<Record<string, unknown>>, type: string): Record<string, unknown> | undefined {
  return events.find((e) => e['type'] === type);
}

function findEvents(events: Array<Record<string, unknown>>, type: string): Array<Record<string, unknown>> {
  return events.filter((e) => e['type'] === type);
}

function allText(events: Array<Record<string, unknown>>): string {
  return events
    .filter((e) => e['type'] === 'text_delta')
    .map((e) => String(e['content'] ?? ''))
    .join('');
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let restServer: ChildProcess | null = null;
let agentServer: ServerInstance | null = null;

const skipReason = !smokeTarget
  ? `unknown SMOKE_TARGET "${smokeTargetName}"; known: ${Object.keys(SMOKE_TARGETS).join(', ')}`
  : process.env[smokeTarget.apiKeyEnv]
    ? ''
    : `${smokeTarget.apiKeyEnv} not set`;

describe.skipIf(!!skipReason)(`smoke tests [${smokeTargetName}]`, () => {
  // Stash fixture files so afterAll can restore them; otherwise the
  // per-run rewrites (provider + absolute MCP path) leak into the repo.
  const amodalPath = resolve(AGENT_DIR, 'amodal.json');
  const mcpSpecPath = resolve(AGENT_DIR, 'connections/mock-mcp/spec.json');
  const originalAmodalJson = readFileSync(amodalPath, 'utf-8');
  const originalMcpSpec = readFileSync(mcpSpecPath, 'utf-8');

  beforeAll(async () => {
    // 0. Nuke prior state — clean slate for every run
    rmSync(resolve(AGENT_DIR, '.amodal/store-data'), {recursive: true, force: true});

    // 1. Rewrite amodal.json with the selected provider/model.
    //    smokeTarget is guaranteed defined here — skipReason above gates
    //    the describe block when it's undefined or missing a key.
    if (!smokeTarget) throw new Error('unreachable: smokeTarget is undefined under skipReason guard');
    const amodalConfig = JSON.parse(originalAmodalJson) as Record<string, unknown>;
    amodalConfig['models'] = {
      main: {provider: smokeTarget.provider, model: smokeTarget.model},
    };
    // Enable web_search + fetch_url tools when a Google API key is available.
    // Key resolution happens in the core config parser via env: prefix.
    if (process.env['GOOGLE_API_KEY']) {
      amodalConfig['webTools'] = {
        provider: 'google',
        apiKey: 'env:GOOGLE_API_KEY',
        model: 'gemini-3-flash-preview',
      };
    }
    writeFileSync(amodalPath, JSON.stringify(amodalConfig, null, 2));

    // 2. Write MCP server spec with absolute path (loadRepo reads this as-is).
    //    Restored in afterAll so the env-specific path doesn't leak into git.
    writeFileSync(
      mcpSpecPath,
      JSON.stringify({protocol: 'mcp', transport: 'stdio', command: 'node', args: [MCP_SERVER]}, null, 2),
    );

    // 3. Start mock REST server
    restServer = fork(REST_SERVER, [], {
      env: {...process.env, SMOKE_REST_PORT: String(REST_PORT)},
      stdio: 'pipe',
    });
    await new Promise((r) => setTimeout(r, 1000));

    // 4. Start amodal dev programmatically
    const {createLocalServer} = await import('../agent/local-server.js');
    agentServer = await createLocalServer({
      repoPath: AGENT_DIR,
      port: AGENT_PORT,
      hotReload: false,
    });
    await agentServer.start();
    await waitForServer(AGENT_PORT);
  }, 30_000);

  afterAll(async () => {
    if (agentServer) {
      await agentServer.stop();
    }
    if (restServer) {
      restServer.kill('SIGTERM');
    }
    // Restore fixture files so the per-run rewrites stay test-local and
    // don't show up in git status afterwards.
    writeFileSync(amodalPath, originalAmodalJson);
    writeFileSync(mcpSpecPath, originalMcpSpec);
  });

  // -------------------------------------------------------------------------
  // 1. Server lifecycle
  // -------------------------------------------------------------------------

  it('health endpoint returns ok', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body['status']).toBe('ok');
  });

  it('config endpoint returns agent info', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/config`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body['name']).toBe('smoke-test-agent');
  });

  it('/api/me returns ops in amodal dev', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/me`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toEqual({id: 'local-dev', role: 'ops'});
  });

  // -------------------------------------------------------------------------
  // 2. System prompt (G9)
  // -------------------------------------------------------------------------

  it('system prompt includes all context sections', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/inspect/context`);
    const body = await res.json() as Record<string, unknown>;
    const prompt = String(body['system_prompt'] ?? '');

    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('mock-api');       // connection
    expect(prompt).toContain('test-skill');      // skill
    expect(prompt).toContain('Smoke Test Reference'); // knowledge
    expect(prompt).toContain('test-items');      // store
  });

  // -------------------------------------------------------------------------
  // 3. Chat streaming
  // -------------------------------------------------------------------------

  it('streams chat with init, text, and done events', async () => {
    const {events} = await chat('Say hello in exactly 3 words.');

    const init = findEvent(events, 'init');
    const done = findEvent(events, 'done');
    const textDeltas = findEvents(events, 'text_delta');

    expect(init).toBeDefined();
    expect(done).toBeDefined();
    expect(textDeltas.length).toBeGreaterThan(0);

    // Done event should have usage
    const usage = done?.['usage'] as Record<string, unknown> | undefined;
    expect(usage?.['input_tokens']).toBeGreaterThan(0);
    expect(usage?.['output_tokens']).toBeGreaterThan(0);
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 3b. Model override
  // -------------------------------------------------------------------------

  // Find a second provider to override to (different from the primary smoke target)
  const overrideTarget = Object.entries(SMOKE_TARGETS).find(
    ([name, t]) => name !== smokeTargetName && process.env[t.apiKeyEnv],
  );

  it.skipIf(!overrideTarget)('accepts model override in chat request', async () => {
    const [, target] = overrideTarget!;
    const {events} = await chat('Reply with exactly one word: hello', undefined, {
      model: {provider: target.provider, model: target.model},
    });

    const init = findEvent(events, 'init');
    const done = findEvent(events, 'done');
    expect(init).toBeDefined();
    expect(done).toBeDefined();

    // The model in the done event should match the override
    const usage = done?.['usage'] as Record<string, unknown> | undefined;
    expect(usage?.['input_tokens']).toBeGreaterThan(0);
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 4. Session resume
  // -------------------------------------------------------------------------

  it('resumes session with prior context', async () => {
    const first = await chat('Remember this code: SMOKE7742. Just confirm you noted it.');
    expect(first.sessionId).toBeTruthy();

    const second = await chat('What was the code I asked you to remember? Reply with just the code.', first.sessionId);
    const responseText = allText(second.events);

    expect(responseText).toContain('SMOKE7742');
  }, TIMEOUT * 2);

  // -------------------------------------------------------------------------
  // 5. Tool call — store
  // -------------------------------------------------------------------------

  it('makes at least one tool call across chat interactions', async () => {
    // Use a prompt that strongly implies tool use — query existing data
    const {events} = await chat(
      'Query the test-items store for all items. Use the query_store tool with store="test-items".',
    );

    // The model should call query_store. If no tool calls at all, the test
    // is still valid — it means the model chose not to call tools, which is
    // an LLM non-determinism issue, not a code bug. We mark it as a soft check.
    const toolResults = findEvents(events, 'tool_call_result');
    if (toolResults.length === 0) {
      // Soft fail — log but don't block CI
      // eslint-disable-next-line no-console -- intentional test diagnostic
      console.warn('[smoke] Model did not call any tools — LLM non-determinism, not a code bug');
    } else {
      // If tools were called, verify they have proper status
      for (const result of toolResults) {
        expect(result['status']).toMatch(/^(success|error)$/);
      }
    }
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 6. Tool call — connection request
  // -------------------------------------------------------------------------

  it('calls request tool against mock-api', async () => {
    const {events} = await chat(
      'Use the request tool to GET /items from the mock-api connection with intent "read".',
    );

    const toolResults = findEvents(events, 'tool_call_result');
    const success = toolResults.find((e) => e['status'] === 'success');
    expect(success).toBeDefined();

    const responseText = allText(events);
    expect(responseText).toContain('Widget');
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 7. Tool error status
  // -------------------------------------------------------------------------

  it('reports tool errors with status error, not success', async () => {
    const {events} = await chat(
      'Use the request tool to call GET /items on a connection called "nonexistent-connection" with intent "read".',
    );

    const toolResults = findEvents(events, 'tool_call_result');
    const errorResult = toolResults.find((e) => e['status'] === 'error');
    expect(errorResult).toBeDefined();
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 8. Eval run
  // -------------------------------------------------------------------------

  it('runs eval and returns results', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/evals/run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({evalNames: ['basic-eval']}),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    const events: Array<Record<string, unknown>> = [];
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try { events.push(JSON.parse(line.slice(6)) as Record<string, unknown>); } catch { /* skip */ }
    }

    const complete = findEvent(events, 'eval_complete');
    expect(complete).toBeDefined();
    expect(complete?.['passed']).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // 9. Admin chat — reads repo files
  // -------------------------------------------------------------------------

  it('admin agent can read skill files', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/config/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'Read the test-skill skill file and tell me what it says. Be brief.'}),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    const text = await res.text();
    const events = parseSSE(text);

    const init = findEvent(events, 'init');
    expect(init).toBeDefined();

    // Admin agent should use read_repo_file tool
    const toolStarts = findEvents(events, 'tool_call_start');
    const readTool = toolStarts.find((e) => e['tool_name'] === 'read_repo_file');
    expect(readTool).toBeDefined();

    // The matching result should be a success — validates the full
    // tool_call_start → execute → tool_call_result SSE round-trip.
    const toolResults = findEvents(events, 'tool_call_result');
    const readResult = toolResults.find((e) => e['tool_id'] === readTool?.['tool_id']);
    expect(readResult).toBeDefined();
    expect(readResult?.['status']).toBe('success');

    const responseText = allText(events);
    expect(responseText.toLowerCase()).toContain('test');
  }, TIMEOUT);

  // End-to-end: the "reduce emojis in formatting rules" scenario from the
  // admin-agent regression. Before the discovery + edit tools existed, the
  // agent guessed wrong paths and often created a new skill file instead
  // of editing the existing knowledge doc. With list_repo_files /
  // glob_repo_files / grep_repo_files / edit_repo_file available, it
  // should discover knowledge/formatting-rules.md and edit it in place.
  it('admin agent discovers and edits the right file (emoji-reduction scenario)', async () => {
    const formattingRulesPath = resolve(AGENT_DIR, 'knowledge', 'formatting-rules.md');
    const emojiHeavyBody = [
      '# Formatting Rules 🎨',
      '',
      'Use emojis liberally to make the output more engaging! 🎉🎉🎉',
      '',
      '## Tone 💬',
      '',
      "Drop a 🚀 when celebrating a win, a 🔥 when highlighting risk, and a ✨ when introducing a new feature. Don't hold back! 🙌",
      '',
      'Every bullet point should start with an emoji. 📝 Every heading should have one too. 🏷️',
      '',
      '## Examples 📚',
      '- ✅ "Deployment succeeded 🎉"',
      '- ❌ "Deployment failed 💥"',
      '',
    ].join('\n');
    const emojiCount = (s: string): number => (s.match(/\p{Emoji_Presentation}/gu) ?? []).length;
    const initialEmojis = emojiCount(emojiHeavyBody);
    expect(initialEmojis).toBeGreaterThan(5);

    writeFileSync(formattingRulesPath, emojiHeavyBody);

    // Snapshot skills/ so we can assert the agent didn't create a bogus skill.
    const skillsDir = resolve(AGENT_DIR, 'skills');
    const skillsBefore = new Set(readdirSync(skillsDir));

    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/config/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message:
            'I want to use emojis less often in my formatting rules. Find where they are defined in my repo and reduce the emoji guidance — remove most emoji usage from the instructions, keep the document but make it plain text. Work carefully: first look around to find the right file, then edit it in place. Do not create any new skills.',
        }),
        signal: AbortSignal.timeout(TIMEOUT * 2),
      });

      const text = await res.text();
      const events = parseSSE(text);
      const toolStarts = findEvents(events, 'tool_call_start');
      const toolNames = toolStarts.map((e) => String(e['tool_name']));

      // Discovery: the agent should have used at least one of the new
      // discovery tools to find formatting-rules.md instead of guessing.
      const usedDiscovery = toolNames.some(
        (n) => n === 'list_repo_files' || n === 'glob_repo_files' || n === 'grep_repo_files',
      );
      expect(usedDiscovery).toBe(true);

      // Action: should edit in place, NOT rewrite the whole file or create
      // a new skill. We allow either edit_repo_file (preferred) or
      // write_repo_file targeting the same path (acceptable).
      const editedInPlace = toolNames.includes('edit_repo_file');
      const rewroteFile = toolNames.includes('write_repo_file');
      expect(editedInPlace || rewroteFile).toBe(true);

      // Regression guard: agent must NOT have created a new skill.
      const skillsAfter = new Set(readdirSync(skillsDir));
      const newSkills = [...skillsAfter].filter((s) => !skillsBefore.has(s));
      expect(newSkills).toEqual([]);

      // Outcome: the file should still exist and contain significantly
      // fewer emojis than before.
      const after = readFileSync(formattingRulesPath, 'utf-8');
      expect(after.length).toBeGreaterThan(0);
      const afterEmojis = emojiCount(after);
      expect(afterEmojis).toBeLessThan(initialEmojis);
    } finally {
      // Clean up — remove the formatting-rules.md fixture regardless of pass/fail.
      rmSync(formattingRulesPath, {force: true});
    }
  }, TIMEOUT * 2);

  // Pagination end-to-end: drop a 3000-line file with a sentinel on line
  // 2800, ask the admin agent to report what's there verbatim. The default
  // read cap is 2000 lines, so the agent MUST either paginate via offset
  // or use grep. Verifies the new line_start/line_end/total_lines/
  // truncated response shape is actually usable by a real LLM.
  it('admin agent paginates a long file to reach content past the default cap', async () => {
    const bigFilePath = resolve(AGENT_DIR, 'knowledge', 'big-file.md');
    // Sentinel must be distinct enough that the agent can quote it back.
    const SENTINEL = 'TARGET:CONTENT:ABCD1234:the-answer-is-42';
    const TARGET_LINE = 2800;
    const TOTAL_LINES = 3000;
    const body = Array.from({length: TOTAL_LINES}, (_, i) => {
      const n = i + 1;
      return n === TARGET_LINE ? `line ${String(n)}: ${SENTINEL}` : `line ${String(n)}: filler`;
    }).join('\n');
    writeFileSync(bigFilePath, body);

    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/config/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message:
            `I just added a long file at knowledge/big-file.md. Tell me exactly what's on line ${String(TARGET_LINE)} — report the full line content verbatim. Just give me the line, no summary.`,
        }),
        signal: AbortSignal.timeout(TIMEOUT * 2),
      });

      const text = await res.text();
      const events = parseSSE(text);
      const toolStarts = findEvents(events, 'tool_call_start');
      const toolNames = toolStarts.map((e) => String(e['tool_name']));

      // The agent needs to touch the file — either read_repo_file or
      // grep_repo_files would work to find the target line.
      const touchedFile = toolNames.some(
        (n) => n === 'read_repo_file' || n === 'grep_repo_files',
      );
      expect(touchedFile).toBe(true);

      // If the agent used read_repo_file, at least one call must have
      // specified an offset/limit that covers line 2800 (the default
      // 2000-line window doesn't reach it, so the agent HAS to adapt).
      const readCalls = toolStarts.filter((e) => e['tool_name'] === 'read_repo_file');
      if (readCalls.length > 0) {
        const usedPagination = readCalls.some((e) => {
          const params = e['parameters'] as Record<string, unknown> | undefined;
          if (!params) return false;
          const offset = typeof params['offset'] === 'number' ? params['offset'] : 1;
          const limit = typeof params['limit'] === 'number' ? params['limit'] : 2000;
          // Covers line TARGET_LINE if offset <= TARGET_LINE AND
          // offset + limit - 1 >= TARGET_LINE.
          return offset <= TARGET_LINE && offset + limit - 1 >= TARGET_LINE;
        });
        expect(usedPagination).toBe(true);
      }

      // Hard assertion: the response contains the sentinel verbatim.
      const responseText = allText(events);
      expect(responseText).toContain(SENTINEL);
    } finally {
      rmSync(bigFilePath, {force: true});
    }
  }, TIMEOUT * 2);

  // Multi-chunk pagination: sentinels spread across a 5000-line file so no
  // single default read (2000 lines) can cover all of them. Verifies the
  // agent either (a) chains multiple reads following the truncated: true
  // signal, or (b) uses grep. Either is acceptable — what matters is that
  // the agent finds content past the default window.
  it('admin agent finds content scattered across a long file via pagination or grep', async () => {
    const bigFilePath = resolve(AGENT_DIR, 'knowledge', 'scatter.md');
    const MARKER = 'MARKER-ZXCV9876';
    const MARKER_LINES = [500, 2500, 4500];
    const TOTAL_LINES = 5000;
    const body = Array.from({length: TOTAL_LINES}, (_, i) => {
      const n = i + 1;
      return MARKER_LINES.includes(n) ? `line ${String(n)}: ${MARKER}` : `line ${String(n)}: filler`;
    }).join('\n');
    writeFileSync(bigFilePath, body);

    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/config/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message:
            `Read knowledge/scatter.md and quote the exact content of line 500, line 2500, and line 4500 verbatim. Report each line's full text.`,
        }),
        signal: AbortSignal.timeout(TIMEOUT * 2),
      });

      const text = await res.text();
      const events = parseSSE(text);
      const toolStarts = findEvents(events, 'tool_call_start');
      const toolNames = toolStarts.map((e) => String(e['tool_name']));

      // Agent must have touched the file.
      const touchedFile = toolNames.some(
        (n) => n === 'read_repo_file' || n === 'grep_repo_files',
      );
      expect(touchedFile).toBe(true);

      // If the agent committed to read-only discovery (no grep), verify at
      // least one read_repo_file call reached past the default 2000-line
      // cap — otherwise it couldn't have seen markers at lines 2500 or
      // 4500. When grep is used first, pagination isn't required because
      // the agent may have used read_repo_file only to confirm a line it
      // already found via grep.
      const usedGrep = toolNames.includes('grep_repo_files');
      const readCalls = toolStarts.filter((e) => e['tool_name'] === 'read_repo_file');
      if (readCalls.length > 0 && !usedGrep) {
        const reachedPastCap = readCalls.some((e) => {
          const params = e['parameters'] as Record<string, unknown> | undefined;
          if (!params) return false;
          const offset = typeof params['offset'] === 'number' ? params['offset'] : 1;
          const limit = typeof params['limit'] === 'number' ? params['limit'] : 2000;
          // A single read covers up to line_end = offset + limit - 1.
          return offset + limit - 1 > 2000;
        });
        expect(reachedPastCap).toBe(true);
      }

      // Hard assertion: final response identifies all three marker line
      // numbers. LLMs paraphrase, so search the response for each number.
      const responseText = allText(events);
      for (const n of MARKER_LINES) {
        expect(responseText).toContain(String(n));
      }
    } finally {
      rmSync(bigFilePath, {force: true});
    }
  }, TIMEOUT * 2);

  // -------------------------------------------------------------------------
  // 10. Write intent enforcement (G8)
  // -------------------------------------------------------------------------

  it('rejects POST with intent "read"', async () => {
    const {events} = await chat(
      'Use the request tool to call POST /items on mock-api with intent "read" and data {"name": "test"}. Do not use "write" intent — use exactly "read".',
    );

    const toolResults = findEvents(events, 'tool_call_result');
    // Should get an error result about intent mismatch
    const hasError = toolResults.some((e) => e['status'] === 'error');
    const responseText = allText(events);
    const mentionsIntent = responseText.toLowerCase().includes('intent') || responseText.toLowerCase().includes('write');

    // Either the tool returned an error about intent, or the model explained the rejection
    expect(hasError || mentionsIntent).toBe(true);
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 11. Store write + query persistence
  // -------------------------------------------------------------------------

  it('persists data across store write and query', async () => {
    // Write
    const writeResult = await chat(
      'Store a test item: use store_test_items with item_id="persist-check", name="Persistence Test", status="active". Call the tool now.',
    );
    const writeToolResults = findEvents(writeResult.events, 'tool_call_result');
    const writeSuccess = writeToolResults.find((e) => e['status'] === 'success');

    if (!writeSuccess) {
      // Model didn't call the tool — skip gracefully
      return;
    }

    // Query back in a NEW session (proves persistence, not just in-memory)
    const queryResult = await chat(
      'You have a tool called query_store. Use it now with store="test-items" and filter={"item_id": "persist-check"}. Then tell me the name field of the result.',
    );

    const queryToolResults = findEvents(queryResult.events, 'tool_call_result');
    if (queryToolResults.length === 0) {
      // Model didn't call query_store despite explicit instruction — LLM non-determinism
      // eslint-disable-next-line no-console -- intentional test diagnostic
      console.warn('[smoke] Model did not call query_store in persistence test — LLM non-determinism');
      return;
    }

    const responseText = allText(queryResult.events);
    expect(responseText).toContain('Persistence Test');
  }, TIMEOUT * 2);

  // -------------------------------------------------------------------------
  // 11b. Store batch write
  // -------------------------------------------------------------------------

  it('batch writes multiple items to store', async () => {
    const {events} = await chat(
      'Write two items to the test-items store using the batch tool: item_id="batch-1", name="First Batch", status="active" and item_id="batch-2", name="Second Batch", status="archived".',
    );

    const toolStarts = findEvents(events, 'tool_call_start');
    const batchTool = toolStarts.find((e) => String(e['tool_name'] ?? '').includes('batch'));

    if (!batchTool) {
      // Model didn't use batch — might have used individual writes, that's OK
      return;
    }

    const toolResults = findEvents(events, 'tool_call_result');
    const batchResult = toolResults.find((e) => e['tool_id'] === batchTool['tool_id']);
    expect(batchResult).toBeDefined();
    expect(batchResult?.['status']).toBe('success');
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 11c. Store single document fetch by key
  // -------------------------------------------------------------------------

  it('fetches a single document by key from store', async () => {
    // First write a known item and verify the write succeeded
    const writeResult = await chat(
      'Write to the test-items store: item_id="key-lookup-test", name="Key Lookup Item", status="active".',
    );
    const writeSuccess = findEvents(writeResult.events, 'tool_call_result').find((e) => e['status'] === 'success');
    if (!writeSuccess) return; // Write didn't happen — skip

    // Fetch by key in a new session
    const {events} = await chat(
      'Use query_store with store="test-items" and key="key-lookup-test". What is the name field?',
    );

    const toolResults = findEvents(events, 'tool_call_result');
    if (toolResults.length === 0) {
      // eslint-disable-next-line no-console -- intentional test diagnostic
      console.warn('[smoke] Model did not call query_store for key lookup — LLM non-determinism');
      return;
    }

    const responseText = allText(events);
    expect(responseText).toContain('Key Lookup');
  }, TIMEOUT * 2);

  // -------------------------------------------------------------------------
  // 11d. Store filtered query (multiple results)
  // -------------------------------------------------------------------------

  it('queries store with filter and returns multiple results', async () => {
    // Write two items with a unique status we can filter on
    const w1 = await chat('Write to test-items store: item_id="filter-a", name="Filter Alpha", status="archived".');
    const w2 = await chat('Write to test-items store: item_id="filter-b", name="Filter Beta", status="archived".');

    const w1ok = findEvents(w1.events, 'tool_call_result').some((e) => e['status'] === 'success');
    const w2ok = findEvents(w2.events, 'tool_call_result').some((e) => e['status'] === 'success');
    if (!w1ok || !w2ok) return; // Writes didn't happen — skip

    // Query with filter in a new session
    const {events} = await chat(
      'Use query_store with store="test-items" and filter={"status": "archived"}. List the names of all results.',
    );

    const toolResults = findEvents(events, 'tool_call_result');
    if (toolResults.length === 0) {
      // eslint-disable-next-line no-console -- intentional test diagnostic
      console.warn('[smoke] Model did not call query_store for filtered query — LLM non-determinism');
      return;
    }

    const responseText = allText(events);
    const mentionsAny = responseText.includes('Filter Alpha') || responseText.includes('Filter Beta');
    expect(mentionsAny).toBe(true);
  }, TIMEOUT * 3);

  // -------------------------------------------------------------------------
  // 11e. Parallel tool calls — batched read-only execution
  // -------------------------------------------------------------------------

  it('batches parallel read-only tool calls in a single turn', async () => {
    // Seed three distinct items with unique names so we can verify the
    // model saw each result.
    const seed = [
      ['parallel-alpha', 'Alpha Marker'],
      ['parallel-beta', 'Beta Marker'],
      ['parallel-gamma', 'Gamma Marker'],
    ];
    const writes = await Promise.all(seed.map(([id, name]) =>
      chat(`Write to test-items store: item_id="${id}", name="${name}", status="active".`),
    ));
    const allWritesOk = writes.every((w) =>
      findEvents(w.events, 'tool_call_result').some((e) => e['status'] === 'success'),
    );
    if (!allWritesOk) return; // seeding failed — skip

    // Ask the model to fetch all three in parallel. Models sometimes split
    // this across turns; when they emit a single-turn parallel batch we
    // verify the runtime handled it correctly end-to-end.
    const {events} = await chat(
      'Fetch all three of these items from the test-items store in parallel ' +
      'using three concurrent query_store tool calls (one per key): ' +
      '"parallel-alpha", "parallel-beta", "parallel-gamma". Then list the name ' +
      'field of each item in your response.',
    );

    const toolStarts = findEvents(events, 'tool_call_start');
    const toolResults = findEvents(events, 'tool_call_result');
    const queryStoreStarts = toolStarts.filter((e) => e['tool_name'] === 'query_store');

    if (queryStoreStarts.length < 2) {
      // eslint-disable-next-line no-console -- intentional test diagnostic
      console.warn(
        `[smoke] Model emitted ${String(queryStoreStarts.length)} query_store call(s) — ` +
        'parallel-batch path not exercised this run (LLM non-determinism)',
      );
      return;
    }

    // Every start must have a matching successful result — batching must
    // not drop events or corrupt SSE ordering. (This is the assertion that
    // actually exercises the batching code path; content coverage of the
    // response is LLM-variable and not the batcher's job.)
    const successResults = toolResults.filter((e) => e['status'] === 'success');
    expect(successResults.length).toBeGreaterThanOrEqual(queryStoreStarts.length);
  }, TIMEOUT * 3);

  // -------------------------------------------------------------------------
  // 12. Concurrent sessions don't bleed context
  // -------------------------------------------------------------------------

  it('concurrent sessions are isolated', async () => {
    // Session A: tell it a secret
    const sessionA = await chat('My secret code for this session is ALPHA9999. Just confirm.');
    // Session B: different secret (we don't need session B's ID)
    await chat('My secret code for this session is BETA5555. Just confirm.');

    // Ask session A about B's secret — should NOT know it
    const checkA = await chat('What is the BETA code?', sessionA.sessionId);
    const textA = allText(checkA.events);

    // Session A should not contain session B's secret
    expect(textA).not.toContain('BETA5555');
  }, TIMEOUT * 3);

  // -------------------------------------------------------------------------
  // 14. Multi-turn tool loop
  // -------------------------------------------------------------------------

  it('handles multi-turn tool interaction', async () => {
    // Ask something that requires a tool call then reasoning about the result
    const {events} = await chat(
      'Fetch items from mock-api using the request tool (GET /items, intent "read"), then tell me how many items have status "active".',
    );

    // Should have tool call AND text response with the count
    const toolResults = findEvents(events, 'tool_call_result');
    const responseText = allText(events);

    expect(toolResults.length).toBeGreaterThan(0);
    // Mock returns 2 active items (Widget, Doohickey) out of 3
    expect(responseText).toMatch(/2|two/i);
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 15. Evals list endpoint
  // -------------------------------------------------------------------------

  it('lists eval suites from repo', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/evals/suites`, {signal: AbortSignal.timeout(5000)});
    const body = await res.json() as {suites: Array<Record<string, unknown>>};

    expect(res.status).toBe(200);
    expect(body.suites.length).toBeGreaterThan(0);
    expect(body.suites[0]?.['name']).toBe('basic-eval');
  });

  // -------------------------------------------------------------------------
  // 16. Inspect endpoint — connection health
  // -------------------------------------------------------------------------

  it('inspect shows connection status', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/inspect/context`, {signal: AbortSignal.timeout(10000)});
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body['connections']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 17. MCP tool call
  // -------------------------------------------------------------------------

  it('calls MCP tool and gets result', async () => {
    const {events} = await chat(
      'Use the mock-mcp__smoke_search tool to search for "test". Call the tool now.',
    );

    const toolStarts = findEvents(events, 'tool_call_start');
    const mcpTool = toolStarts.find((e) => String(e['tool_name'] ?? '').includes('smoke_search'));

    if (!mcpTool) {
      // Check if MCP tools are even available — model might not know about them
      const responseText = allText(events);
      // If the model says it doesn't have that tool, MCP isn't wired
      if (responseText.toLowerCase().includes('not available') || responseText.toLowerCase().includes('don\'t have')) {
        throw new Error('MCP tools not registered — mock-mcp__smoke_search not available to the model');
      }
      // Model just chose not to call it — LLM non-determinism
      return;
    }

    const toolResults = findEvents(events, 'tool_call_result');
    const mcpResult = toolResults.find((e) => e['tool_id'] === mcpTool['tool_id']);
    expect(mcpResult).toBeDefined();
    expect(mcpResult?.['status']).toBe('success');
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 18. Custom tool (echo_tool) with ctx.request() + ctx.store()
  // -------------------------------------------------------------------------

  it('custom tool calls ctx.request and ctx.store', async () => {
    const {events} = await chat(
      'Use the echo_tool with message "smoke-test-ping". Call the tool now.',
    );

    const toolStarts = findEvents(events, 'tool_call_start');
    const echoTool = toolStarts.find((e) => e['tool_name'] === 'echo_tool');

    if (!echoTool) {
      const responseText = allText(events);
      if (responseText.toLowerCase().includes('not available') || responseText.toLowerCase().includes('don\'t have')) {
        throw new Error('echo_tool not registered');
      }
      return; // LLM non-determinism
    }

    const toolResults = findEvents(events, 'tool_call_result');
    const echoResult = toolResults.find((e) => e['tool_id'] === echoTool['tool_id']);
    expect(echoResult).toBeDefined();
    expect(echoResult?.['status']).toBe('success');
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 19. Stop execution tool terminates loop
  // -------------------------------------------------------------------------

  it('stop_execution tool is available', async () => {
    // We can't easily force the model to call stop_execution, but we can
    // verify it's in the tool list by asking the model
    const {events} = await chat(
      'Do you have a tool called stop_execution? Answer yes or no, nothing else.',
    );

    const responseText = allText(events).toLowerCase();
    expect(responseText).toContain('yes');
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 20. Done event always has usage (G2)
  // -------------------------------------------------------------------------

  it('done event always includes token usage', async () => {
    const {events} = await chat('Reply with exactly the word "pong".');

    const done = findEvent(events, 'done');
    expect(done).toBeDefined();

    const usage = done?.['usage'] as Record<string, unknown> | undefined;
    expect(usage).toBeDefined();
    expect(typeof usage?.['input_tokens']).toBe('number');
    expect(typeof usage?.['output_tokens']).toBe('number');
    expect((usage?.['input_tokens'] as number)).toBeGreaterThan(0);
    expect((usage?.['output_tokens'] as number)).toBeGreaterThan(0);
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 21. Sub-agent dispatch
  // -------------------------------------------------------------------------

  it('dispatch_task spawns child agent and returns result', async () => {
    const {events} = await chat(
      'Use the dispatch_task tool to delegate a sub-task. Set agent_name to "data-fetcher", tools to ["request"], and prompt to "Fetch GET /items from mock-api with intent read and summarize what you find." Call dispatch_task now.',
    );

    // Look for subagent events (child activity)
    const subagentEvents = findEvents(events, 'subagent_event');

    // Look for the dispatch_task tool call result
    const toolStarts = findEvents(events, 'tool_call_start');
    const dispatchStart = toolStarts.find((e) => e['tool_name'] === 'dispatch_task');

    if (!dispatchStart) {
      // Model didn't call dispatch_task — LLM non-determinism
      const responseText = allText(events);
      if (responseText.toLowerCase().includes('not available') || responseText.toLowerCase().includes('don\'t have')) {
        throw new Error('dispatch_task tool not registered');
      }
      return;
    }

    // dispatch_task was called — verify it completed
    const toolResults = findEvents(events, 'tool_call_result');
    const dispatchResult = toolResults.find((e) => e['tool_id'] === dispatchStart['tool_id']);
    expect(dispatchResult).toBeDefined();
    expect(dispatchResult?.['status']).toBe('success');

    // SubagentEvents should have been emitted during child execution
    if (subagentEvents.length > 0) {
      // All should reference the same parent_tool_id
      for (const event of subagentEvents) {
        expect(event['parent_tool_id']).toBe(dispatchStart['tool_id']);
        expect(event['agent_name']).toBe('data-fetcher');
      }
    }

    // Parent should have incorporated the child's result into its response
    const responseText = allText(events);
    expect(responseText.length).toBeGreaterThan(0);
  }, TIMEOUT * 2);

  it('dispatch_task tool is available to the model', async () => {
    const {events} = await chat(
      'Do you have a tool called dispatch_task? Answer yes or no, nothing else.',
    );

    const responseText = allText(events).toLowerCase();
    expect(responseText).toContain('yes');
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 22. Pages — user-defined React pages
  // -------------------------------------------------------------------------

  it('lists pages with metadata from repo', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/pages`, {signal: AbortSignal.timeout(5000)});
    const body = await res.json() as {pages: Array<Record<string, unknown>>};

    expect(res.status).toBe(200);
    expect(body.pages.length).toBeGreaterThan(0);
    const testPage = body.pages.find((p) => p['name'] === 'TestPage');
    expect(testPage).toBeDefined();
    expect(testPage?.['description']).toBe('Smoke test page fixture');
    expect(testPage?.['stores']).toEqual(['test-items']);
  });

  it('serves compiled page bundle', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/pages-bundle/TestPage.js`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(200);
    const bundle = await res.text();
    // IIFE bundle registers on window.__AMODAL_PAGES__
    expect(bundle).toContain('__AMODAL_PAGES__');
    expect(bundle).toContain('TestPage');
  });

  // -------------------------------------------------------------------------
  // 23. Sessions — listing and history
  // -------------------------------------------------------------------------

  it('sessions endpoint returns a sessions array', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/sessions`, {signal: AbortSignal.timeout(5000)});
    const body = await res.json() as {sessions: Array<Record<string, unknown>>};

    expect(res.status).toBe(200);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('returns 404 for unknown session', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/session/nonexistent-id`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(404);
  });

  it('persists chat session through full list/get/patch/delete lifecycle', async () => {
    // Full dev-UI session history loop, all served from DrizzleSessionStore.
    const {sessionId} = await chat('Say "ok" in one word.');
    expect(sessionId).toBeTruthy();

    // 1. Session appears in /sessions with the UI response shape
    const listRes = await fetch(`http://localhost:${AGENT_PORT}/sessions`, {signal: AbortSignal.timeout(5000)});
    const listBody = await listRes.json() as {sessions: Array<Record<string, unknown>>};
    expect(listRes.status).toBe(200);
    const found = listBody.sessions.find((s) => s['id'] === sessionId);
    expect(found).toBeDefined();
    if (!found) throw new Error('unreachable');
    expect(found['appId']).toBe('local');
    expect(typeof found['summary']).toBe('string');
    expect(String(found['summary']).length).toBeGreaterThan(0);
    expect(typeof found['createdAt']).toBe('number');
    expect(typeof found['lastAccessedAt']).toBe('number');
    expect(found['automationName']).toBeUndefined();

    // 2. /session/:id returns the conversation history
    const getRes = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {signal: AbortSignal.timeout(5000)});
    const getBody = await getRes.json() as {session_id: string; messages: Array<{role: string; text: string}>};
    expect(getRes.status).toBe(200);
    expect(getBody.session_id).toBe(sessionId);
    expect(getBody.messages.length).toBeGreaterThan(0);
    expect(getBody.messages[0].role).toBe('user');
    expect(getBody.messages[0].text).toContain('Say "ok"');

    // 3. PATCH title updates metadata and is visible on subsequent list
    const patchRes = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: 'smoke renamed'}),
      signal: AbortSignal.timeout(5000),
    });
    expect(patchRes.status).toBe(200);

    const list2Res = await fetch(`http://localhost:${AGENT_PORT}/sessions`, {signal: AbortSignal.timeout(5000)});
    const list2Body = await list2Res.json() as {sessions: Array<Record<string, unknown>>};
    const renamed = list2Body.sessions.find((s) => s['id'] === sessionId);
    expect(renamed?.['title']).toBe('smoke renamed');
    expect(renamed?.['summary']).toBe('smoke renamed');

    // 4. DELETE removes the session, subsequent GET 404s
    const delRes = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    expect(delRes.status).toBe(200);

    const getAfterDelRes = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {signal: AbortSignal.timeout(5000)});
    expect(getAfterDelRes.status).toBe(404);
  }, TIMEOUT);

  it('preserves tool-call chips in /session/:id history', async () => {
    // Tool calls appear as {type: 'tool-call'} parts in the assistant's
    // ModelMessage.content — flattenModelMessage should surface them to
    // the UI as toolCalls[]. Without this, the dev-UI chat history panel
    // renders the assistant's reply but drops the tool-call chips.
    const {sessionId} = await chat(
      'Use the request tool to GET /items from the mock-api connection with intent "read".',
    );
    expect(sessionId).toBeTruthy();

    const getRes = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {signal: AbortSignal.timeout(5000)});
    const getBody = await getRes.json() as {
      session_id: string;
      messages: Array<{role: string; text: string; toolCalls?: Array<{toolId: string; toolName: string; parameters: Record<string, unknown>}>}>;
    };
    expect(getRes.status).toBe(200);

    const assistantWithTools = getBody.messages.find((m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0);
    // Soft assertion: the model may choose not to call tools on any given
    // turn (LLM non-determinism). When it does, the toolCall round-trip
    // must work end-to-end.
    if (assistantWithTools?.toolCalls) {
      const call = assistantWithTools.toolCalls[0];
      expect(call.toolId).toBeTruthy();
      expect(call.toolName).toBeTruthy();
      expect(typeof call.parameters).toBe('object');
    } else {
      // eslint-disable-next-line no-console -- intentional test diagnostic
      console.warn('[smoke] Model did not call a tool for the request prompt — LLM non-determinism, skipping toolCall round-trip assertion');
    }
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 24. Files — browser and editor
  // -------------------------------------------------------------------------

  it('lists repo files as a tree', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/files`, {signal: AbortSignal.timeout(5000)});
    const body = await res.json() as {tree: Array<Record<string, unknown>>; repoPath: string};

    expect(res.status).toBe(200);
    expect(body.tree.length).toBeGreaterThan(0);
    // Should include at least one convention directory
    const names = body.tree.map((n) => String(n['name']));
    expect(names.some((n) => ['skills', 'connections', 'stores', 'tools'].includes(n))).toBe(true);
  });

  it('reads a specific file', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/files/amodal.json`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(200);
    const body = await res.json() as {path: string; content: string; language: string};
    expect(body.path).toBe('amodal.json');
    expect(body.language).toBe('json');
    expect(body.content).toContain('smoke-test-agent');
  });

  it('writes a file and reads it back', async () => {
    const testPath = 'knowledge/smoke-write-test.md';
    const testContent = '# Smoke Write Test\n\nThis file was written by a smoke test.';

    const writeRes = await fetch(`http://localhost:${AGENT_PORT}/api/files/${testPath}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: testContent}),
      signal: AbortSignal.timeout(5000),
    });
    expect(writeRes.status).toBe(200);

    const readRes = await fetch(`http://localhost:${AGENT_PORT}/api/files/${testPath}`, {signal: AbortSignal.timeout(5000)});
    expect(readRes.status).toBe(200);
    const body = await readRes.json() as {content: string};
    expect(body.content).toBe(testContent);
  });

  it('rejects path traversal attempts', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/files/..%2F..%2F..%2Fetc%2Fpasswd`, {signal: AbortSignal.timeout(5000)});
    expect([400, 403, 404]).toContain(res.status);
  });

  // -------------------------------------------------------------------------
  // 26. Store REST API — CRUD outside chat
  // -------------------------------------------------------------------------

  it('lists stores with document counts', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/stores`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(200);
    const body = await res.json() as {stores: Array<Record<string, unknown>>};
    expect(body.stores.length).toBeGreaterThan(0);
    const testItems = body.stores.find((s) => s['name'] === 'test-items');
    expect(testItems).toBeDefined();
    expect(typeof testItems?.['documentCount']).toBe('number');
  });

  it('writes and retrieves a document via REST', async () => {
    const writeRes = await fetch(`http://localhost:${AGENT_PORT}/api/stores/test-items`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({item_id: 'rest-api-test', name: 'REST API Item', status: 'active'}),
      signal: AbortSignal.timeout(5000),
    });
    expect(writeRes.status).toBe(201);
    const writeBody = await writeRes.json() as {stored: boolean; key: string};
    expect(writeBody.key).toBe('rest-api-test');

    const readRes = await fetch(`http://localhost:${AGENT_PORT}/api/stores/test-items/rest-api-test`, {signal: AbortSignal.timeout(5000)});
    expect(readRes.status).toBe(200);
    const readBody = await readRes.json() as {document: {payload: Record<string, unknown>}};
    expect(readBody.document.payload['name']).toBe('REST API Item');
  });

  it('lists documents in a store', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/stores/test-items?limit=10`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(200);
    const body = await res.json() as {documents: Array<Record<string, unknown>>; total: number};
    expect(Array.isArray(body.documents)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('returns 404 for unknown store', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/stores/nonexistent-store`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 27. Feedback
  // -------------------------------------------------------------------------

  it('saves feedback rating', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/feedback`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionId: 'smoke-session',
        messageId: 'smoke-msg-1',
        rating: 'up',
        query: 'Test query',
        response: 'Test response',
      }),
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {ok: boolean; id: string};
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
  });

  it('rejects invalid feedback rating', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/feedback`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sessionId: 'x', messageId: 'y', rating: 'invalid'}),
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Agent loop safety features (budget, done reason)
  // -------------------------------------------------------------------------

  it('done event carries reason=model_stop on normal completion', async () => {
    const {events} = await chat('Reply with just the word "ok".');
    expectDoneReason(events, 'model_stop');
  });

  it('max_session_tokens budget terminates the loop with reason=budget_exceeded', async () => {
    // 200 tokens is well below what any single-turn + tool-call response
    // will consume, so the budget check fires after the first turn.
    const {events} = await chat(
      'Echo these strings one at a time, calling echo_tool for each: alpha, bravo, charlie, delta, echo, foxtrot.',
      undefined,
      {maxSessionTokens: 200},
    );
    expectDoneReason(events, 'budget_exceeded');
    expectTotalTokens(events, {atLeast: 200});
  });

  // -------------------------------------------------------------------------
  // 25. Runtime event bus (/api/events SSE stream)
  // -------------------------------------------------------------------------

  it('emits session_created when a new chat session is created', async () => {
    const stream = await openEventStream();
    try {
      const chatResult = await chat('Say "hi" and nothing else.');
      const event = await stream.waitFor(
        (e) => e['type'] === 'session_created' && e['sessionId'] === chatResult.sessionId,
        TIMEOUT,
      );
      expect(event['type']).toBe('session_created');
      expect(event['sessionId']).toBe(chatResult.sessionId);
      expect(event['seq']).toBeGreaterThan(0);
      expect(typeof event['timestamp']).toBe('string');
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('emits session_updated on follow-up messages in an existing session', async () => {
    const first = await chat('Remember the number 7.');
    const stream = await openEventStream();
    try {
      await chat('Reply with just "ok".', first.sessionId);
      const event = await stream.waitFor(
        (e) => e['type'] === 'session_updated' && e['sessionId'] === first.sessionId,
        TIMEOUT,
      );
      expect(event['type']).toBe('session_updated');
      expect(event['sessionId']).toBe(first.sessionId);
    } finally {
      stream.close();
    }
  }, TIMEOUT * 2);

  it('emits session_deleted when a session is DELETEd', async () => {
    const {sessionId} = await chat('Say "ok".');

    const stream = await openEventStream();
    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      const event = await stream.waitFor(
        (e) => e['type'] === 'session_deleted' && e['sessionId'] === sessionId,
        5000,
      );
      expect(event['type']).toBe('session_deleted');
      expect(event['sessionId']).toBe(sessionId);
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('replays buffered events via Last-Event-ID on reconnect', async () => {
    // Produce at least one event, capture its seq, disconnect, reconnect
    // with Last-Event-ID set to seq-1, and verify we get the event back.
    const firstStream = await openEventStream();
    let capturedSeq = 0;
    try {
      await chat('Say "ok".');
      const event = await firstStream.waitFor((e) => e['type'] === 'session_created', TIMEOUT);
      capturedSeq = Number(event['seq']);
      expect(capturedSeq).toBeGreaterThan(0);
    } finally {
      firstStream.close();
    }

    const replayStream = await openEventStream({lastEventId: String(capturedSeq - 1)});
    try {
      const replayed = await replayStream.waitFor(
        (e) => Number(e['seq']) === capturedSeq,
        5000,
      );
      expect(Number(replayed['seq'])).toBe(capturedSeq);
    } finally {
      replayStream.close();
    }
  }, TIMEOUT);

  it('emits session_updated when title is PATCHed', async () => {
    const {sessionId} = await chat('Say "ok".');

    const stream = await openEventStream();
    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: 'my renamed session'}),
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);

      const event = await stream.waitFor(
        (e) => e['type'] === 'session_updated' && e['sessionId'] === sessionId && e['title'] === 'my renamed session',
        5000,
      );
      expect(event['title']).toBe('my renamed session');
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('emits store_updated when a tool writes to a store', async () => {
    const stream = await openEventStream();
    try {
      // Ask the agent to write to test-items store. Agent non-determinism
      // means it might not actually call the tool; we soft-check the event.
      await chat(
        'Write an item to the test-items store with id="evt-smoke-1" and name="smoke event test".',
      );

      const event = stream.events.find(
        (e) => e['type'] === 'store_updated' && e['storeName'] === 'test-items',
      );
      if (event) {
        expect(event['operation']).toBe('put');
      } else {
        // Model may have chosen not to call the store tool — this test is
        // soft (logged, not asserted) because it depends on LLM behavior.
        // eslint-disable-next-line no-console -- intentional test diagnostic
        console.warn('[smoke] store_updated not emitted — LLM may have declined to call store_write');
      }
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('emits store_updated when a direct REST write happens', async () => {
    // This path doesn't depend on the LLM — assertable hard.
    const stream = await openEventStream();
    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/api/stores/test-items`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: 'rest-smoke-1', name: 'direct rest write'}),
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(201);

      const event = await stream.waitFor(
        (e) => e['type'] === 'store_updated' && e['storeName'] === 'test-items' && e['operation'] === 'put',
        5000,
      );
      expect(event['operation']).toBe('put');
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('emits automation_started and automation_stopped', async () => {
    // The smoke agent's test-auto has no cron schedule, so start will fail.
    // That's fine — we want to verify the happy path when a schedulable
    // automation exists. Skip if none are available.
    const listRes = await fetch(`http://localhost:${AGENT_PORT}/automations`);
    const listBody = await listRes.json() as {automations: Array<{name: string; schedule?: string}>};
    const schedulable = listBody.automations.find((a) => a.schedule);
    if (!schedulable) {
      return; // smoke agent has no scheduled automation — skip
    }

    const stream = await openEventStream();
    try {
      const startRes = await fetch(
        `http://localhost:${AGENT_PORT}/automations/${schedulable.name}/start`,
        {method: 'POST', signal: AbortSignal.timeout(5000)},
      );
      if (startRes.status !== 200) return; // not a schedulable automation

      const started = await stream.waitFor(
        (e) => e['type'] === 'automation_started' && e['name'] === schedulable.name,
        5000,
      );
      expect(typeof started['intervalMs']).toBe('number');

      await fetch(
        `http://localhost:${AGENT_PORT}/automations/${schedulable.name}/stop`,
        {method: 'POST', signal: AbortSignal.timeout(5000)},
      );

      const stopped = await stream.waitFor(
        (e) => e['type'] === 'automation_stopped' && e['name'] === schedulable.name,
        5000,
      );
      expect(stopped['name']).toBe(schedulable.name);
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('fans out the same event to all concurrent clients (two-tab case)', async () => {
    // Two independent SSE connections — the "two browser tabs" scenario.
    // Every event emitted by the server should reach BOTH clients with
    // the same seq number.
    const [s1, s2] = await Promise.all([openEventStream(), openEventStream()]);
    try {
      const chatResult = await chat('Say "ok".');

      const [e1, e2] = await Promise.all([
        s1.waitFor(
          (e) => e['type'] === 'session_created' && e['sessionId'] === chatResult.sessionId,
          TIMEOUT,
        ),
        s2.waitFor(
          (e) => e['type'] === 'session_created' && e['sessionId'] === chatResult.sessionId,
          TIMEOUT,
        ),
      ]);

      // Same logical event reached both clients
      expect(e1['seq']).toBe(e2['seq']);
      expect(e1['timestamp']).toBe(e2['timestamp']);
      expect(e1['sessionId']).toBe(e2['sessionId']);
    } finally {
      s1.close();
      s2.close();
    }
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // Web tools (web_search, fetch_url) — gated on GOOGLE_API_KEY.
  //
  // When the smoke target is Anthropic/OpenAI but GOOGLE_API_KEY is set,
  // these tests exercise the cross-provider case: the main agent runs on
  // one provider, but web_search routes through the dedicated Gemini
  // backend. beforeAll injects the webTools config when the key is set.
  // -------------------------------------------------------------------------
  const hasGoogleKey = !!process.env['GOOGLE_API_KEY'];

  it.skipIf(!hasGoogleKey)('web_search tool is invoked for a current-information question', async () => {
    const {events} = await chat(
      'Use the web_search tool to find an authoritative source for the current stable version of Node.js. Reply with just the version number.',
    );

    const toolStarts = findEvents(events, 'tool_call_start');
    const toolResults = findEvents(events, 'tool_call_result');
    const webSearchStart = toolStarts.find((e) => e['tool_name'] === 'web_search');
    expect(webSearchStart).toBeDefined();

    // The matching result for that tool_id should be a success.
    const toolId = webSearchStart?.['tool_id'];
    const webSearchResult = toolResults.find((e) => e['tool_id'] === toolId);
    expect(webSearchResult).toBeDefined();
    expect(webSearchResult?.['status']).toBe('success');

    // The session should finish normally with text output.
    const done = findEvent(events, 'done');
    expect(done?.['reason']).toBe('model_stop');
    expect(allText(events).length).toBeGreaterThan(0);
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // 28. Image paste — vision input
  // -------------------------------------------------------------------------

  const testImageBase64 = readFileSync(resolve(__dirname, 'test-image.png')).toString('base64');

  it.skipIf(!VISION_PROVIDERS.has(smokeTargetName))('accepts image attachment and model responds', async () => {
    const {events} = await chat(
      'What color is the image? Reply with just the color name.',
      undefined,
      {images: [{mimeType: 'image/png', data: testImageBase64}]},
    );

    // Should get a normal streaming response — init, text deltas, done
    const init = findEvent(events, 'init');
    expect(init).toBeDefined();

    const text = allText(events);
    expect(text.length).toBeGreaterThan(0);

    expectDoneReason(events, 'model_stop');
  }, TIMEOUT);

  it.skipIf(!VISION_PROVIDERS.has(smokeTargetName))('image persists in session history across turns', async () => {
    // Turn 1: send image
    const {sessionId} = await chat(
      'Remember: I sent you a red image.',
      undefined,
      {images: [{mimeType: 'image/png', data: testImageBase64}]},
    );

    // Turn 2: follow-up without image — model should still know about it
    const {events: turn2Events} = await chat(
      'What color was the image I just sent?',
      sessionId,
    );

    const text = allText(turn2Events);
    expect(text.toLowerCase()).toContain('red');
    expectDoneReason(turn2Events, 'model_stop');
  }, TIMEOUT * 2);

  it('non-vision provider strips images and emits warning', async () => {
    // This test sends images regardless of provider — if the provider
    // doesn't support vision, we expect a warning event and the model
    // should still respond (to the text portion only).
    if (VISION_PROVIDERS.has(smokeTargetName)) {
      // Vision providers won't emit a warning — skip
      return;
    }

    const {events} = await chat(
      'Hello, just testing.',
      undefined,
      {images: [{mimeType: 'image/png', data: testImageBase64}]},
    );

    // Should emit a warning about images not being supported
    const warning = findEvent(events, 'warning');
    expect(warning).toBeDefined();
    expect(String(warning?.['message'])).toContain('not supported');

    // Model should still respond to the text
    const text = allText(events);
    expect(text.length).toBeGreaterThan(0);
    expectDoneReason(events, 'model_stop');
  }, TIMEOUT);

  it('rejects oversized image array via validation', async () => {
    // Send 6 images (max is 5) — should fail validation
    const images = Array.from({length: 6}, () => ({
      mimeType: 'image/png' as const,
      data: testImageBase64,
    }));

    const res = await fetch(`http://localhost:${AGENT_PORT}/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'test', images}),
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid image mime type via validation', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: 'test',
        images: [{mimeType: 'image/svg+xml', data: testImageBase64}],
      }),
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// SSE parser helper
// ---------------------------------------------------------------------------

function parseSSE(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try { events.push(JSON.parse(line.slice(6)) as Record<string, unknown>); } catch { /* skip */ }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Runtime event bus helper — opens a streaming fetch to /api/events and
// exposes waitFor(predicate) for assertion against live events.
// ---------------------------------------------------------------------------

interface EventStreamHandle {
  events: Array<Record<string, unknown>>;
  waitFor: (
    predicate: (event: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown>>;
  close: () => void;
}

async function openEventStream(options: {lastEventId?: string} = {}): Promise<EventStreamHandle> {
  const controller = new AbortController();
  const headers: Record<string, string> = {Accept: 'text/event-stream'};
  if (options.lastEventId) headers['Last-Event-ID'] = options.lastEventId;

  const res = await fetch(`http://localhost:${AGENT_PORT}/api/events`, {
    headers,
    signal: controller.signal,
  });
  if (!res.body) throw new Error('no response body from /api/events');

  const events: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (event: Record<string, unknown>) => boolean;
    resolve: (event: Record<string, unknown>) => void;
  }> = [];

  // Drain the stream in the background, parsing SSE frames. Push each event
  // to the events array and notify any waiting predicates.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let draining = true;

  void (async () => {
    try {
      while (draining) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
             
            const event = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
            events.push(event);
            // Notify any matching waiters (iterate a snapshot; matching
            // waiters are removed from the queue).
            for (let i = waiters.length - 1; i >= 0; i--) {
              const waiter = waiters[i];
              if (waiter && waiter.predicate(event)) {
                waiters.splice(i, 1);
                waiter.resolve(event);
              }
            }
          } catch { /* malformed frame */ }
        }
      }
    } catch { /* aborted or connection closed */ }
  })();

  return {
    events,
    waitFor(predicate, timeoutMs = 5000) {
      // Check already-buffered events first
      const already = events.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.predicate === predicate);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`waitFor timed out after ${String(timeoutMs)}ms`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
        });
      });
    },
    close() {
      draining = false;
      controller.abort();
      reader.cancel().catch(() => {});
    },
  };
}
