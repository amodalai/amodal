/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { FunctionHandlerMap } from '../tools/function-tool-types.js';
import type { HttpToolConfig } from '../tools/http-tool-types.js';
import type { ChainToolConfig } from '../tools/chain-tool-types.js';
import type { FunctionToolConfig } from '../tools/function-tool-types.js';
import type { RoleDefinition } from '../roles/role-types.js';
import type {
  VersionBundle,
  BundleSkill,
  AutomationDefinition,
  BundleDependencies,
} from './version-bundle-types.js';
import { loadBundle, type BundleSource } from './bundle-loader.js';
import { diffDependencies, installDependencies } from './dependency-manager.js';
import { loadHandlers } from './handler-loader.js';

/**
 * A fully loaded and ready-to-use version.
 */
export interface LoadedVersion {
  /** The raw bundle */
  bundle: VersionBundle;
  /** Directory where this version's files live */
  versionDir: string;
  /** Imported function handlers */
  handlerMap: FunctionHandlerMap;
  /** HTTP tool configs extracted from the bundle */
  httpToolConfigs: HttpToolConfig[];
  /** Chain tool configs extracted from the bundle */
  chainToolConfigs: ChainToolConfig[];
  /** Function tool configs extracted from the bundle */
  functionToolConfigs: FunctionToolConfig[];
  /** Skill definitions */
  skills: BundleSkill[];
  /** Role definitions */
  roles: RoleDefinition[];
  /** Automation definitions */
  automations: AutomationDefinition[];
  /** When this version was loaded */
  loadedAt: Date;
}

export interface VersionManagerOptions {
  /** Base directory for version storage */
  baseDir: string;
  /** Optional audit logger for version_load events */
  auditLogger?: AuditLogger;
}

/**
 * Manages the version bundle lifecycle: load, install deps, import handlers,
 * and atomically swap to the new version.
 */
export class VersionManager {
  private readonly baseDir: string;
  private readonly auditLogger?: AuditLogger;
  private _currentVersion: LoadedVersion | null = null;

  constructor(options: VersionManagerOptions) {
    this.baseDir = options.baseDir;
    this.auditLogger = options.auditLogger;
  }

  /**
   * The currently active version, or null if none loaded.
   */
  get currentVersion(): LoadedVersion | null {
    return this._currentVersion;
  }

  /**
   * Load a version bundle through the full lifecycle:
   * 1. Fetch/read + validate
   * 2. Create version directory
   * 3. Diff dependencies against current version
   * 4. Install dependencies + verify system binaries
   * 5. Write + import handlers
   * 6. Separate tool configs by type
   * 7. Atomic swap
   * 8. Audit log
   */
  async loadVersion(source: BundleSource): Promise<LoadedVersion> {
    // 1. Load and validate
    const bundle = await loadBundle(source);

    // 2. Create version directory
    const versionDir = path.join(this.baseDir, 'versions', bundle.version);
    await mkdir(versionDir, { recursive: true });

    // 3. Diff dependencies
    const oldDeps: BundleDependencies = this._currentVersion
      ? this._currentVersion.bundle.dependencies
      : {};
    const diff = diffDependencies(oldDeps, bundle.dependencies);

    // 4. Install dependencies and verify system binaries
    const installResult = await installDependencies(diff, versionDir);
    if (installResult.missingBinaries.length > 0) {
      throw new Error(
        `Missing system binaries: ${installResult.missingBinaries.join(', ')}`,
      );
    }

    // 5. Write and import handlers
    const handlerMap = await loadHandlers(bundle.handlers, versionDir);

    // 6. Separate tool configs by type (skip disabled tools as belt-and-suspenders)
    const httpToolConfigs: HttpToolConfig[] = [];
    const chainToolConfigs: ChainToolConfig[] = [];
    const functionToolConfigs: FunctionToolConfig[] = [];

    for (const tool of bundle.tools.filter((t) => !t.disabled)) {
      if (tool.type === 'http') {
        const { type: _, ...config } = tool;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stripping discriminator from validated Zod output
        httpToolConfigs.push(config as unknown as HttpToolConfig);
      } else if (tool.type === 'chain') {
        const { type: _, ...config } = tool;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stripping discriminator from validated Zod output
        chainToolConfigs.push(config as unknown as ChainToolConfig);
      } else if (tool.type === 'function') {
        const { type: _, ...config } = tool;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stripping discriminator from validated Zod output
        functionToolConfigs.push(config as unknown as FunctionToolConfig);
      }
    }

    // 7. Build loaded version and atomic swap
    const loadedVersion: LoadedVersion = {
      bundle,
      versionDir,
      handlerMap,
      httpToolConfigs,
      chainToolConfigs,
      functionToolConfigs,
      skills: bundle.skills,
      roles: bundle.roles,
      automations: bundle.automations,
      loadedAt: new Date(),
    };

    this._currentVersion = loadedVersion;

    // 8. Audit
    this.auditLogger?.logVersionLoad(bundle.version);

    return loadedVersion;
  }

  /**
   * Get config-compatible fields from the current version.
   * Returns null if no version is loaded.
   */
  getVersionConfig(): {
    httpToolConfigs: HttpToolConfig[];
    chainToolConfigs: ChainToolConfig[];
    functionToolConfigs: FunctionToolConfig[];
    functionToolHandlers: FunctionHandlerMap;
    roleDefinitions: RoleDefinition[];
    skills: BundleSkill[];
    automations: AutomationDefinition[];
    version: string;
  } | null {
    if (!this._currentVersion) return null;
    return {
      httpToolConfigs: this._currentVersion.httpToolConfigs,
      chainToolConfigs: this._currentVersion.chainToolConfigs,
      functionToolConfigs: this._currentVersion.functionToolConfigs,
      functionToolHandlers: this._currentVersion.handlerMap,
      roleDefinitions: this._currentVersion.roles,
      skills: this._currentVersion.skills,
      automations: this._currentVersion.automations,
      version: this._currentVersion.bundle.version,
    };
  }

  /**
   * Remove a version's directory from disk.
   * Should only be called after all sessions using this version have finished.
   */
  async cleanup(version: string): Promise<void> {
    const versionDir = path.join(this.baseDir, 'versions', version);
    await rm(versionDir, { recursive: true, force: true });
  }
}
