/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {watch, type FSWatcher} from 'node:fs';
import {join} from 'node:path';
import {loadRepo} from '@amodalai/core';
import type {AmodalRepo} from '@amodalai/core';

const DEBOUNCE_MS = 300;

/**
 * Watches the `.amodal/` directory for changes and reloads the repo.
 */
export class ConfigWatcher {
  private readonly repoPath: string;
  private readonly onChange: (repo: AmodalRepo) => void;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(repoPath: string, onChange: (repo: AmodalRepo) => void) {
    this.repoPath = repoPath;
    this.onChange = onChange;
  }

  start(): void {
    if (this.watcher) {
      return;
    }

    const configDir = join(this.repoPath, '.amodal');

    try {
      this.watcher = watch(configDir, {recursive: true}, (_eventType, _filename) => {
        this.scheduleReload();
      });
    } catch {
      // Directory might not exist yet or watching might not be supported
      process.stderr.write('[ConfigWatcher] Failed to start watching .amodal/ directory\n');
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
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
      process.stderr.write('[ConfigWatcher] Config reloaded\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ConfigWatcher] Reload failed: ${msg}\n`);
    }
  }
}
