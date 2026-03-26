/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * E2E tests for the full tool build pipeline.
 *
 * Simulates what the platform API does when it receives a tool build
 * request from the CLI:
 *   1. Create a repo with a multi-file tool (subdirectories, setup.sh, etc.)
 *   2. Tar the tool directory (same as CLI does)
 *   3. Create a Daytona sandbox
 *   4. Upload the archive and extract it
 *   5. Run setup.sh / pip install / npm install
 *   6. Execute the tool handler in the built sandbox
 *   7. Verify the result
 *
 * This proves the entire build → execute pipeline works end-to-end.
 *
 * Requires DAYTONA_API_KEY — skipped when not available.
 */

import {describe, it, expect, beforeAll, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadTools} from '@amodalai/core';

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

/**
 * Simulate what the platform API does: create sandbox, upload tar, extract, run setup.
 * Returns the sandbox (caller is responsible for deleting it).
 */
async function buildToolInDaytona(
  toolDir: string,
  language: string,
  hasSetupScript: boolean,
  hasRequirementsTxt: boolean,
  hasPackageJson: boolean,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // 1. Tar the tool directory (same as CLI's createToolArchive)
  const archive = execSync(
    'tar -czf - ' +
    '--exclude=node_modules --exclude=.git --exclude=__pycache__ ' +
    '-C ' + JSON.stringify(toolDir) + ' .',
    {maxBuffer: 50 * 1024 * 1024},
  );

  // 2. Create sandbox
  const sandbox = await daytona.create({language});

  try {
    // 3. Upload archive
    await sandbox.fs.uploadFile(Buffer.from(archive), '/tmp/tool.tar.gz');

    // 4. Extract
    const extractResult = await sandbox.process.executeCommand(
      'mkdir -p /home/daytona/tool && tar -xzf /tmp/tool.tar.gz -C /home/daytona/tool',
    );
    if (extractResult.exitCode !== 0) {
      throw new Error(`Extract failed: ${extractResult.result}`);
    }

    // 5. Run setup
    if (hasSetupScript) {
      const setupResult = await sandbox.process.executeCommand(
        'cd /home/daytona/tool && chmod +x setup.sh && bash setup.sh',
        undefined,
        undefined,
        120, // 2 minute timeout for installs
      );
      if (setupResult.exitCode !== 0) {
        throw new Error(`setup.sh failed: ${setupResult.result}`);
      }
    } else {
      if (hasRequirementsTxt) {
        const pipResult = await sandbox.process.executeCommand(
          'cd /home/daytona/tool && pip install -r requirements.txt',
          undefined,
          undefined,
          120,
        );
        if (pipResult.exitCode !== 0) {
          throw new Error(`pip install failed: ${pipResult.result}`);
        }
      }
      if (hasPackageJson) {
        const npmResult = await sandbox.process.executeCommand(
          'cd /home/daytona/tool && npm install --production',
          undefined,
          undefined,
          120,
        );
        if (npmResult.exitCode !== 0) {
          throw new Error(`npm install failed: ${npmResult.result}`);
        }
      }
    }

    return sandbox;
  } catch (err) {
    // Clean up on failure
    await deleteSandbox(daytona, sandbox);
    throw err;
  }
}

