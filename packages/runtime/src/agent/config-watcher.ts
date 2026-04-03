/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {watch, type FSWatcher} from 'node:fs';
import {join} from 'node:path';
import {loadRepo} from '@amodalai/core';
import type {AgentBundle} from '@amodalai/core';
import {log} from '../logger.js';

const DEBOUNCE_MS = 300;

/**
 * Watches agent config directories for changes and reloads the repo.
 */
export class ConfigWatcher {
  private readonly repoPath: string;
  private readonly onChange: (repo: AgentBundle) => void;
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(repoPath: string, onChange: (repo: AgentBundle) => void) {
    this.repoPath = repoPath;
    this.onChange = onChange;
  }

  start(): void {
    if (this.watchers.length > 0) {
      return;
    }

    const targets = [
      'amodal.json',
      'skills',
      'knowledge',
      'connections',
      'tools',
      'evals',
      'stores',
      'pages',
      'automations',
    ];

    for (const target of targets) {
      const targetPath = join(this.repoPath, target);
      try {
        const w = watch(targetPath, {recursive: true}, (_eventType, _filename) => {
          this.scheduleReload();
        });
        this.watchers.push(w);
      } catch {
        // Directory or file might not exist yet
      }
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reload();
    }, DEBOUNCE_MS);
  }

  private async reload(): Promise<void> {
    try {
      const repo = await loadRepo({localPath: this.repoPath});
      this.onChange(repo);
      log.debug('Config reloaded', 'config-watcher');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Reload failed: ${msg}`, 'config-watcher');
    }
  }
}
