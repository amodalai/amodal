/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {loadRepo, readLockFile, resolveAllPackages} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface ValidateOptions {
  cwd?: string;
  packages?: boolean;
}

interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Validates the amodal project configuration by loading the full repo
 * and running cross-reference checks.
 *
 * Returns the number of errors found (0 = valid).
 */
export async function runValidate(options: ValidateOptions = {}): Promise<number> {
  const issues: ValidationIssue[] = [];

  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[validate] ${msg}\n`);
    return 1;
  }

  process.stderr.write(`[validate] Loading repo from ${repoPath}\n`);

  try {
    const repo = await loadRepo({localPath: repoPath});

    // Check: at least one connection
    if (repo.connections.size === 0) {
      issues.push({level: 'warning', message: 'No connections defined. The agent cannot access external systems.'});
    }

    // Check: surface endpoints reference valid access config
    for (const [name, conn] of repo.connections) {
      if (conn.surface.length === 0) {
        issues.push({level: 'warning', message: `Connection "${name}" has no surface endpoints.`});
      }
    }

    // Check: skills have non-empty bodies
    for (const skill of repo.skills) {
      if (!skill.body.trim()) {
        issues.push({level: 'error', message: `Skill "${skill.name}" has an empty body.`});
      }
    }

    // Check: automations have schedules
    for (const auto of repo.automations) {
      if (!auto.schedule) {
        issues.push({level: 'warning', message: `Automation "${auto.name}" has no schedule. It will only run via webhook.`});
      }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push({level: 'error', message: `Failed to load repo: ${msg}`});
  }

  // Package-aware validation
  if (options.packages) {
    try {
      const lockFile = await readLockFile(repoPath);
      if (lockFile) {
        const resolved = await resolveAllPackages({repoPath, lockFile});

        // Report warnings from resolution (missing packages, broken symlinks)
        for (const warning of resolved.warnings) {
          issues.push({level: 'warning', message: warning});
        }

        // Check for empty resolved connections
        for (const [name, conn] of resolved.connections) {
          if (conn.surface.length === 0) {
            issues.push({level: 'warning', message: `Resolved connection "${name}" has no surface endpoints.`});
          }
        }

        // Check for empty resolved skills
        for (const skill of resolved.skills) {
          if (!skill.body.trim()) {
            issues.push({level: 'error', message: `Resolved skill "${skill.name}" has an empty body.`});
          }
        }
      } else {
        process.stderr.write('[validate] No lock file found, skipping package validation.\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({level: 'error', message: `Package resolution failed: ${msg}`});
    }
  }

  // Print results
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  for (const issue of errors) {
    process.stderr.write(`  ERROR: ${issue.message}\n`);
  }
  for (const issue of warnings) {
    process.stderr.write(`  WARN:  ${issue.message}\n`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    process.stderr.write('[validate] All checks passed.\n');
  } else {
    process.stderr.write(`[validate] ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  }

  return errors.length;
}

export const validateCommand: CommandModule = {
  command: 'validate',
  describe: 'Validate the project configuration',
  builder: (yargs) =>
    yargs.option('packages', {type: 'boolean', default: false, describe: 'Include package resolution validation'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runValidate({packages: argv['packages'] as boolean});
    process.exit(code);
  },
};
