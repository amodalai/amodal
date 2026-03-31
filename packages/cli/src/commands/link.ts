/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {writeFile, readFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import * as path from 'node:path';

import type {CommandModule} from 'yargs';
import prompts from 'prompts';

import {readRcFile} from './login.js';
import {findRepoRoot} from '../shared/repo-discovery.js';

const PROJECT_DIR = '.amodal';
const PROJECT_FILE = 'project.json';

export interface ProjectLink {
  orgId: string;
  orgName: string;
  appId: string;
  appName: string;
  platformUrl: string;
  buildServerUrl?: string;
}

export interface LinkOptions {
  cwd?: string;
  yes?: boolean;
  orgId?: string;
  appId?: string;
}

/**
 * Read the project link from .amodal/project.json.
 * Returns null if not linked.
 */
export async function readProjectLink(cwd?: string): Promise<ProjectLink | null> {
  let repoRoot: string;
  try {
    repoRoot = findRepoRoot(cwd);
  } catch {
    return null;
  }
  const linkPath = path.join(repoRoot, PROJECT_DIR, PROJECT_FILE);
  try {
    const content = await readFile(linkPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(content) as ProjectLink;
  } catch {
    return null;
  }
}

/**
 * Write the project link to .amodal/project.json and ensure .amodal/ is gitignored.
 */
async function writeProjectLink(repoRoot: string, link: ProjectLink): Promise<void> {
  const dir = path.join(repoRoot, PROJECT_DIR);
  await mkdir(dir, {recursive: true});
  const linkPath = path.join(dir, PROJECT_FILE);
  await writeFile(linkPath, JSON.stringify(link, null, 2) + '\n');

  // Ensure .amodal/ is in .gitignore
  const gitignorePath = path.join(repoRoot, '.gitignore');
  try {
    const gitignore = existsSync(gitignorePath)
      ? await readFile(gitignorePath, 'utf-8')
      : '';
    if (!gitignore.includes('.amodal')) {
      const newline = gitignore.endsWith('\n') || gitignore === '' ? '' : '\n';
      await writeFile(gitignorePath, `${gitignore}${newline}.amodal/\n`);
    }
  } catch {
    // non-fatal
  }
}

interface MeResponse {
  user: {email?: string; name?: string} | null;
  org: {id: string; name: string} | null;
  orgs: Array<{id: string; name: string}>;
  app: {id: string; name: string} | null;
  apps: Array<{id: string; name: string}>;
}

/**
 * Link the current project to a platform org and app.
 * Saves to .amodal/project.json (gitignored, local machine state).
 * Returns 0 on success, 1 on error.
 */
export async function runLink(options: LinkOptions = {}): Promise<number> {
  // Find repo root
  let repoRoot: string;
  try {
    repoRoot = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[link] ${msg}\n`);
    return 1;
  }

  // Check if already linked
  const existing = await readProjectLink(repoRoot);
  if (existing && !options.yes) {
    process.stderr.write(
      `[link] Already linked to ${existing.orgName} / ${existing.appName}\n`,
    );
    const {confirm} = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Overwrite existing link?',
      initial: false,
    });
    if (!confirm) {
      process.stderr.write('[link] Cancelled.\n');
      return 0;
    }
  }

  // Read auth token
  const rc = await readRcFile();
  if (!rc.platform?.token) {
    process.stderr.write('[link] Not logged in. Run `amodal login` first.\n');
    return 1;
  }
  const platformUrl = rc.platform.url;
  const token = rc.platform.token;

  // Fetch user info
  process.stderr.write('[link] Fetching account info...\n');
  const meResponse = await fetch(`${platformUrl}/api/me`, {
    headers: {Authorization: `Bearer ${token}`},
  });

  if (!meResponse.ok) {
    if (meResponse.status === 401) {
      process.stderr.write('[link] Session expired. Run `amodal login` again.\n');
    } else {
      process.stderr.write(`[link] Failed to fetch account info (HTTP ${meResponse.status})\n`);
    }
    return 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const me = (await meResponse.json()) as MeResponse;

  if (!me.orgs.length) {
    process.stderr.write('[link] No organizations found. Create one in the admin UI first.\n');
    return 1;
  }

  // Select org
  let selectedOrg: {id: string; name: string};
  if (options.orgId) {
    const found = me.orgs.find((o) => o.id === options.orgId);
    if (!found) {
      process.stderr.write(`[link] Organization "${options.orgId}" not found.\n`);
      return 1;
    }
    selectedOrg = found;
  } else if (me.orgs.length === 1) {
    selectedOrg = me.orgs[0]!;
  } else {
    const {orgIndex} = await prompts({
      type: 'select',
      name: 'orgIndex',
      message: 'Select organization',
      choices: me.orgs.map((o, i) => ({title: o.name, value: i})),
    });
    if (orgIndex === undefined) {
      process.stderr.write('[link] Cancelled.\n');
      return 1;
    }
    selectedOrg = me.orgs[orgIndex]!;
  }

  // Fetch apps for selected org
  let apps = me.apps;
  if (selectedOrg.id !== me.org?.id) {
    const appsResponse = await fetch(`${platformUrl}/api/orgs/${selectedOrg.id}/applications`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    if (appsResponse.ok) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      apps = (await appsResponse.json()) as Array<{id: string; name: string}>;
    }
  }

  if (!apps.length) {
    process.stderr.write('[link] No apps found in this organization. Create one in the admin UI first.\n');
    return 1;
  }

  // Select app
  let selectedApp: {id: string; name: string};
  if (options.appId) {
    const found = apps.find((a) => a.id === options.appId);
    if (!found) {
      process.stderr.write(`[link] App "${options.appId}" not found.\n`);
      return 1;
    }
    selectedApp = found;
  } else if (apps.length === 1) {
    selectedApp = apps[0]!;
  } else {
    const {appIndex} = await prompts({
      type: 'select',
      name: 'appIndex',
      message: 'Select app',
      choices: apps.map((a, i) => ({title: a.name, value: i})),
    });
    if (appIndex === undefined) {
      process.stderr.write('[link] Cancelled.\n');
      return 1;
    }
    selectedApp = apps[appIndex]!;
  }

  // Save the link
  const link: ProjectLink = {
    orgId: selectedOrg.id,
    orgName: selectedOrg.name,
    appId: selectedApp.id,
    appName: selectedApp.name,
    platformUrl,
  };

  await writeProjectLink(repoRoot, link);

  process.stderr.write(
    `[link] Linked to ${selectedOrg.name} / ${selectedApp.name}\n`,
  );
  process.stderr.write(`[link] Settings saved to ${PROJECT_DIR}/${PROJECT_FILE}\n`);
  return 0;
}

export const linkCommand: CommandModule = {
  command: 'link',
  describe: 'Link this project to an amodal org and app',
  builder: (yargs) =>
    yargs
      .option('yes', {
        type: 'boolean',
        alias: 'y',
        describe: 'Skip confirmation prompts',
      })
      .option('org-id', {
        type: 'string',
        describe: 'Organization ID (skip prompt)',
      })
      .option('app-id', {
        type: 'string',
        describe: 'App ID (skip prompt)',
      }),
  handler: async (argv) => {
    const code = await runLink({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      yes: argv['yes'] as boolean | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      orgId: argv['orgId'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      appId: argv['appId'] as string | undefined,
    });
    process.exit(code);
  },
};
