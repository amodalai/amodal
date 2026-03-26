/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {loadRepo, setupSession, readLockFile, resolveAllPackages} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface InspectOptions {
  cwd?: string;
  context?: boolean;
  explore?: boolean;
  tools?: boolean;
  connections?: boolean;
  resolved?: boolean;
  scope?: string;
}

/**
 * Loads the repo, runs setupSession(), and prints the compiled
 * prompt with section headers and token counts.
 */
export async function runInspect(options: InspectOptions = {}): Promise<void> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[inspect] ${msg}\n`);
    return;
  }

  process.stderr.write(`[inspect] Loading repo from ${repoPath}\n`);

  const repo = await loadRepo({localPath: repoPath});
  const runtime = setupSession({repo});

  const showAll = !options.context && !options.explore && !options.tools && !options.connections && !options.resolved;

  if (showAll || options.context) {
    process.stdout.write('\n=== Compiled Context ===\n');
    process.stdout.write(`Total tokens: ${runtime.compiledContext.tokenUsage.used}/${runtime.compiledContext.tokenUsage.total}\n`);
    process.stdout.write(`Remaining: ${runtime.compiledContext.tokenUsage.remaining}\n\n`);

    for (const section of runtime.compiledContext.sections) {
      const trimLabel = section.trimmed ? ' [TRIMMED]' : '';
      process.stdout.write(`--- ${section.name} (${section.tokens} tokens, priority ${section.priority})${trimLabel} ---\n`);
      if (options.context) {
        process.stdout.write(section.content + '\n\n');
      }
    }
  }

  if (showAll || options.explore) {
    process.stdout.write('\n=== Explore Context ===\n');
    process.stdout.write(`Total tokens: ${runtime.exploreContext.tokenUsage.used}/${runtime.exploreContext.tokenUsage.total}\n\n`);

    for (const section of runtime.exploreContext.sections) {
      process.stdout.write(`--- ${section.name} (${section.tokens} tokens) ---\n`);
    }
  }

  if (showAll || options.connections) {
    process.stdout.write('\n=== Connections ===\n');
    for (const [name, conn] of repo.connections) {
      process.stdout.write(`  ${name}: ${conn.surface.length} endpoints, auth=${conn.spec.auth?.type ?? 'none'}\n`);
    }
  }

  if (showAll || options.tools) {
    process.stdout.write('\n=== Available Tools ===\n');
    process.stdout.write('  request (HTTP to connected systems)\n');
    process.stdout.write('  explore (delegate to sub-agent)\n');
    process.stdout.write('  enter_plan_mode / exit_plan_mode\n');
  }

  if (options.resolved) {
    process.stdout.write('\n=== Resolved Packages ===\n');

    const lockFile = await readLockFile(repoPath);
    if (!lockFile) {
      process.stdout.write('  No lock file found.\n');
    } else {
      const resolved = await resolveAllPackages({repoPath, lockFile});

      // Filter by scope if given
      const scopeParts = options.scope?.split('/');
      const scopeType = scopeParts?.[0];
      const scopeName = scopeParts?.[1];

      if (!scopeType || scopeType === 'connections') {
        for (const [name, conn] of resolved.connections) {
          if (scopeName && name !== scopeName) continue;
          process.stdout.write(`\n  Connection: ${name}\n`);
          process.stdout.write(`    Endpoints: ${conn.surface.length}\n`);
          process.stdout.write(`    Auth: ${conn.spec.auth?.type ?? 'none'}\n`);
        }
      }

      if (!scopeType || scopeType === 'skills') {
        for (const skill of resolved.skills) {
          if (scopeName && skill.name !== scopeName) continue;
          process.stdout.write(`\n  Skill: ${skill.name}\n`);
          process.stdout.write(`    Body: ${skill.body.length} chars\n`);
        }
      }

      if (!scopeType || scopeType === 'automations') {
        for (const auto of resolved.automations) {
          if (scopeName && auto.name !== scopeName) continue;
          process.stdout.write(`\n  Automation: ${auto.name}\n`);
        }
      }

      // Print warnings
      if (resolved.warnings.length > 0) {
        process.stdout.write('\n  Warnings:\n');
        for (const warning of resolved.warnings) {
          process.stdout.write(`    - ${warning}\n`);
        }
      }
    }
  }

  process.stdout.write('\n');
}

export const inspectCommand: CommandModule = {
  command: 'inspect',
  describe: 'Inspect compiled prompt and runtime context',
  builder: (yargs) =>
    yargs
      .option('context', {type: 'boolean', default: false, describe: 'Show full context content'})
      .option('explore', {type: 'boolean', default: false, describe: 'Show explore context'})
      .option('tools', {type: 'boolean', default: false, describe: 'Show available tools'})
      .option('connections', {type: 'boolean', default: false, describe: 'Show connections'})
      .option('resolved', {type: 'boolean', default: false, describe: 'Show resolved packages'})
      .option('scope', {type: 'string', describe: 'Filter resolved by scope (e.g. connections/name)'}),
  handler: async (argv) => {
    await runInspect({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      context: argv['context'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      explore: argv['explore'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      tools: argv['tools'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      connections: argv['connections'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      resolved: argv['resolved'] as boolean,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      scope: argv['scope'] as string | undefined,
    });
  },
};
