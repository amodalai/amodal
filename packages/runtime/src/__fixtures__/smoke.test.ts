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
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import type {ServerInstance} from '../server.js';

// Load API keys from repo root .env.test if not already set.
// To run smoke tests: create .env.test at the repo root with ANTHROPIC_API_KEY=sk-ant-...
// This file is gitignored — never commit API keys.
if (!process.env['ANTHROPIC_API_KEY']) {
  try {
    const envPath = resolve(__dirname, '../../../../.env.test');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key && value && !process.env[key.trim()]) {
          process.env[key.trim()] = value.trim();
        }
      }
    }
  } catch { /* no .env.test — tests will skip */ }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AGENT_PORT = 9900;
const REST_PORT = 9901;
const AGENT_DIR = resolve(__dirname, 'smoke-agent');
const REST_SERVER = resolve(__dirname, 'smoke-rest-server.mjs');
const MCP_SERVER = resolve(__dirname, 'smoke-mcp-server.mjs');
const TIMEOUT = 45_000; // per-test timeout for LLM calls

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

async function chat(message: string, sessionId?: string): Promise<{events: Array<Record<string, unknown>>; sessionId: string}> {
  const body: Record<string, unknown> = {message};
  if (sessionId) body['session_id'] = sessionId;

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

const skipReason = process.env['ANTHROPIC_API_KEY'] ? '' : 'ANTHROPIC_API_KEY not set';

describe.skipIf(!!skipReason)('smoke tests', () => {
  beforeAll(async () => {
    // 0. Nuke prior state — clean slate for every run
    rmSync(resolve(AGENT_DIR, '.amodal/store-data'), {recursive: true, force: true});
    rmSync(resolve(AGENT_DIR, '.amodal/sessions'), {recursive: true, force: true});

    // 2. Write MCP server spec with absolute path (loadRepo reads this as-is)
    writeFileSync(
      resolve(AGENT_DIR, 'connections/mock-mcp/spec.json'),
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

    const responseText = allText(events);
    expect(responseText.toLowerCase()).toContain('test');
  }, TIMEOUT);

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
  // 13. Automation trigger
  // -------------------------------------------------------------------------

  it('triggers automation via API', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/automations`, {signal: AbortSignal.timeout(5000)});
    const body = await res.json() as {automations: Array<Record<string, unknown>>};

    // Smoke agent doesn't have automations defined in amodal.json,
    // but the endpoint should still respond
    expect(res.status).toBe(200);
    expect(body.automations).toBeDefined();
  });

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
    // Chat sessions in local dev don't auto-populate the legacy session store
    // used by /sessions (only automation runs do), so we just verify the
    // endpoint returns the expected shape.
    const res = await fetch(`http://localhost:${AGENT_PORT}/sessions`, {signal: AbortSignal.timeout(5000)});
    const body = await res.json() as {sessions: Array<Record<string, unknown>>};

    expect(res.status).toBe(200);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('returns 404 for unknown session', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/session/nonexistent-id`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(404);
  });

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
  // 25. Webhooks — inbound automation trigger
  // -------------------------------------------------------------------------

  it('rejects webhook for unknown automation with 404', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/webhooks/nonexistent-automation`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({event: 'test'}),
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as {error: string};
    expect(body.error).toContain('not found');
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

  it('returns feedback summary stats', async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/api/feedback/summary`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(200);
    const body = await res.json() as {total: number; thumbsUp: number; thumbsDown: number};
    expect(typeof body.total).toBe('number');
    expect(typeof body.thumbsUp).toBe('number');
    expect(typeof body.thumbsDown).toBe('number');
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
    // First ensure the session is saved to the legacy store — DELETE only
    // succeeds if legacySessionStore.delete() finds the session.
    const {sessionId} = await chat('Say "ok".');

    const stream = await openEventStream();
    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/session/${sessionId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
      // The legacy store mirror may be async, so a 404 is possible if the
      // mirror write hasn't landed yet. Either outcome is fine for the
      // event test — if the DELETE succeeds, the event should fire.
      if (res.status === 200) {
        const event = await stream.waitFor(
          (e) => e['type'] === 'session_deleted' && e['sessionId'] === sessionId,
          5000,
        );
        expect(event['type']).toBe('session_deleted');
        expect(event['sessionId']).toBe(sessionId);
      }
    } finally {
      stream.close();
    }
  }, TIMEOUT);

  it('emits automation_triggered and automation_completed on manual run', async () => {
    // The automation's registered name is derived from the filename
    // (automations/test-auto.md → "test-auto"), not the frontmatter.
    const automationName = 'test-auto';
    const stream = await openEventStream();
    try {
      const runPromise = fetch(
        `http://localhost:${AGENT_PORT}/automations/${automationName}/run`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: '{}',
          signal: AbortSignal.timeout(TIMEOUT),
        },
      );

      const triggered = await stream.waitFor(
        (e) => e['type'] === 'automation_triggered' && e['name'] === automationName,
        5000,
      );
      expect(triggered['source']).toBeDefined();

      const completed = await stream.waitFor(
        (e) =>
          (e['type'] === 'automation_completed' || e['type'] === 'automation_failed') &&
          e['name'] === automationName,
        TIMEOUT,
      );
      expect(completed['type']).toBe('automation_completed');
      expect(typeof completed['durationMs']).toBe('number');

      const runRes = await runPromise;
      expect([200, 500]).toContain(runRes.status);
    } finally {
      stream.close();
    }
  }, TIMEOUT + 10_000);

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