describe.skipIf(!HAS_DAYTONA)('Tool Build Pipeline E2E', () => {
  let repoDir: string;

  beforeAll(async () => {
    const sdk = await import('@daytonaio/sdk');
    daytona = new sdk.Daytona({apiKey: DAYTONA_API_KEY, apiUrl: DAYTONA_API_URL});
  });

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'tool-build-e2e-'));
  });

  afterEach(() => {
    rmSync(repoDir, {recursive: true, force: true});
  });

  // ── Node.js tool with subdirectories ──

  it('builds and executes a Node.js tool with nested source files', async () => {
    // Create tool with subdirectories
    const toolDir = join(repoDir, 'tools', 'data_processor');
    mkdirSync(join(toolDir, 'src', 'utils'), {recursive: true});

    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({
      description: 'Process data using multiple modules',
    }));
    writeFileSync(join(toolDir, 'handler.ts'), 'placeholder');

    // Main entry point
    writeFileSync(join(toolDir, 'handler.mjs'), `
export default async (params, ctx) => {
  const result = await ctx.exec('node src/main.js \\'' + JSON.stringify(params) + '\\'');
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`);

    // Nested source files
    writeFileSync(join(toolDir, 'src', 'main.js'), `
const { transform } = require('./utils/transform');
const { validate } = require('./utils/validate');
const params = JSON.parse(process.argv[2]);

const validated = validate(params.items);
const transformed = transform(validated, params.multiplier);
console.log(JSON.stringify(transformed));
`);

    writeFileSync(join(toolDir, 'src', 'utils', 'transform.js'), `
function transform(items, multiplier) {
  return {
    items: items.map(i => ({ ...i, value: i.value * multiplier })),
    total: items.reduce((sum, i) => sum + i.value * multiplier, 0),
  };
}
module.exports = { transform };
`);

    writeFileSync(join(toolDir, 'src', 'utils', 'validate.js'), `
function validate(items) {
  return items.filter(i => typeof i.value === 'number' && i.value > 0);
}
module.exports = { validate };
`);

    // Verify loader finds all the right files
    const tools = await loadTools(repoDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('data_processor');

    // Build in Daytona (simulates platform API)
    const sandbox = await buildToolInDaytona(toolDir, 'typescript', false, false, false);

    try {
      // Upload invocation payload
      const payload = JSON.stringify({
        params: {
          items: [{name: 'a', value: 10}, {name: 'b', value: 20}, {name: 'c', value: -5}],
          multiplier: 3,
        },
      });
      await sandbox.fs.uploadFile(Buffer.from(payload, 'utf-8'), '/tmp/invocation.json');

      // Execute the handler entry point
      const entryScript = `
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/invocation.json', 'utf-8'));
const { transform } = require('./src/utils/transform');
const { validate } = require('./src/utils/validate');

const validated = validate(payload.params.items);
const result = transform(validated, payload.params.multiplier);
process.stdout.write(JSON.stringify({ result }) + '\\n');
`;
      await sandbox.fs.uploadFile(Buffer.from(entryScript, 'utf-8'), '/home/daytona/tool/entry.js');

      const response = await sandbox.process.executeCommand('node /home/daytona/tool/entry.js');
      expect(response.exitCode).toBe(0);

      const output = JSON.parse(response.result);
      // c was filtered out (value -5 < 0), a=10*3=30, b=20*3=60
      expect(output.result.items).toHaveLength(2);
      expect(output.result.total).toBe(90);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);

  // ── Python tool with setup.sh ──

  it('builds a Python tool with setup.sh that installs pip deps', async () => {
    const toolDir = join(repoDir, 'tools', 'py_slugger');
    mkdirSync(toolDir, {recursive: true});

    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({
      description: 'Slugify strings',
      sandbox: {language: 'python'},
    }));
    writeFileSync(join(toolDir, 'handler.ts'), 'placeholder');

    writeFileSync(join(toolDir, 'requirements.txt'), 'python-slugify\n');

    writeFileSync(join(toolDir, 'setup.sh'), `#!/bin/bash
set -e
cd /home/daytona/tool
pip install -r requirements.txt
`);
    chmodSync(join(toolDir, 'setup.sh'), 0o755);

    writeFileSync(join(toolDir, 'slugify_tool.py'), `
import sys, json
from slugify import slugify

params = json.loads(sys.argv[1])
titles = params.get('titles', [])
slugs = [slugify(t) for t in titles]
print(json.dumps({"slugs": slugs, "count": len(slugs)}))
`);

    // Build with setup.sh
    const sandbox = await buildToolInDaytona(toolDir, 'python', true, false, false);

    try {
      // Run the Python script
      const params = JSON.stringify({titles: ['Hello World!', 'My Blog Post', 'Test 123']});
      const response = await sandbox.process.executeCommand(
        `cd /home/daytona/tool && python3 slugify_tool.py '${params}'`,
      );
      expect(response.exitCode).toBe(0);

      const result = JSON.parse(response.result);
      expect(result.count).toBe(3);
      expect(result.slugs[0]).toContain('hello');
      expect(result.slugs[0]).toContain('world');
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);

  // ── Node.js tool with package.json ──

  it('builds a Node.js tool with package.json deps (npm install)', async () => {
    const toolDir = join(repoDir, 'tools', 'lodash_grouper');
    mkdirSync(toolDir, {recursive: true});

    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({
      description: 'Group items using lodash',
    }));
    writeFileSync(join(toolDir, 'handler.ts'), 'placeholder');

    writeFileSync(join(toolDir, 'package.json'), JSON.stringify({
      name: 'lodash-grouper',
      private: true,
      dependencies: {lodash: '^4.17.21'},
    }));

    writeFileSync(join(toolDir, 'group.js'), `
const _ = require('lodash');
const params = JSON.parse(process.argv[2]);
const grouped = _.groupBy(params.items, params.key);
const result = {};
for (const [k, v] of Object.entries(grouped)) {
  result[k] = v.length;
}
console.log(JSON.stringify({ groups: result, total: params.items.length }));
`);

    // Build with package.json (npm install)
    const sandbox = await buildToolInDaytona(toolDir, 'typescript', false, false, true);

    try {
      const params = JSON.stringify({
        items: [
          {name: 'Alice', dept: 'eng'},
          {name: 'Bob', dept: 'sales'},
          {name: 'Charlie', dept: 'eng'},
          {name: 'Diana', dept: 'eng'},
        ],
        key: 'dept',
      });

      const response = await sandbox.process.executeCommand(
        `cd /home/daytona/tool && node group.js '${params}'`,
      );
      expect(response.exitCode).toBe(0);

      const result = JSON.parse(response.result);
      expect(result.groups['eng']).toBe(3);
      expect(result.groups['sales']).toBe(1);
      expect(result.total).toBe(4);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);

  // ── Tool with setup.sh that compiles a binary ──

  it('builds a tool where setup.sh compiles a shell script helper', async () => {
    const toolDir = join(repoDir, 'tools', 'compiled_tool');
    mkdirSync(join(toolDir, 'scripts'), {recursive: true});

    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({
      description: 'Tool with compiled helper',
    }));
    writeFileSync(join(toolDir, 'handler.ts'), 'placeholder');

    // A script that gets "compiled" (in this case, made executable and wrapped)
    writeFileSync(join(toolDir, 'scripts', 'compute.sh'), `#!/bin/bash
# Compute factorial
n=$1
result=1
for ((i=2; i<=n; i++)); do
  result=$((result * i))
done
echo $result
`);

    writeFileSync(join(toolDir, 'setup.sh'), `#!/bin/bash
set -e
cd /home/daytona/tool
chmod +x scripts/compute.sh
# Create a wrapper that does JSON I/O
cat > run.sh << 'WRAPPER'
#!/bin/bash
INPUT=$(cat /dev/stdin)
N=$(echo "$INPUT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf-8'));console.log(d.n)")
RESULT=$(bash scripts/compute.sh $N)
echo "{\\"factorial\\": $RESULT, \\"input\\": $N}"
WRAPPER
chmod +x run.sh
`);
    chmodSync(join(toolDir, 'setup.sh'), 0o755);

    const sandbox = await buildToolInDaytona(toolDir, 'typescript', true, false, false);

    try {
      const response = await sandbox.process.executeCommand(
        'cd /home/daytona/tool && echo \'{"n": 6}\' | bash run.sh',
      );
      expect(response.exitCode).toBe(0);

      const result = JSON.parse(response.result);
      expect(result.factorial).toBe(720); // 6! = 720
      expect(result.input).toBe(6);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);

  // ── Verify archive handles nested dirs correctly ──

  it('tar archive preserves nested directory structure', async () => {
    const toolDir = join(repoDir, 'tools', 'nested_tool');
    mkdirSync(join(toolDir, 'a', 'b', 'c'), {recursive: true});
    mkdirSync(join(toolDir, 'node_modules', 'should-skip'), {recursive: true});

    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({description: 'Nested'}));
    writeFileSync(join(toolDir, 'handler.ts'), 'placeholder');
    writeFileSync(join(toolDir, 'a', 'one.txt'), 'file-one');
    writeFileSync(join(toolDir, 'a', 'b', 'two.txt'), 'file-two');
    writeFileSync(join(toolDir, 'a', 'b', 'c', 'three.txt'), 'file-three');
    writeFileSync(join(toolDir, 'node_modules', 'should-skip', 'index.js'), 'skipped');

    const sandbox = await daytona.create({language: 'typescript'});

    try {
      // Tar and upload
      const archive = execSync(
        'tar -czf - ' +
        '--exclude=node_modules --exclude=.git ' +
        '-C ' + JSON.stringify(toolDir) + ' .',
        {maxBuffer: 50 * 1024 * 1024},
      );
      await sandbox.fs.uploadFile(Buffer.from(archive), '/tmp/tool.tar.gz');
      await sandbox.process.executeCommand(
        'mkdir -p /home/daytona/tool && tar -xzf /tmp/tool.tar.gz -C /home/daytona/tool',
      );

      // Verify structure
      const lsResult = await sandbox.process.executeCommand(
        'find /home/daytona/tool -type f | sort',
      );
      expect(lsResult.exitCode).toBe(0);

      const files = lsResult.result.trim().split('\n');
      expect(files).toContain('/home/daytona/tool/handler.ts');
      expect(files).toContain('/home/daytona/tool/a/one.txt');
      expect(files).toContain('/home/daytona/tool/a/b/two.txt');
      expect(files).toContain('/home/daytona/tool/a/b/c/three.txt');

      // node_modules should NOT be present
      expect(files.some((f: string) => f.includes('node_modules'))).toBe(false);

      // Verify content survived the round trip
      const catResult = await sandbox.process.executeCommand('cat /home/daytona/tool/a/b/c/three.txt');
      expect(catResult.result.trim()).toBe('file-three');
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 90000);

  // ── Full pipeline: build → execute handler ──

  it('full pipeline: build with setup.sh → execute handler via entry.js', async () => {
    const toolDir = join(repoDir, 'tools', 'pipeline_tool');
    mkdirSync(join(toolDir, 'lib'), {recursive: true});

    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({
      description: 'Full pipeline test',
    }));
    writeFileSync(join(toolDir, 'handler.ts'), 'placeholder');
    writeFileSync(join(toolDir, 'package.json'), JSON.stringify({
      name: 'pipeline-tool',
      private: true,
    }));

    // A library file
    writeFileSync(join(toolDir, 'lib', 'math.js'), `
function weightedSum(items) {
  const weights = { high: 0.9, medium: 0.5, low: 0.1 };
  return items.reduce((sum, item) => sum + item.amount * (weights[item.priority] || 0.5), 0);
}
module.exports = { weightedSum };
`);

    // Entry script (what the runtime would run)
    writeFileSync(join(toolDir, 'entry.js'), `
const fs = require('fs');
const { weightedSum } = require('./lib/math');
const payload = JSON.parse(fs.readFileSync('/tmp/invocation.json', 'utf-8'));
const total = weightedSum(payload.params.deals);
process.stdout.write(JSON.stringify({ result: { weighted_total: total, count: payload.params.deals.length } }) + '\\n');
`);

    // setup.sh — just verifies structure (no deps to install)
    writeFileSync(join(toolDir, 'setup.sh'), `#!/bin/bash
set -e
cd /home/daytona/tool
echo "Verifying structure..."
test -f entry.js || (echo "Missing entry.js" && exit 1)
test -f lib/math.js || (echo "Missing lib/math.js" && exit 1)
echo "Build complete"
`);
    chmodSync(join(toolDir, 'setup.sh'), 0o755);

    // Build
    const sandbox = await buildToolInDaytona(toolDir, 'typescript', true, false, false);

    try {
      // Upload invocation (simulates what SandboxToolExecutor does at runtime)
      const payload = JSON.stringify({
        params: {
          deals: [
            {amount: 100000, priority: 'high'},
            {amount: 50000, priority: 'medium'},
            {amount: 20000, priority: 'low'},
          ],
        },
      });
      await sandbox.fs.uploadFile(Buffer.from(payload, 'utf-8'), '/tmp/invocation.json');

      // Execute (simulates what SandboxToolExecutor does)
      const response = await sandbox.process.executeCommand('node /home/daytona/tool/entry.js');
      expect(response.exitCode).toBe(0);

      const output = JSON.parse(response.result);
      expect(output.result.weighted_total).toBe(117000);
      expect(output.result.count).toBe(3);
    } finally {
      await deleteSandbox(daytona, sandbox);
    }
  }, 120000);
});
