# Smoke Tests

End-to-end integration tests that start a real `amodal dev` server with mock REST and MCP backends, then run assertions against the chat API using a live LLM.

## Setup

Create `.env.test` at the **repo root** with your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

This file is gitignored. Tests skip automatically if the key isn't set.

## Running

```bash
# All smoke tests (~90s, ~23 LLM calls)
pnpm --filter @amodalai/runtime run test:smoke

# Single test by name (~5s, 1 LLM call)
pnpm --filter @amodalai/runtime run test:smoke -t "dispatch_task tool is available"

# Multiple tests by pattern
pnpm --filter @amodalai/runtime run test:smoke -t "dispatch_task|persists data"

# Regex patterns work too
pnpm --filter @amodalai/runtime run test:smoke -t "store.*persist"
```

> **No `--` before `-t`.** pnpm passes trailing args directly to vitest. Adding `--` breaks the flag parsing.

The `-t` flag filters which `it()` blocks execute. The server still starts once (shared `beforeAll`), but only matched tests make LLM calls — so filtering saves both time and money.

## What's tested

| #   | Test               | What it verifies                                       |
| --- | ------------------ | ------------------------------------------------------ |
| 1   | health endpoint    | Server starts and responds                             |
| 2   | config endpoint    | Agent config loads from repo                           |
| 3   | system prompt (G9) | Prompt includes connections, skills, knowledge, stores |
| 4   | chat streaming     | Init, text_delta, done events with usage               |
| 5   | session resume     | Multi-turn context preserved across messages           |
| 6   | store tool call    | Model calls query_store                                |
| 7   | connection request | Request tool hits mock-api                             |
| 8   | tool error status  | Failed tool calls report status: error                 |
| 9   | eval run           | Eval suite executes and scores                         |
| 10  | admin chat         | Admin agent reads repo files                           |
| 11  | write intent (G8)  | POST with intent "read" rejected                       |
| 12  | store persistence  | Write + query in separate sessions                     |
| 13  | session isolation  | Concurrent sessions don't share context                |
| 14  | automation API     | Automation endpoint responds                           |
| 15  | multi-turn tools   | Tool call → reasoning about result                     |
| 16  | evals list         | Eval suites listed from repo                           |
| 17  | inspect endpoint   | Connection status visible                              |
| 18  | MCP tool call      | MCP tool executes via stdio transport                  |
| 19  | custom tool        | echo_tool with ctx.request + ctx.store                 |
| 20  | stop_execution     | Tool is available to model                             |
| 21  | done usage (G2)    | Done event always has token counts                     |
| 22  | dispatch_task      | Child agent runs with tool subset                      |
| 23  | dispatch available | dispatch_task tool in model's tool list                |

## Architecture

```
smoke.test.ts          — test suite (vitest)
smoke-agent/           — self-contained agent repo (.amodal/ config)
  amodal.json          — agent config (name, model)
  connections/         — mock-api (REST) + mock-mcp (MCP stdio)
  stores/              — test-items store schema
  skills/              — test-skill
  knowledge/           — reference doc with tool list
  tools/               — echo-tool custom handler
  evals/               — basic-eval suite
  automations/         — test-auto definition
smoke-rest-server.mjs  — Express mock returning test data on :9901
smoke-mcp-server.mjs   — MCP stdio server with search/lookup/count tools
```

The test `beforeAll` starts the mock REST server and `createLocalServer()` programmatically on port 9900. Tests call `POST /chat` and parse SSE events from the response.

## Web-tool smoke scripts (opt-in, repo-root `scripts/`)

Two manual scripts exercise `web_search` + `fetch_url` against the real Google API — gated on `GOOGLE_API_KEY` being in `.env.test`:

```bash
# Direct — calls SearchProvider + both tool executors in isolation
node scripts/smoke-web-tools.mjs

# End-to-end — starts amodal dev with Anthropic main + Google webTools,
# sends a chat message, asserts the agent invoked web_search with a
# non-error result
node scripts/smoke-web-tools-e2e.mjs
```

The E2E script temporarily rewrites `smoke-agent/amodal.json` to add the `webTools` block (and restores it on exit). Both require `GOOGLE_API_KEY` in `.env.test`; the E2E script additionally needs `ANTHROPIC_API_KEY`.

## LLM non-determinism

Some tests depend on the model calling specific tools. When the model chooses not to (despite explicit instruction), the test skips gracefully with a console warning rather than failing. This prevents flaky CI from LLM variability while still catching real code bugs.
