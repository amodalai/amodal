#!/usr/bin/env node
/**
 * Smoke test for web_search + fetch_url tools against the real Google API.
 *
 * Usage:
 *   GOOGLE_API_KEY=... node scripts/smoke-web-tools.mjs
 *
 * Tests:
 *   1. Direct SearchProvider.search() with a current-events query
 *   2. Direct SearchProvider.fetchUrl() with a public URL
 *   3. web_search tool via ToolContext
 *   4. fetch_url tool private-network local fallback
 */

import {createSearchProvider} from '../packages/runtime/dist/src/providers/search-provider.js';
import {createWebSearchTool} from '../packages/runtime/dist/src/tools/web-search-tool.js';
import {createFetchUrlTool} from '../packages/runtime/dist/src/tools/fetch-url-tool.js';

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_API_KEY not set.');
  process.exit(1);
}

const pass = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg, err) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  if (err) console.error(err);
  process.exitCode = 1;
};

function makeCtx(searchProvider) {
  return {
    request: async () => { throw new Error('not-mocked'); },
    store: async () => { throw new Error('not-mocked'); },
    env: () => undefined,
    log: () => {},
    user: {roles: []},
    signal: AbortSignal.timeout(60_000),
    sessionId: 'smoke-test',
    searchProvider,
  };
}

async function main() {
  const provider = createSearchProvider({
    provider: 'google',
    apiKey,
    model: 'gemini-2.5-flash',
  });

  console.log(`\n=== Test 1: SearchProvider.search() (live Gemini) ===`);
  try {
    const t0 = Date.now();
    const result = await provider.search('What is the latest stable version of Node.js in 2026?');
    const dur = Date.now() - t0;
    console.log(`  ${dur}ms, text=${result.text.length} chars, sources=${result.sources.length}`);
    console.log(`  text preview: ${result.text.slice(0, 150)}...`);
    if (result.sources.length > 0) {
      console.log(`  first source: ${result.sources[0].uri}`);
    }
    if (result.text.length > 0) pass('search returns non-empty text');
    else fail('search text is empty');
    if (result.sources.length > 0) pass(`search returns ${result.sources.length} grounded sources`);
    else fail('search returned no sources');
  } catch (err) {
    fail('SearchProvider.search threw', err);
    return;
  }

  console.log(`\n=== Test 2: SearchProvider.fetchUrl() (live Gemini urlContext) ===`);
  try {
    const t0 = Date.now();
    const result = await provider.fetchUrl('https://example.com');
    const dur = Date.now() - t0;
    console.log(`  ${dur}ms, text=${result.text.length} chars, retrievedUrls=${result.retrievedUrls.length}`);
    console.log(`  text preview: ${result.text.slice(0, 200)}...`);
    if (result.text.length > 0) pass('fetchUrl returns non-empty text');
    else fail('fetchUrl text is empty');
  } catch (err) {
    fail('SearchProvider.fetchUrl threw', err);
  }

  console.log(`\n=== Test 3: web_search tool via ToolContext (live Gemini) ===`);
  try {
    const tool = createWebSearchTool();
    const ctx = makeCtx(provider);
    const result = await tool.execute(
      {query: 'Who won the most recent FIFA World Cup?'},
      ctx,
    );
    console.log(`  status=${result.status}, source_count=${result.source_count}`);
    console.log(`  content preview: ${result.content.slice(0, 200)}...`);
    if (result.status === 'ok') pass('web_search tool returns ok status');
    else fail(`web_search returned ${result.status}`);
    if (result.content.includes('Sources:')) pass('web_search content includes cited sources');
    else console.warn('  (warning) no "Sources:" header in content');
  } catch (err) {
    fail('web_search tool threw', err);
  }

  console.log(`\n=== Test 4: fetch_url tool → private-network local fallback ===`);
  // Spin up a tiny localhost server so we can test the local-fetch path.
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(`<!doctype html><html><head><title>Smoke Test Page</title></head><body>
      <article><h1>Smoke Test Page</h1>
      <p>${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(30)}</p>
      <p>This content should be extracted by Mozilla Readability.</p>
      </article></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/page`;
  try {
    const tool = createFetchUrlTool();
    const ctx = makeCtx(provider); // provider set, but private host should still local-fetch
    const result = await tool.execute({url}, ctx);
    console.log(`  status=${result.status}, used_fallback=${result.used_fallback}`);
    console.log(`  content preview: ${result.content.slice(0, 200)}...`);
    if (result.status === 'ok') pass('local-fetch returns ok');
    else fail(`fetch_url returned ${result.status}: ${result.content}`);
    if (result.used_fallback === true) pass('private-network URL used local fallback');
    else fail('expected used_fallback=true for 127.0.0.1 URL');
    if (result.content.includes('Smoke Test Page')) pass('Readability extracted page content');
    else fail('expected "Smoke Test Page" in extracted content');
  } catch (err) {
    fail('fetch_url local-fetch threw', err);
  } finally {
    server.close();
  }

  console.log(`\n${process.exitCode ? '\x1b[31mFAILED\x1b[0m' : '\x1b[32mALL PASSED\x1b[0m'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
