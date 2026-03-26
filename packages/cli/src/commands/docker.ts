/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execSync} from 'node:child_process';
import type {CommandModule} from 'yargs';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {generateDockerfile} from '../templates/dockerfile-template.js';
import {generateCompose} from '../templates/compose-template.js';
import {extractEnvVars} from '../templates/env-template.js';

export interface DockerOptions {
  cwd?: string;
  subcommand: 'init' | 'check' | 'build';
  tag?: string;
}

/**
 * Docker tooling for self-hosted runtime containerization.
 *
 * - `init`: Generate Dockerfile, docker-compose.yml, .env.production
 * - `check`: Validate repo + env vars + Docker availability
 * - `build`: Run `docker build` and tag the image
 */
export async function runDocker(options: DockerOptions): Promise<void> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[docker] ${msg}\n`);
    process.exit(1);
  }

  switch (options.subcommand) {
    case 'init':
      await dockerInit(repoPath);
      break;
    case 'check':
      await dockerCheck(repoPath);
      break;
    case 'build':
      await dockerBuild(repoPath, options.tag);
      break;
    default:
      process.stderr.write(`[docker] Unknown subcommand: ${options.subcommand}\n`);
      process.exit(1);
  }
}

async function dockerInit(repoPath: string): Promise<void> {
  const configPath = join(repoPath, 'amodal.json');
  if (!existsSync(configPath)) {
    process.stderr.write('[docker] No amodal.json found. Run `amodal init` first.\n');
    process.exit(1);
  }

  const configStr = readFileSync(configPath, 'utf-8');
  let config: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing config JSON
    config = JSON.parse(configStr) as Record<string, unknown>;
  } catch {
    process.stderr.write('[docker] Failed to parse amodal.json.\n');
    process.exit(1);
  }

  // Generate Dockerfile
  const dockerfilePath = join(repoPath, 'Dockerfile');
  if (existsSync(dockerfilePath)) {
    process.stderr.write('[docker] Dockerfile already exists, skipping.\n');
  } else {
    writeFileSync(dockerfilePath, generateDockerfile());
    process.stderr.write('[docker] Generated Dockerfile\n');
  }

  // Generate docker-compose.yml
  const composePath = join(repoPath, 'docker-compose.yml');
  if (existsSync(composePath)) {
    process.stderr.write('[docker] docker-compose.yml already exists, skipping.\n');
  } else {
    const name = typeof config['name'] === 'string' ? config['name'] : 'amodal-agent';
    writeFileSync(composePath, generateCompose(name));
    process.stderr.write('[docker] Generated docker-compose.yml\n');
  }

  // Generate .env.production
  const envPath = join(repoPath, '.env.production');
  if (existsSync(envPath)) {
    process.stderr.write('[docker] .env.production already exists, skipping.\n');
  } else {
    const envVars = extractEnvVars(configStr);

    // Also check spec.json files
    const specPath = join(repoPath, 'connections');
    if (existsSync(specPath)) {
      try {
        const {readdirSync} = await import('node:fs');
        const dirs = readdirSync(specPath);
        for (const dir of dirs) {
          const specFile = join(specPath, dir, 'spec.json');
          if (existsSync(specFile)) {
            const specStr = readFileSync(specFile, 'utf-8');
            const specVars = extractEnvVars(specStr);
            for (const v of specVars) {
              if (!envVars.includes(v)) {
                envVars.push(v);
              }
            }
          }
        }
      } catch {
        // Ignore scan errors
      }
    }

    const envContent = envVars.map((v) => `${v}=`).join('\n') + '\n';
    writeFileSync(envPath, envContent);
    process.stderr.write(`[docker] Generated .env.production with ${envVars.length} variables\n`);
  }

  process.stderr.write('[docker] Init complete. Review generated files before deploying.\n');
}

async function dockerCheck(repoPath: string): Promise<void> {
  let hasErrors = false;

  // Check config exists
  const configPath = join(repoPath, 'amodal.json');
  if (!existsSync(configPath)) {
    process.stderr.write('[docker] ✗ Missing amodal.json\n');
    hasErrors = true;
  } else {
    process.stderr.write('[docker] ✓ amodal.json found\n');
  }

  // Check Dockerfile
  if (!existsSync(join(repoPath, 'Dockerfile'))) {
    process.stderr.write('[docker] ✗ Missing Dockerfile (run `amodal docker init`)\n');
    hasErrors = true;
  } else {
    process.stderr.write('[docker] ✓ Dockerfile found\n');
  }

  // Check Docker
  try {
    execSync('docker --version', {stdio: 'pipe'});
    process.stderr.write('[docker] ✓ Docker available\n');
  } catch {
    process.stderr.write('[docker] ✗ Docker not found. Install Docker to build images.\n');
    hasErrors = true;
  }

  // Check env vars
  const configStr = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
  const envVars = extractEnvVars(configStr);
  const missing = envVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    process.stderr.write(`[docker] ⚠ ${missing.length} env vars not set: ${missing.join(', ')}\n`);
  } else if (envVars.length > 0) {
    process.stderr.write(`[docker] ✓ All ${envVars.length} env vars set\n`);
  }

  if (hasErrors) {
    process.stderr.write('[docker] Check failed.\n');
    process.exit(1);
  } else {
    process.stderr.write('[docker] All checks passed.\n');
  }
}

async function dockerBuild(repoPath: string, tag?: string): Promise<void> {
  const configPath = join(repoPath, 'amodal.json');
  if (!existsSync(configPath)) {
    process.stderr.write('[docker] No amodal.json found.\n');
    process.exit(1);
  }

  let imageName: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing config JSON
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    imageName = typeof config['name'] === 'string' ? config['name'] : 'amodal-agent';
  } catch {
    imageName = 'amodal-agent';
  }

  const imageTag = tag ?? 'latest';
  const fullTag = `${imageName}:${imageTag}`;

  process.stderr.write(`[docker] Building ${fullTag}...\n`);

  try {
    execSync(`docker build -t ${fullTag} .`, {
      cwd: repoPath,
      stdio: 'inherit',
    });
    process.stderr.write(`[docker] Built ${fullTag}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[docker] Build failed: ${msg}\n`);
    process.exit(1);
  }
}

export const dockerCommand: CommandModule = {
  command: 'docker <subcommand>',
  describe: 'Docker tooling for self-hosted deployment',
  builder: (yargs) =>
    yargs
      .positional('subcommand', {
        type: 'string',
        demandOption: true,
        choices: ['init', 'check', 'build'] as const,
      })
      .option('tag', {
        type: 'string',
        describe: 'Image tag for build',
      }),
  handler: async (argv) => {
    await runDocker({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      subcommand: argv['subcommand'] as 'init' | 'check' | 'build',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      tag: argv['tag'] as string | undefined,
    });
  },
};
