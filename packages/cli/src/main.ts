#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFileSync} from 'node:fs';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';

// Suppress OpenTelemetry DiagAPI logger warnings from @google/gemini-cli-core.
// gemini-cli-core calls setLogger() which triggers a noisy "Current logger will
// be overwritten" stack trace on every startup. Not actionable on our side.
const origError = console.error; // eslint-disable-line no-console
console.error = (...args: unknown[]) => { // eslint-disable-line no-console
  if (typeof args[0] === 'string' && args[0].includes('Current logger will')) return;
  origError.apply(console, args);
};

import {amodalCommands} from './commands/index.js';
import {loadEnvFile} from './shared/load-env.js';

// Load .env from current directory before anything else
loadEnvFile(process.cwd());

const raw: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
if (typeof raw !== 'object' || raw === null || !('version' in raw) || typeof raw.version !== 'string') {
  throw new Error('Failed to read version from package.json');
}
const pkgVersion = raw.version;

const cli = yargs(hideBin(process.argv))
  .scriptName('amodal')
  .usage('$0 <command> [options]');

for (const cmd of amodalCommands) {
  cli.command(cmd);
}

cli
  .demandCommand(1, 'Run amodal <command> --help for usage')
  .strict()
  .help()
  .alias('h', 'help')
  .version(process.env['CLI_VERSION'] ?? pkgVersion)
  .alias('v', 'version');

void cli.parse();
