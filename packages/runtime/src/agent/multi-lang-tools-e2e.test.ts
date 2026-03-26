/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * E2E tests: custom tools in multiple languages.
 *
 * Each test creates a repo with a tool that delegates to a different
 * runtime via ctx.exec(). The agent runner calls the tool (LLM mocked),
 * the handler shells out to the script, and the result comes back via SSE.
 *
 * Part 1 (local): runs on the dev machine — skips if the runtime isn't installed.
 * Part 2 (Daytona): runs the same tools in Daytona sandboxes.
 */

import {describe, it, expect, vi, beforeEach, afterEach, beforeAll} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadRepo} from '@amodalai/core';
import type {SSEEvent} from '../types.js';
import {SSEEventType} from '../types.js';

// ── Mock LLM ──

const {mockChat, mockFailoverCtor} = vi.hoisted(() => {
  const chat = vi.fn();
  const ctor = vi.fn().mockImplementation(() => ({chat}));
  return {mockChat: chat, mockFailoverCtor: ctor};
});

vi.mock('@amodalai/core', async (importOriginal) => {
   
  const actual = await importOriginal();
  return {...actual, FailoverProvider: mockFailoverCtor};
});

// ── Helpers ──

function hasRuntime(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, {stdio: 'pipe'});
    return true;
  } catch {
    return false;
  }
}

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'multi-lang-e2e-'));
  writeFileSync(join(dir, 'amodal.json'), JSON.stringify({
    name: 'multi-lang-test',
    version: '1.0.0',
    models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
  }));
  return dir;
}

function addTool(repoDir: string, name: string, files: Record<string, string>) {
  const toolDir = join(repoDir, 'tools', name);
  mkdirSync(toolDir, {recursive: true});
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(toolDir, filename), content);
    if (filename.endsWith('.sh') || filename.endsWith('.rb') || filename.endsWith('.py')) {
      chmodSync(join(toolDir, filename), 0o755);
    }
  }
  return toolDir;
}

async function runToolViaAgentRunner(
  repoDir: string,
  toolName: string,
  toolParams: Record<string, unknown>,
): Promise<{events: SSEEvent[]; toolResult: string | undefined}> {
  const repo = await loadRepo({localPath: repoDir});

  // Swap handler.ts → handler.mjs for dynamic import
  for (const tool of repo.tools) {
    const mjsPath = join(tool.location, 'handler.mjs');
    tool.handlerPath = mjsPath;
  }

  const toolCallId = `tc_${toolName}_001`;

  mockChat
    .mockResolvedValueOnce({
      content: [{type: 'tool_use', id: toolCallId, name: toolName, input: toolParams}],
      stopReason: 'tool_use',
      usage: {inputTokens: 100, outputTokens: 50},
    })
    .mockResolvedValueOnce({
      content: [{type: 'text', text: 'Done.'}],
      stopReason: 'end_turn',
      usage: {inputTokens: 200, outputTokens: 10},
    });

  const {setupSession, PlanModeManager, prepareExploreConfig} = await import('@amodalai/core');
  const {runAgentTurn} = await import('./agent-runner.js');

  const runtime = setupSession({repo, userId: 'test', userRoles: [], isDelegated: false});
  const session = {
    id: 'ml-session',
    runtime,
    tenantId: 'test',
    conversationHistory: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    planModeManager: new PlanModeManager(),
    exploreConfig: prepareExploreConfig(runtime),
  };

  const events: SSEEvent[] = [];
  for await (const event of runAgentTurn(
     
    session as Parameters<typeof runAgentTurn>[0],
    'run the tool',
    AbortSignal.timeout(30000),
  )) {
    events.push(event);
  }

  const resultEvent = events.find(
    (e) => e.type === SSEEventType.ToolCallResult && e.tool_id === toolCallId,
  );
  const toolResult = resultEvent?.type === SSEEventType.ToolCallResult
    ? resultEvent.result
    : undefined;

  return {events, toolResult};
}

// ── Part 1: Local execution through agent runner ──

