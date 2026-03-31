/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for the `amodal` CLI commands.
 *
 * Strategy: register each command's CommandModule in yargs, replace
 * the handler with a capture function, parse real argv arrays, and
 * verify the parsed args. This validates the full yargs pipeline:
 * builder options -> positionals -> defaults -> type coercion.
 */

import {describe, it, expect} from 'vitest';
import yargs from 'yargs/yargs';
import type {ArgumentsCamelCase, CommandModule} from 'yargs';

import {connectCommand} from './commands/connect.js';
import {installPkgCommand} from './commands/install-pkg.js';
import {uninstallCommand} from './commands/uninstall.js';
import {listCommand} from './commands/list.js';
import {updateCommand} from './commands/update.js';
import {diffCommand} from './commands/diff.js';
import {searchCommand} from './commands/search.js';
import {publishCommand} from './commands/publish.js';
import {loginCommand} from './commands/login.js';
import {linkCommand} from './commands/link.js';
import {secretsCommand} from './commands/secrets.js';
import {validateCommand} from './commands/validate.js';
import {syncCommand} from './commands/sync.js';
import {initCommand} from './commands/init.js';
import {devCommand} from './commands/dev.js';
import {inspectCommand} from './commands/inspect.js';
import {deployCommand} from './commands/deploy.js';
import {buildCommand} from './commands/build.js';
import {dockerCommand} from './commands/docker.js';
import {rollbackCommand} from './commands/rollback.js';
import {deploymentsCommand} from './commands/deployments.js';
import {promoteCommand} from './commands/promote.js';
import {serveCommand} from './commands/serve.js';
import {statusCommand} from './commands/status.js';
import {auditCommand} from './commands/audit.js';
import {evalCommand} from './commands/eval.js';
import {experimentCommand} from './commands/experiment.js';
import {testQueryCommand} from './commands/test-query.js';
import {amodalCommands} from './commands/index.js';

/**
 * Parse argv through yargs with a command module, capturing the parsed args
 * instead of executing the real handler.
 */
async function parseArgs(cmd: CommandModule, argv: string[]): Promise<ArgumentsCamelCase> {
  let captured: ArgumentsCamelCase | undefined;

  // Replace handler with a capture function
  const testCmd: CommandModule = {
    ...cmd,
    handler: (args: ArgumentsCamelCase) => {
      captured = args;
    },
  };

  const parser = yargs(argv)
    .command(testCmd)
    .fail((msg, err) => {
      if (err) throw err;
      throw new Error(msg);
    })
    .exitProcess(false)
    .strict(false);

  await parser.parse();

  if (!captured) {
    throw new Error(`Handler not invoked for argv: ${argv.join(' ')}`);
  }
  return captured;
}

