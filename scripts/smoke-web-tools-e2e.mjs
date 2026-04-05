#!/usr/bin/env node
/**
 * End-to-end smoke test: Anthropic-backed agent + Google webTools.
 *
 * Verifies the key architectural claim: web_search works for agents
 * running on a non-Google main provider. Main model is Claude Sonnet;
 * web_search routes through a separate Gemini Flash instance.
 *
 * Steps:
 *   1. Patch smoke-agent/amodal.json to add webTools (Google).
 *   2. Start `amodal dev` programmatically on a random port.
 *   3. Send a chat prompt that requires current info.
 *   4. Parse SSE stream, verify a `tool_call` for web_search happened.
 *   5. Restore amodal.json and tear down.
 *
 * Requires ANTHROPIC_API_KEY + GOOGLE_API_KEY in the environment.
 */

import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const AGENT_DIR = resolve(REPO_ROOT, 'packages/runtime/src/__fixtures__/smoke-agent');
const AMODAL_JSON = resolve(AGENT_DIR, 'amodal.json');
const MCP_SPEC = resolve(AGENT_DIR, 'connections/mock-mcp/spec.json');
const MCP_SERVER = resolve(REPO_ROOT, 'packages/runtime/src/__fixtures__/smoke-mcp-server.mjs');
const PORT = 37842;
const TIMEOUT_MS = 90_000;

// --- Load env from .env.test ---
const envPath = resolve(REPO_ROOT, '.env.test');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && m[1] && m[2] && !process.env[m[1].trim()]) {
    process.env[m[1].trim()] = m[2].trim();
  }
}

if (!process.env.ANTHROPIC_API_KEY || !process.env.GOOGLE_API_KEY) {
  console.error('Need ANTHROPIC_API_KEY + GOOGLE_API_KEY');
  process.exit(1);
}

const pass = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg, err) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  if (err) console.error(err);
  process.exitCode = 1;
};

// --- Patch amodal.json with webTools block ---
const originalAmodalJson = readFileSync(AMODAL_JSON, 'utf-8');
const originalMcpSpec = readFileSync(MCP_SPEC, 'utf-8');
let server;

async function cleanup() {
  writeFileSync(AMODAL_JSON, originalAmodalJson);
  writeFileSync(MCP_SPEC, originalMcpSpec);
  if (server) {
    try { await server.stop?.(); } catch { /* noop */ }
  }
  rmSync(resolve(AGENT_DIR, '.amodal/store-data'), {recursive: true, force: true});
}

process.on('SIGINT', () => cleanup().then(() => process.exit(130)));

async function main() {
  // 1. Patch config
  const cfg = JSON.parse(originalAmodalJson);
  cfg.models = {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}};
  cfg.webTools = {provider: 'google', apiKey: 'env:GOOGLE_API_KEY', model: 'gemini-3-flash-preview'};
  writeFileSync(AMODAL_JSON, JSON.stringify(cfg, null, 2));
  writeFileSync(MCP_SPEC, JSON.stringify({
    protocol: 'mcp', transport: 'stdio', command: 'node', args: [MCP_SERVER],
  }, null, 2));
  console.log('Patched amodal.json: main=anthropic/claude-sonnet, webTools=google/gemini-3-flash');

  rmSync(resolve(AGENT_DIR, '.amodal/store-data'), {recursive: true, force: true});

  // 2. Start server
  const {createLocalServer} = await import('../packages/runtime/dist/src/agent/local-server.js');
  server = await createLocalServer({
    repoPath: AGENT_DIR,
    port: PORT,
    host: '127.0.0.1',
    hotReload: false,
  });
  await server.start();
  // Wait for server readiness
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) break;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`Server started on http://127.0.0.1:${PORT}`);

  // 3. Send a chat message that requires current info
  const prompt =
    'Use the web_search tool to find the current stable version of Node.js. ' +
    'Then reply with ONLY the version number (e.g. "22.11.0").';

  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message: prompt}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    fail(`HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  // 4. Parse SSE stream
  const text = await res.text();
  const events = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try { events.push(JSON.parse(line.slice(6))); } catch { /* skip */ }
    }
  }

  const dur = Date.now() - t0;
  console.log(`\nChat completed in ${dur}ms, ${events.length} SSE events`);
  const eventTypes = [...new Set(events.map((e) => e.type))];
  console.log(`  event types: ${eventTypes.join(', ')}`);

  const toolCalls = events.filter((e) => e.type === 'tool_call_start');
  const toolResults = events.filter((e) => e.type === 'tool_call_result');
  const textDeltas = events.filter((e) => e.type === 'text_delta' || e.type === 'text');
  const done = events.find((e) => e.type === 'done');

  console.log(`  tool_call events: ${toolCalls.length}`);
  for (const tc of toolCalls) {
    console.log(`    → ${tc.tool_name}(${JSON.stringify(tc.parameters ?? {}).slice(0, 120)})`);
  }
  console.log(`  tool_result events: ${toolResults.length}`);
  console.log(`  text_delta events: ${textDeltas.length}`);
  console.log(`  done: reason=${done?.reason}`);

  const finalText = textDeltas.map((e) => e.delta ?? e.text ?? e.content ?? '').join('');
  console.log(`\nFinal text: ${finalText.slice(0, 400)}`);

  // 5. Assertions
  const webSearchCall = toolCalls.find((e) => e.tool_name === 'web_search');
  if (webSearchCall) pass('agent invoked web_search tool');
  else fail('web_search tool was NOT invoked');

  // Match result back to a tool_call_start by tool_id to get the name
  const webSearchIds = new Set(toolCalls.filter((e) => e.tool_name === 'web_search').map((e) => e.tool_id));
  const webSearchResult = toolResults.find((e) => webSearchIds.has(e.tool_id));
  // Check it wasn't an error payload
  const resultOk = webSearchResult
    && webSearchResult.status !== 'error'
    && !(typeof webSearchResult.result === 'object' && webSearchResult.result?.status === 'error');
  console.log(`  web_search result payload: ${JSON.stringify(webSearchResult?.result ?? webSearchResult).slice(0, 200)}`);
  if (webSearchResult) pass('web_search returned a result');
  else fail('no web_search tool_result event');
  if (resultOk) pass('web_search result payload is ok (not an error)');
  else fail('web_search returned an error payload');

  // Check final text doesn't signal tool failure
  const apologyPhrases = ['unable to access', 'unable to use', 'not working', 'technical issues'];
  const hasApology = apologyPhrases.some((p) => finalText.toLowerCase().includes(p));
  if (!hasApology) pass('final text does not signal tool failure');
  else fail('final text indicates the agent thinks the tool failed');

  if (done?.reason === 'model_stop') pass('chat completed with reason=model_stop');
  else fail(`unexpected done reason: ${done?.reason}`);

  if (finalText.length > 0) pass(`agent produced text output (${finalText.length} chars)`);
  else fail('no text output');
}

main()
  .catch((err) => { fail('main() threw', err); })
  .finally(async () => {
    await cleanup();
    console.log(`\n${process.exitCode ? '\x1b[31mFAILED\x1b[0m' : '\x1b[32mALL PASSED\x1b[0m'}`);
    process.exit(process.exitCode ?? 0);
  });