describe('Multi-language custom tools — local execution', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createRepo();
    mockChat.mockReset();
    mockFailoverCtor.mockClear();
    // Re-establish the constructor implementation after reset
    mockFailoverCtor.mockImplementation(() => ({chat: mockChat}));
  });

  afterEach(() => {
    rmSync(repoDir, {recursive: true, force: true});
  });

  // ── JavaScript (Node.js) ──

  it('JavaScript: tool runs a .js script via ctx.exec()', async () => {
    addTool(repoDir, 'js_stats', {
      'tool.json': JSON.stringify({
        description: 'Compute array statistics using Node.js',
        parameters: {
          type: 'object',
          properties: {values: {type: 'array', items: {type: 'number'}}},
          required: ['values'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'node compute.js \\'' + JSON.stringify(params) + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'compute.js': `
const params = JSON.parse(process.argv[2]);
const vals = params.values;
const sum = vals.reduce((a, b) => a + b, 0);
const mean = sum / vals.length;
const min = Math.min(...vals);
const max = Math.max(...vals);
console.log(JSON.stringify({ sum, mean, min, max, count: vals.length }));
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'js_stats', {
      values: [10, 20, 30, 40, 50],
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.sum).toBe(150);
    expect(parsed.mean).toBe(30);
    expect(parsed.min).toBe(10);
    expect(parsed.max).toBe(50);
    expect(parsed.count).toBe(5);
  }, 30000);

  // ── Python ──

  it.skipIf(!hasRuntime('python3'))('Python: tool runs a .py script with JSON I/O', async () => {
    void addTool(repoDir, 'py_transform', {
      'tool.json': JSON.stringify({
        description: 'Transform data using Python',
        parameters: {
          type: 'object',
          properties: {
            records: {type: 'array', items: {type: 'object'}},
            multiply_field: {type: 'string'},
            factor: {type: 'number'},
          },
          required: ['records', 'multiply_field', 'factor'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'python3 transform.py \\'' + JSON.stringify(params) + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'transform.py': `
import sys, json
params = json.loads(sys.argv[1])
records = params['records']
field = params['multiply_field']
factor = params['factor']

transformed = []
for r in records:
    r[field] = r.get(field, 0) * factor
    transformed.append(r)

total = sum(r[field] for r in transformed)
print(json.dumps({"transformed": transformed, "total": total, "count": len(transformed)}))
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'py_transform', {
      records: [
        {name: 'A', amount: 100},
        {name: 'B', amount: 200},
        {name: 'C', amount: 300},
      ],
      multiply_field: 'amount',
      factor: 1.5,
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.count).toBe(3);
    expect(parsed.total).toBe(900); // (100+200+300) * 1.5
    expect(parsed.transformed[0].amount).toBe(150);
    expect(parsed.transformed[1].amount).toBe(300);
    expect(parsed.transformed[2].amount).toBe(450);
  }, 30000);

  // ── Ruby ──

  it.skipIf(!hasRuntime('ruby'))('Ruby: tool runs a .rb script', async () => {
    addTool(repoDir, 'rb_formatter', {
      'tool.json': JSON.stringify({
        description: 'Format data using Ruby',
        parameters: {
          type: 'object',
          properties: {
            items: {type: 'array', items: {type: 'object'}},
            template: {type: 'string'},
          },
          required: ['items', 'template'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'ruby format.rb \\'' + JSON.stringify(params) + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'format.rb': `
require 'json'
params = JSON.parse(ARGV[0])
items = params['items']
template = params['template']

formatted = items.map do |item|
  result = template.dup
  item.each { |k, v| result.gsub!("{#{k}}", v.to_s) }
  result
end

puts JSON.generate({ formatted: formatted, count: formatted.length })
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'rb_formatter', {
      items: [
        {name: 'Alice', score: 95},
        {name: 'Bob', score: 87},
      ],
      template: '{name}: {score} points',
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.count).toBe(2);
    expect(parsed.formatted[0]).toBe('Alice: 95 points');
    expect(parsed.formatted[1]).toBe('Bob: 87 points');
  }, 30000);

  // ── Go ──

  it.skipIf(!hasRuntime('go'))('Go: tool compiles and runs a .go program', async () => {
    addTool(repoDir, 'go_hasher', {
      'tool.json': JSON.stringify({
        description: 'Hash strings using Go',
        parameters: {
          type: 'object',
          properties: {
            inputs: {type: 'array', items: {type: 'string'}},
            algorithm: {type: 'string', enum: ['sha256', 'md5']},
          },
          required: ['inputs'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'go run hasher.go \\'' + JSON.stringify(params) + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'hasher.go': `
package main

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
)

type Params struct {
	Inputs    []string \`json:"inputs"\`
	Algorithm string   \`json:"algorithm"\`
}

type Result struct {
	Hashes []string \`json:"hashes"\`
	Count  int      \`json:"count"\`
}

func main() {
	var params Params
	json.Unmarshal([]byte(os.Args[1]), &params)
	if params.Algorithm == "" {
		params.Algorithm = "sha256"
	}

	hashes := make([]string, len(params.Inputs))
	for i, input := range params.Inputs {
		if params.Algorithm == "md5" {
			hashes[i] = fmt.Sprintf("%x", md5.Sum([]byte(input)))
		} else {
			hashes[i] = fmt.Sprintf("%x", sha256.Sum256([]byte(input)))
		}
	}

	result := Result{Hashes: hashes, Count: len(hashes)}
	out, _ := json.Marshal(result)
	fmt.Println(string(out))
}
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'go_hasher', {
      inputs: ['hello', 'world'],
      algorithm: 'md5',
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.count).toBe(2);
    // MD5 of "hello" = 5d41402abc4b2a76b9719d911017c592
    expect(parsed.hashes[0]).toBe('5d41402abc4b2a76b9719d911017c592');
  }, 60000); // Go compile takes time

  // ── Bash ──

  it('Bash: tool runs a .sh script', async () => {
    addTool(repoDir, 'sh_wordcount', {
      'tool.json': JSON.stringify({
        description: 'Count words and lines in text',
        parameters: {
          type: 'object',
          properties: {text: {type: 'string'}},
          required: ['text'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'bash wordcount.sh \\'' + params.text.replace(/'/g, "'\\\\''") + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'wordcount.sh': `#!/bin/bash
TEXT="$1"
WORDS=$(echo "$TEXT" | wc -w | tr -d ' ')
LINES=$(echo "$TEXT" | wc -l | tr -d ' ')
CHARS=$(echo -n "$TEXT" | wc -c | tr -d ' ')
echo "{\\"words\\": $WORDS, \\"lines\\": $LINES, \\"chars\\": $CHARS}"
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'sh_wordcount', {
      text: 'hello world\nthis is a test\nthird line',
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.words).toBe(8);
    expect(parsed.lines).toBe(3);
  }, 30000);

  // ── TypeScript (compiled inline via Node) ──

  it('TypeScript: tool runs inline TS-style logic via Node', async () => {
    addTool(repoDir, 'ts_validator', {
      'tool.json': JSON.stringify({
        description: 'Validate email addresses',
        parameters: {
          type: 'object',
          properties: {emails: {type: 'array', items: {type: 'string'}}},
          required: ['emails'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'node validate.js \\'' + JSON.stringify(params) + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'validate.js': `
const params = JSON.parse(process.argv[2]);
const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

const results = params.emails.map(email => ({
  email,
  valid: emailRegex.test(email),
}));

const validCount = results.filter(r => r.valid).length;

console.log(JSON.stringify({
  results,
  total: results.length,
  valid: validCount,
  invalid: results.length - validCount,
}));
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'ts_validator', {
      emails: ['user@example.com', 'bad-email', 'test@test.co', '@missing.com'],
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.total).toBe(4);
    expect(parsed.valid).toBe(2);
    expect(parsed.invalid).toBe(2);
    expect(parsed.results[0].valid).toBe(true);
    expect(parsed.results[1].valid).toBe(false);
  }, 30000);

  // ── Python with library (stdlib json + math) ──

  it.skipIf(!hasRuntime('python3'))('Python with stdlib: tool uses math and statistics', async () => {
    addTool(repoDir, 'py_analysis', {
      'tool.json': JSON.stringify({
        description: 'Statistical analysis using Python stdlib',
        parameters: {
          type: 'object',
          properties: {values: {type: 'array', items: {type: 'number'}}},
          required: ['values'],
        },
      }),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec(
    'python3 analyze.py \\'' + JSON.stringify(params) + '\\''
  );
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
      'analyze.py': `
import sys, json, math, statistics

params = json.loads(sys.argv[1])
vals = params['values']

result = {
    "mean": statistics.mean(vals),
    "median": statistics.median(vals),
    "stdev": round(statistics.stdev(vals), 4) if len(vals) > 1 else 0,
    "variance": round(statistics.variance(vals), 4) if len(vals) > 1 else 0,
    "geometric_mean": round(math.exp(sum(math.log(v) for v in vals) / len(vals)), 4),
    "count": len(vals),
}

print(json.dumps(result))
`,
    });

    const {toolResult} = await runToolViaAgentRunner(repoDir, 'py_analysis', {
      values: [2, 4, 4, 4, 5, 5, 7, 9],
    });

    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!);
    expect(parsed.count).toBe(8);
    expect(parsed.mean).toBe(5);
    expect(parsed.median).toBe(4.5);
    expect(parsed.stdev).toBeGreaterThan(0);
  }, 30000);

  // ── Multiple tools in one repo ──

  it('Multiple tools in different languages in one repo', async () => {
    // JS tool
    addTool(repoDir, 'sum_tool', {
      'tool.json': JSON.stringify({description: 'Sum numbers'}),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('node -e "console.log(JSON.stringify({sum: ' + params.values.join('+') + '}))"');
  return JSON.parse(result.stdout);
};
`,
    });

    // Bash tool
    addTool(repoDir, 'echo_tool', {
      'tool.json': JSON.stringify({description: 'Echo a message'}),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('echo "echoed: ' + params.msg + '"');
  return { output: result.stdout.trim() };
};
`,
    });

    const repo = await loadRepo({localPath: repoDir});
    expect(repo.tools).toHaveLength(2);
    expect(repo.tools.map((t) => t.name).sort()).toEqual(['echo_tool', 'sum_tool']);

    // Test the JS tool
    const {toolResult: sumResult} = await runToolViaAgentRunner(repoDir, 'sum_tool', {values: [1, 2, 3]});
    expect(JSON.parse(sumResult!).sum).toBe(6);

    // Need to re-create repo for second tool call (mock is consumed)
    rmSync(repoDir, {recursive: true, force: true});
    repoDir = createRepo();
    addTool(repoDir, 'echo_tool', {
      'tool.json': JSON.stringify({description: 'Echo a message'}),
      'handler.ts': 'placeholder',
      'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('echo "echoed: ' + params.msg + '"');
  return { output: result.stdout.trim() };
};
`,
    });
    mockChat.mockReset();

    const {toolResult: echoResult} = await runToolViaAgentRunner(repoDir, 'echo_tool', {msg: 'hello'});
    expect(JSON.parse(echoResult!).output).toBe('echoed: hello');
  }, 30000);
});

// ── Part 2: Daytona sandbox execution ──

const DAYTONA_API_KEY = process.env['DAYTONA_API_KEY'];
const DAYTONA_API_URL = process.env['DAYTONA_API_URL'] ?? 'https://app.daytona.io/api';
const HAS_DAYTONA = !!DAYTONA_API_KEY;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let daytona: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deleteSandbox(client: any, sandbox: any, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await client.delete(sandbox);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('state change in progress') && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

describe.skipIf(!HAS_DAYTONA)('Multi-language tools — Daytona sandbox execution', () => {
  beforeAll(async () => {
    const sdk = await import('@daytonaio/sdk');
    daytona = new sdk.Daytona({apiKey: DAYTONA_API_KEY, apiUrl: DAYTONA_API_URL});
  });

  it('JavaScript: runs a Node.js computation in Daytona', async () => {
    const sandbox = await daytona.create({language: 'typescript'});
    try {
      const script = `
const vals = [10, 20, 30, 40, 50];
const sum = vals.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ sum, mean: sum / vals.length }));
`;
      await sandbox.fs.uploadFile(Buffer.from(script, 'utf-8'), '/home/daytona/compute.js');
      const response = await sandbox.process.executeCommand('node /home/daytona/compute.js');
      expect(response.exitCode).toBe(0);
      const result = JSON.parse(response.result);
      expect(result.sum).toBe(150);
      expect(result.mean).toBe(30);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 90000);

  it('Python: runs a Python script in Daytona', async () => {
    const sandbox = await daytona.create({language: 'python'});
    try {
      const script = `
import json, math, statistics
vals = [2, 4, 4, 4, 5, 5, 7, 9]
result = {
    "mean": statistics.mean(vals),
    "median": statistics.median(vals),
    "stdev": round(statistics.stdev(vals), 4),
    "count": len(vals),
}
print(json.dumps(result))
`;
      await sandbox.fs.uploadFile(Buffer.from(script, 'utf-8'), '/home/daytona/analyze.py');
      const response = await sandbox.process.executeCommand('python3 /home/daytona/analyze.py');
      expect(response.exitCode).toBe(0);
      const result = JSON.parse(response.result);
      expect(result.count).toBe(8);
      expect(result.mean).toBe(5);
      expect(result.median).toBe(4.5);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 90000);

  it('Bash: runs a shell script in Daytona', async () => {
    const sandbox = await daytona.create();
    try {
      const script = `#!/bin/bash
TEXT="hello world this is a test"
WORDS=$(echo "$TEXT" | wc -w | tr -d ' ')
echo "{\\"words\\": $WORDS}"
`;
      await sandbox.fs.uploadFile(Buffer.from(script, 'utf-8'), '/home/daytona/count.sh');
      const response = await sandbox.process.executeCommand('bash /home/daytona/count.sh');
      expect(response.exitCode).toBe(0);
      const result = JSON.parse(response.result);
      expect(result.words).toBe(6);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 90000);

  it('Python with pip library: installs and uses a package', async () => {
    const sandbox = await daytona.create({language: 'python'});
    try {
      // Install a small pip package
      const installResponse = await sandbox.process.executeCommand('pip install python-slugify', undefined, undefined, 60);
      expect(installResponse.exitCode).toBe(0);

      const script = `
import json
from slugify import slugify
titles = ["Hello World!", "My Blog Post #1", "Python is Great"]
slugs = [slugify(t) for t in titles]
print(json.dumps({"slugs": slugs, "count": len(slugs)}))
`;
      await sandbox.fs.uploadFile(Buffer.from(script, 'utf-8'), '/home/daytona/slugify_test.py');
      const response = await sandbox.process.executeCommand('python3 /home/daytona/slugify_test.py');
      expect(response.exitCode).toBe(0);
      const result = JSON.parse(response.result);
      expect(result.count).toBe(3);
      expect(result.slugs[0]).toContain('hello');
      expect(result.slugs[0]).toContain('world');
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);

  it('Node.js with npm library: installs and uses a package', async () => {
    const sandbox = await daytona.create({language: 'typescript'});
    try {
      // Install a small npm package
      await sandbox.process.executeCommand('npm init -y', '/home/daytona', undefined, 30);
      const installResponse = await sandbox.process.executeCommand(
        'npm install lodash',
        '/home/daytona',
        undefined,
        60,
      );
      expect(installResponse.exitCode).toBe(0);

      const script = `
const _ = require('lodash');
const data = [
  { name: 'Alice', dept: 'eng' },
  { name: 'Bob', dept: 'sales' },
  { name: 'Charlie', dept: 'eng' },
  { name: 'Diana', dept: 'sales' },
];
const grouped = _.groupBy(data, 'dept');
const result = {
  departments: Object.keys(grouped).sort(),
  eng_count: grouped.eng.length,
  sales_count: grouped.sales.length,
};
console.log(JSON.stringify(result));
`;
      await sandbox.fs.uploadFile(Buffer.from(script, 'utf-8'), '/home/daytona/group.js');
      const response = await sandbox.process.executeCommand('node /home/daytona/group.js');
      expect(response.exitCode).toBe(0);
      const result = JSON.parse(response.result);
      expect(result.departments).toEqual(['eng', 'sales']);
      expect(result.eng_count).toBe(2);
      expect(result.sales_count).toBe(2);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);

  it('runtime cleans up after SandboxShellExecutor', async () => {
    const {SandboxShellExecutor} = await import('@amodalai/hosted-runtime');

    const idsBefore = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((await daytona.list())?.items ?? []).map((s: any) => s.id),
    );

    const executor = new SandboxShellExecutor({daytona});
    const result = await executor.exec('echo "cleanup check"', 30000, AbortSignal.timeout(60000));

    expect(result.exitCode).toBe(0);

    await new Promise((r) => setTimeout(r, 2000));
    const idsAfter = ((await daytona.list())?.items ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any) => s.id as string)
      .filter((id: string) => !idsBefore.has(id));
    expect(idsAfter).toEqual([]);
  }, 90000);
});