describe('amodal CLI e2e', () => {
  // --- Registration ---

  describe('command registration', () => {
    it('exports all 31 commands', () => {
      expect(amodalCommands).toHaveLength(31);
    });

    it('all commands have valid structure', () => {
      for (const cmd of amodalCommands) {
        expect(cmd.command).toBeDefined();
        expect(typeof cmd.handler).toBe('function');
      }
    });
  });

  // --- connect ---

  describe('connect', () => {
    it('parses name positional', async () => {
      const args = await parseArgs(connectCommand, ['connect', 'stripe']);
      expect(args['name']).toBe('stripe');
      expect(args['force']).toBe(false);
    });

    it('parses --force flag', async () => {
      const args = await parseArgs(connectCommand, ['connect', 'stripe', '--force']);
      expect(args['name']).toBe('stripe');
      expect(args['force']).toBe(true);
    });
  });

  // --- install ---

  describe('install', () => {
    it('bare install has empty packages array', async () => {
      const args = await parseArgs(installPkgCommand, ['install']);
      expect(args['packages']).toEqual([]);
    });

    it('variadic positional captures package names', async () => {
      const args = await parseArgs(installPkgCommand, ['install', 'alert-enrichment', 'soc-agent']);
      expect(args['packages']).toEqual(['alert-enrichment', 'soc-agent']);
    });
  });

  // --- uninstall ---

  describe('uninstall', () => {
    it('parses name positional', async () => {
      const args = await parseArgs(uninstallCommand, ['uninstall', 'connection-stripe']);
      expect(args['name']).toBe('connection-stripe');
    });
  });

  // --- list ---

  describe('list', () => {
    it('defaults to json=false', async () => {
      const args = await parseArgs(listCommand, ['list']);
      expect(args['json']).toBe(false);
      expect(args['filter']).toBeUndefined();
    });

    it('parses --filter and --json', async () => {
      const args = await parseArgs(listCommand, ['list', '--filter', 'skill', '--json']);
      expect(args['filter']).toBe('skill');
      expect(args['json']).toBe(true);
    });
  });

  // --- update ---

  describe('update', () => {
    it('optional positional defaults to undefined', async () => {
      const args = await parseArgs(updateCommand, ['update']);
      expect(args['name']).toBeUndefined();
      expect(args['latest']).toBe(false);
      expect(args['dryRun']).toBe(false);
    });

    it('parses name', async () => {
      const args = await parseArgs(updateCommand, ['update', 'stripe']);
      expect(args['name']).toBe('stripe');
    });

    it('parses --latest and --dry-run', async () => {
      const args = await parseArgs(updateCommand, ['update', '--latest', '--dry-run']);
      expect(args['latest']).toBe(true);
      expect(args['dryRun']).toBe(true);
    });
  });

  // --- diff ---

  describe('diff', () => {
    it('parses name', async () => {
      const args = await parseArgs(diffCommand, ['diff', 'triage']);
      expect(args['name']).toBe('triage');
    });
  });

  // --- search ---

  describe('search', () => {
    it('optional query defaults to undefined', async () => {
      const args = await parseArgs(searchCommand, ['search']);
      expect(args['query']).toBeUndefined();
      expect(args['json']).toBe(false);
    });

    it('parses query and --type', async () => {
      const args = await parseArgs(searchCommand, ['search', 'stripe', '--type', 'connection']);
      expect(args['query']).toBe('stripe');
      expect(args['type']).toBe('connection');
    });

    it('parses --json', async () => {
      const args = await parseArgs(searchCommand, ['search', '--json']);
      expect(args['json']).toBe(true);
    });
  });

  // --- publish ---

  describe('publish', () => {
    it('defaults', async () => {
      const args = await parseArgs(publishCommand, ['publish']);
      expect(args['dryRun']).toBe(false);
      expect(args['registry']).toBeUndefined();
    });

    it('parses --dry-run and --registry', async () => {
      const args = await parseArgs(publishCommand, ['publish', '--dry-run', '--registry', 'https://my-registry.dev']);
      expect(args['dryRun']).toBe(true);
      expect(args['registry']).toBe('https://my-registry.dev');
    });
  });

  // --- login ---

  describe('login', () => {
    it('defaults', async () => {
      const args = await parseArgs(loginCommand, ['login']);
      expect(args['platformUrl']).toBeUndefined();
      expect(args['adminUrl']).toBeUndefined();
    });

    it('parses --platform-url', async () => {
      const args = await parseArgs(loginCommand, ['login', '--platform-url', 'https://custom.dev']);
      expect(args['platformUrl']).toBe('https://custom.dev');
    });

    it('parses --admin-url', async () => {
      const args = await parseArgs(loginCommand, ['login', '--admin-url', 'https://app.custom.dev']);
      expect(args['adminUrl']).toBe('https://app.custom.dev');
    });
  });

  // --- link ---

  describe('link', () => {
    it('defaults', async () => {
      const args = await parseArgs(linkCommand, ['link']);
      expect(args['yes']).toBeUndefined();
      expect(args['orgId']).toBeUndefined();
      expect(args['appId']).toBeUndefined();
    });

    it('parses --yes', async () => {
      const args = await parseArgs(linkCommand, ['link', '--yes']);
      expect(args['yes']).toBe(true);
    });

    it('parses --org-id and --app-id', async () => {
      const args = await parseArgs(linkCommand, ['link', '--org-id', 'org-123', '--app-id', 'app-456']);
      expect(args['orgId']).toBe('org-123');
      expect(args['appId']).toBe('app-456');
    });
  });

  // --- secrets ---

  describe('secrets', () => {
    it('parses set with key and value', async () => {
      const args = await parseArgs(secretsCommand, ['secrets', 'set', 'API_KEY', 'secret123']);
      expect(args['subcommand']).toBe('set');
      expect(args['key']).toBe('API_KEY');
      expect(args['value']).toBe('secret123');
    });

    it('parses list', async () => {
      const args = await parseArgs(secretsCommand, ['secrets', 'list']);
      expect(args['subcommand']).toBe('list');
      expect(args['json']).toBe(false);
    });

    it('parses list --json', async () => {
      const args = await parseArgs(secretsCommand, ['secrets', 'list', '--json']);
      expect(args['subcommand']).toBe('list');
      expect(args['json']).toBe(true);
    });

    it('parses delete with key', async () => {
      const args = await parseArgs(secretsCommand, ['secrets', 'delete', 'OLD_KEY']);
      expect(args['subcommand']).toBe('delete');
      expect(args['key']).toBe('OLD_KEY');
    });
  });

  // --- validate ---

  describe('validate', () => {
    it('defaults to packages=false', async () => {
      const args = await parseArgs(validateCommand, ['validate']);
      expect(args['packages']).toBe(false);
    });

    it('parses --packages', async () => {
      const args = await parseArgs(validateCommand, ['validate', '--packages']);
      expect(args['packages']).toBe(true);
    });
  });

  // --- sync ---

  describe('sync', () => {
    it('defaults', async () => {
      const args = await parseArgs(syncCommand, ['sync']);
      expect(args['check']).toBe(false);
      expect(args['connection']).toBeUndefined();
    });

    it('parses --check and --connection', async () => {
      const args = await parseArgs(syncCommand, ['sync', '--check', '--connection', 'stripe']);
      expect(args['check']).toBe(true);
      expect(args['connection']).toBe('stripe');
    });
  });

  // --- init ---

  describe('init', () => {
    it('defaults', async () => {
      const args = await parseArgs(initCommand, ['init']);
      expect(args['name']).toBeUndefined();
    });

    it('parses --name', async () => {
      const args = await parseArgs(initCommand, ['init', '--name', 'my-project']);
      expect(args['name']).toBe('my-project');
    });

    it('parses --provider', async () => {
      const args = await parseArgs(initCommand, ['init', '--provider', 'anthropic']);
      expect(args['provider']).toBe('anthropic');
    });
  });

  // --- dev ---

  describe('dev', () => {
    it('defaults', async () => {
      const args = await parseArgs(devCommand, ['dev']);
      expect(args['port']).toBeUndefined();
      expect(args['host']).toBeUndefined();
    });

    it('parses --port and --host', async () => {
      const args = await parseArgs(devCommand, ['dev', '--port', '4000', '--host', '0.0.0.0']);
      expect(args['port']).toBe(4000);
      expect(args['host']).toBe('0.0.0.0');
    });
  });

  // --- inspect ---

  describe('inspect', () => {
    it('all flags default to false', async () => {
      const args = await parseArgs(inspectCommand, ['inspect']);
      expect(args['context']).toBe(false);
      expect(args['explore']).toBe(false);
      expect(args['tools']).toBe(false);
      expect(args['connections']).toBe(false);
      expect(args['resolved']).toBe(false);
      expect(args['scope']).toBeUndefined();
    });

    it('parses section flags and --scope', async () => {
      const args = await parseArgs(inspectCommand, ['inspect', '--context', '--resolved', '--scope', 'connections/stripe']);
      expect(args['context']).toBe(true);
      expect(args['resolved']).toBe(true);
      expect(args['scope']).toBe('connections/stripe');
    });
  });

  // --- deploy ---

  describe('deploy', () => {
    it('parses --message flag', async () => {
      const args = await parseArgs(deployCommand, ['deploy', '--message', 'v1.0 release']);
      expect(args['message']).toBe('v1.0 release');
    });

    it('parses -m alias', async () => {
      const args = await parseArgs(deployCommand, ['deploy', '-m', 'hotfix']);
      expect(args['message']).toBe('hotfix');
    });

    it('parses --env flag', async () => {
      const args = await parseArgs(deployCommand, ['deploy', '--env', 'staging']);
      expect(args['env']).toBe('staging');
    });

    it('parses --dry-run flag', async () => {
      const args = await parseArgs(deployCommand, ['deploy', '--dry-run']);
      expect(args['dryRun']).toBe(true);
    });

    it('defaults dry-run to false', async () => {
      const args = await parseArgs(deployCommand, ['deploy']);
      expect(args['dryRun']).toBe(false);
    });
  });

  // --- build ---

  describe('build', () => {
    it('parses --output flag', async () => {
      const args = await parseArgs(buildCommand, ['build', '--output', '/tmp/out.json']);
      expect(args['output']).toBe('/tmp/out.json');
    });

    it('parses -o alias', async () => {
      const args = await parseArgs(buildCommand, ['build', '-o', '/tmp/out.json']);
      expect(args['output']).toBe('/tmp/out.json');
    });
  });

  // --- docker ---

  describe('docker', () => {
    it('parses subcommand', async () => {
      const args = await parseArgs(dockerCommand, ['docker', 'check']);
      expect(args['subcommand']).toBe('check');
    });

    it('parses --tag with build', async () => {
      const args = await parseArgs(dockerCommand, ['docker', 'build', '--tag', 'v1.2.3']);
      expect(args['subcommand']).toBe('build');
      expect(args['tag']).toBe('v1.2.3');
    });

    it('accepts all valid subcommands', async () => {
      for (const sub of ['init', 'check', 'build']) {
        const args = await parseArgs(dockerCommand, ['docker', sub]);
        expect(args['subcommand']).toBe(sub);
      }
    });
  });

  // --- rollback ---

  describe('rollback', () => {
    it('parses deploy-id positional', async () => {
      const args = await parseArgs(rollbackCommand, ['rollback', 'deploy-abc1234']);
      expect(args['deployId']).toBe('deploy-abc1234');
    });

    it('parses --env flag', async () => {
      const args = await parseArgs(rollbackCommand, ['rollback', '--env', 'staging']);
      expect(args['env']).toBe('staging');
    });
  });

  // --- deployments ---

  describe('deployments', () => {
    it('parses --limit flag', async () => {
      const args = await parseArgs(deploymentsCommand, ['deployments', '--limit', '5']);
      expect(args['limit']).toBe(5);
    });

    it('parses --json flag', async () => {
      const args = await parseArgs(deploymentsCommand, ['deployments', '--json']);
      expect(args['json']).toBe(true);
    });

    it('defaults limit to 10', async () => {
      const args = await parseArgs(deploymentsCommand, ['deployments']);
      expect(args['limit']).toBe(10);
    });
  });

  // --- promote ---

  describe('promote', () => {
    it('parses from-env positional', async () => {
      const args = await parseArgs(promoteCommand, ['promote', 'staging']);
      expect(args['fromEnv']).toBe('staging');
    });

    it('parses --to flag', async () => {
      const args = await parseArgs(promoteCommand, ['promote', 'staging', '--to', 'production']);
      expect(args['to']).toBe('production');
    });
  });

  // --- serve ---

  describe('serve', () => {
    it('parses --config flag', async () => {
      const args = await parseArgs(serveCommand, ['serve', '--config', '/tmp/snapshot.json']);
      expect(args['config']).toBe('/tmp/snapshot.json');
    });

    it('parses --platform flag', async () => {
      const args = await parseArgs(serveCommand, ['serve', '--platform']);
      expect(args['platform']).toBe(true);
    });
  });

  // --- status ---

  describe('status', () => {
    it('parses --env flag', async () => {
      const args = await parseArgs(statusCommand, ['status', '--env', 'staging']);
      expect(args['env']).toBe('staging');
    });

    it('parses --json flag', async () => {
      const args = await parseArgs(statusCommand, ['status', '--json']);
      expect(args['json']).toBe(true);
    });
  });

  // --- audit ---

  describe('audit', () => {
    it('parses session-id positional', async () => {
      const args = await parseArgs(auditCommand, ['audit', 'sess-abc123']);
      expect(args['sessionId']).toBe('sess-abc123');
    });

    it('parses --format', async () => {
      const args = await parseArgs(auditCommand, ['audit', 'sess-abc123', '--format', 'json']);
      expect(args['sessionId']).toBe('sess-abc123');
      expect(args['format']).toBe('json');
    });
  });

  // --- eval ---

  describe('eval', () => {
    it('defaults', async () => {
      const args = await parseArgs(evalCommand, ['eval']);
      expect(args['diff']).toBe(false);
      expect(args['ci']).toBe(false);
    });

    it('parses --filter --diff --ci --port', async () => {
      const args = await parseArgs(evalCommand, ['eval', '--filter', 'stale', '--diff', '--ci', '--port', '5000']);
      expect(args['filter']).toBe('stale');
      expect(args['diff']).toBe(true);
      expect(args['ci']).toBe(true);
      expect(args['port']).toBe(5000);
    });
  });

  // --- experiment ---

  describe('experiment', () => {
    it('parses action positional', async () => {
      const args = await parseArgs(experimentCommand, ['experiment', 'list']);
      expect(args['action']).toBe('list');
    });

    it('parses --name and --id', async () => {
      const args = await parseArgs(experimentCommand, ['experiment', 'watch', '--name', 'test-exp', '--id', 'exp-123']);
      expect(args['action']).toBe('watch');
      expect(args['name']).toBe('test-exp');
      expect(args['id']).toBe('exp-123');
    });
  });

  // --- test-query ---

  describe('test-query', () => {
    it('parses message positional', async () => {
      const args = await parseArgs(testQueryCommand, ['test-query', 'What is the status?']);
      expect(args['message']).toBe('What is the status?');
    });

    it('parses --app-id and --port', async () => {
      const args = await parseArgs(testQueryCommand, ['test-query', 'hello', '--app-id', 't-123', '--port', '3001']);
      expect(args['message']).toBe('hello');
      expect(args['appId']).toBe('t-123');
      expect(args['port']).toBe(3001);
    });
  });
});
