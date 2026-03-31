/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { AmodalConfig, type AmodalConfigParameters } from './amodal-config.js';
import { VersionManager } from './versions/version-manager.js';
import { PlatformClient } from './platform/platform-client.js';
import { buildPlatformConfigParams } from './platform/config-builder.js';
import type { AgentSDKConfig, ConnectionInfo } from './platform/platform-types.js';
import type { KBDocument } from './knowledge/kb-types.js';
import type { BundleToolConfig, BundleSkill, SubagentConfig } from './versions/version-bundle-types.js';
import type { ModelConfig } from './repo/config-schema.js';

/**
 * The main public interface for the Agent Runtime Platform SDK.
 *
 * Wraps AmodalConfig + VersionManager + PlatformClient into a single entry point.
 * Consumers create an AgentSDK, call initialize(), then use getConfig()
 * to access the fully-configured runtime.
 */
export class AgentSDK {
  private readonly sdkConfig: AgentSDKConfig;
  private readonly configOverrides: Record<string, unknown>;
  private amodalConfig: AmodalConfig | null = null;
  private versionManager: VersionManager | null = null;
  private platformClientInstance: PlatformClient | null = null;
  private initialized = false;

  /**
   * @param sdkConfig Platform, connections, audit, and role configuration
   * @param configOverrides Additional ConfigParameters fields for the underlying
   *   Config class (model, sessionId, cwd, etc.). Bundle-derived fields from
   *   the version config will override matching fields in configOverrides.
   */
  constructor(
    sdkConfig: AgentSDKConfig,
    configOverrides: Record<string, unknown> = {},
  ) {
    this.sdkConfig = sdkConfig;
    this.configOverrides = configOverrides;
  }

  /**
   * Load the version bundle (if configured), install deps, import handlers,
   * build AmodalConfig, and call AmodalConfig.initialize().
   *
   * Must be called exactly once before getConfig() or getVersionManager().
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('AgentSDK is already initialized');
    }
    this.initialized = true;

    // 1. Determine bundle source and load if available
    const baseDir = this.sdkConfig.versionBaseDir ?? tmpdir();
    this.versionManager = new VersionManager({ baseDir });

    let versionConfig: ReturnType<VersionManager['getVersionConfig']> = null;

    if (this.sdkConfig.platform) {
      // Create PlatformClient for KB/org/secrets fetching
      this.platformClientInstance = new PlatformClient(this.sdkConfig.platform);

      // Only fetch bundle when a deployment is configured
      if (this.sdkConfig.platform.deployment) {
        const bundle = await this.platformClientInstance.fetchLatestBundle();
        const bundleDir = path.join(baseDir, 'bundles');
        await mkdir(bundleDir, { recursive: true });
        const bundlePath = path.join(bundleDir, `${bundle.version}.json`);
        await writeFile(bundlePath, JSON.stringify(bundle), 'utf-8');
        await this.versionManager.loadVersion({ path: bundlePath });
        versionConfig = this.versionManager.getVersionConfig();
      }
    } else if (this.sdkConfig.localBundlePath) {
      await this.versionManager.loadVersion({
        path: this.sdkConfig.localBundlePath,
      });
      versionConfig = this.versionManager.getVersionConfig();
    }

    // 1.5 Load base_prompt + agent_context from application (non-fatal)
    if (this.platformClientInstance && this.sdkConfig.applicationId) {
      try {
        const app = await this.platformClientInstance.fetchApplication(
          this.sdkConfig.applicationId,
        );
        if (app.agent_context) {
          this.sdkConfig.agentContext = app.agent_context;
        }
        if (app.base_prompt) {
          this.configOverrides['basePrompt'] = app.base_prompt;
        }
        if (app.name) {
          this.configOverrides['agentName'] = app.name;
        }
        if (app.disabled_platform_tools && app.disabled_platform_tools.length > 0) {
          this.sdkConfig.disabledPlatformTools = app.disabled_platform_tools;
        }
        if (app.model) {
          this.configOverrides['model'] = app.model;
        }
        if (app.provider) {
          process.env['LLM_PROVIDER'] = app.provider;

          // Build ModelConfig for the MultiProviderContentGenerator
          const mc: ModelConfig = {
            provider: app.provider,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            model: app.model ?? (this.configOverrides['model'] as string | undefined) ?? 'gemini-2.0-flash',
            baseUrl: app.provider_base_url ?? undefined,
            credentials: {},
          };
          if (app.provider_api_key) {
            const credKey = app.provider === 'anthropic' ? 'ANTHROPIC_API_KEY'
              : app.provider === 'openai' ? 'OPENAI_API_KEY'
              : 'API_KEY';
            mc.credentials = { [credKey]: app.provider_api_key };
          }
          this.configOverrides['modelConfig'] = mc;
        }
        if (app.provider_base_url) {
          this.configOverrides['providerBaseUrl'] = app.provider_base_url;
        }
        if (app.provider_api_key) {
          this.configOverrides['providerApiKey'] = app.provider_api_key;
        }
        if (app.simple_model) {
          this.configOverrides['simpleModel'] = app.simple_model;
        }
        if (app.advanced_model) {
          this.configOverrides['advancedModel'] = app.advanced_model;
        }
      } catch {
        process.stderr.write(
          '[WARN] Failed to fetch application details\n',
        );
      }
    }

    // 2. Fetch knowledge base documents (non-fatal)
    let appDocuments: KBDocument[] = [];

    if (this.platformClientInstance) {
      const appId = this.sdkConfig.applicationId;
      if (appId) {
        try {
          appDocuments = await this.platformClientInstance.fetchDocuments(
            'application',
            appId,
            this.sdkConfig.sessionType,
          );
        } catch {
          process.stderr.write(
            '[WARN] Failed to fetch application knowledge base\n',
          );
        }
      }

      // 2.5 Resolve app secrets and merge into connections (non-fatal)
      const appIdForSecrets = this.sdkConfig.applicationId;
      if (appIdForSecrets) {
        try {
          const secrets = await this.platformClientInstance.resolveSecrets(
            appIdForSecrets,
          );
          if (secrets.length > 0) {
            const connections = this.sdkConfig.connections ?? {};
            const resolved: Record<string, string> = {};
            for (const secret of secrets) {
              resolved[secret.name] = secret.value;
            }
            this.sdkConfig.connections = { ...connections, _secrets: resolved };
          }
        } catch {
          process.stderr.write(
            '[WARN] Failed to resolve app secrets\n',
          );
        }

        // 2.6 Resolve connections (credentials + request_config) — non-fatal
        try {
          const resolvedConns = await this.platformClientInstance.resolveConnections(
            appIdForSecrets,
          );
          const connections = this.sdkConfig.connections ?? {};
          for (const [connName, resolved] of Object.entries(resolvedConns)) {
            const connConfig: Record<string, unknown> = {
              ...resolved.credentials,
            };
            if (resolved.request_config) {
              connConfig['_request_config'] = resolved.request_config;
            }
            connections[connName] = connConfig;
          }
          this.sdkConfig.connections = connections;
        } catch {
          process.stderr.write(
            '[WARN] Failed to resolve connections\n',
          );
        }
      }
    }

    // 2.65 Fetch connection metadata for agent awareness (non-fatal)
    let connectionInfos: ConnectionInfo[] = [];
    if (this.platformClientInstance && this.sdkConfig.applicationId) {
      try {
        connectionInfos = await this.platformClientInstance.fetchConnections(
          this.sdkConfig.applicationId,
          this.sdkConfig.sessionType,
        );
        if (connectionInfos.length > 0) {
          process.stderr.write(
            `[SDK] Loaded ${String(connectionInfos.length)} connection info(s)\n`,
          );
        }
      } catch {
        process.stderr.write(
          '[WARN] Failed to fetch connection metadata\n',
        );
      }
    }

    // 2.7 Fetch custom tools and separate by type (non-fatal)
    const httpToolConfigs: unknown[] = [];
    const chainToolConfigs: unknown[] = [];
    const functionToolConfigs: unknown[] = [];

    if (this.platformClientInstance) {
      const toolAppId = this.sdkConfig.applicationId;
      if (toolAppId) {
        try {
          const tools: BundleToolConfig[] =
            await this.platformClientInstance.fetchTools(toolAppId, this.sdkConfig.sessionType);
          for (const tool of tools) {
            const { type: _type, ...config } = tool;
            if (tool.type === 'http') {
              httpToolConfigs.push(config);
            } else if (tool.type === 'chain') {
              chainToolConfigs.push(config);
            } else if (tool.type === 'function') {
              functionToolConfigs.push(config);
            }
          }
          if (tools.length > 0) {
            process.stderr.write(
              `[SDK] Loaded ${String(tools.length)} custom tool(s)\n`,
            );
          }
        } catch {
          process.stderr.write('[WARN] Failed to fetch custom tools\n');
        }
      }
    }

    // 2.8 Fetch skills from platform API (non-fatal)
    let fetchedSkills: BundleSkill[] = [];

    if (this.platformClientInstance) {
      const skillAppId = this.sdkConfig.applicationId;
      if (skillAppId) {
        try {
          fetchedSkills = await this.platformClientInstance.fetchSkills(skillAppId, this.sdkConfig.sessionType);
          if (fetchedSkills.length > 0) {
            process.stderr.write(
              `[SDK] Loaded ${String(fetchedSkills.length)} skill(s)\n`,
            );
          }
        } catch {
          process.stderr.write('[WARN] Failed to fetch skills\n');
        }
      }
    }

    // 2.9 Fetch subagents from platform API (non-fatal)
    let fetchedSubagents: SubagentConfig[] = [];

    if (this.platformClientInstance) {
      const saAppId = this.sdkConfig.applicationId;
      if (saAppId) {
        try {
          fetchedSubagents = await this.platformClientInstance.fetchSubagents(saAppId, this.sdkConfig.sessionType);
          if (fetchedSubagents.length > 0) {
            process.stderr.write(
              `[SDK] Loaded ${String(fetchedSubagents.length)} subagent(s)\n`,
            );
          }
        } catch {
          process.stderr.write('[WARN] Failed to fetch subagents\n');
        }
      }
    }

    // 3. Build platform config params
    const platformParams = buildPlatformConfigParams(
      versionConfig,
      this.sdkConfig,
    );

    // 4. Merge: configOverrides (base) + platformParams (override) + KB docs + custom tools
    const mergedParams: Record<string, unknown> = {
      ...this.configOverrides,
      ...platformParams,
      appDocuments,
      connectionInfos,
    };

    // Only set tool config arrays when there are tools to include
    const bundleHttp = (platformParams.httpToolConfigs) ?? [];
    const bundleChain = (platformParams.chainToolConfigs) ?? [];
    const bundleFunction = (platformParams.functionToolConfigs) ?? [];

    if (bundleHttp.length > 0 || httpToolConfigs.length > 0) {
      mergedParams['httpToolConfigs'] = [...bundleHttp, ...httpToolConfigs];
    }
    if (bundleChain.length > 0 || chainToolConfigs.length > 0) {
      mergedParams['chainToolConfigs'] = [...bundleChain, ...chainToolConfigs];
    }
    if (bundleFunction.length > 0 || functionToolConfigs.length > 0) {
      mergedParams['functionToolConfigs'] = [...bundleFunction, ...functionToolConfigs];
    }

    // Merge skills
    const bundleSkillsFromVersion = (platformParams.bundleSkills as Array<{ name: string; description: string; body: string }> | undefined) ?? [];
    if (bundleSkillsFromVersion.length > 0 || fetchedSkills.length > 0) {
      mergedParams['bundleSkills'] = [...bundleSkillsFromVersion, ...fetchedSkills];
    }

    // Merge subagents
    if (fetchedSubagents.length > 0) {
      mergedParams['bundleSubagents'] = fetchedSubagents;
    }

    // 2.95 Fetch stores + knowledge from active deployment snapshot (non-fatal)
    if (this.platformClientInstance) {
      try {
        const snapshot = await this.platformClientInstance.fetchActiveSnapshot(30000, this.sdkConfig.deployId);
        if (snapshot) {
          // Stores
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- snapshot from server
          const stores = snapshot['stores'] as unknown[] | undefined;
          if (stores && stores.length > 0) {
            mergedParams['stores'] = stores;
            process.stderr.write(
              `[SDK] Loaded ${String(stores.length)} store(s)\n`,
            );
          }

          // Knowledge from snapshot (repo-based, not from platform DB)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- snapshot from server
          const knowledge = snapshot['knowledge'] as Array<{name: string; title: string; body: string}> | undefined;
          if (knowledge && knowledge.length > 0) {
            // Convert snapshot knowledge to KBDocument format
            const snapshotDocs: KBDocument[] = knowledge.map((k) => ({
              id: k.name,
              scope_type: 'application' as const,
              scope_id: this.sdkConfig.applicationId ?? '',
              title: k.title,
              category: 'system_docs' as KBDocument['category'],
              body: k.body,
              tags: [],
              status: 'approved',
              created_by: 'deployment',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }));
            // Merge with any platform-fetched docs (snapshot docs first, platform docs override)
            const existingNames = new Set(appDocuments.map((d) => d.title));
            const newDocs = snapshotDocs.filter((d) => !existingNames.has(d.title));
            appDocuments = [...appDocuments, ...newDocs];
            // Update mergedParams since appDocuments was reassigned
            mergedParams['appDocuments'] = appDocuments;
            process.stderr.write(
              `[SDK] Loaded ${String(newDocs.length)} knowledge doc(s) from snapshot\n`,
            );
          }
        }
      } catch {
        // Non-fatal — stores and knowledge are optional
      }
    }

    // 5. Create AmodalConfig (composition wrapper) and initialize
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- merging partial configs
    this.amodalConfig = new AmodalConfig(mergedParams as unknown as AmodalConfigParameters);
    await this.amodalConfig.initialize();
  }

  /**
   * Access the initialized AmodalConfig instance.
   * Throws if initialize() hasn't been called.
   */
  getConfig(): AmodalConfig {
    if (!this.amodalConfig) {
      throw new Error(
        'AgentSDK not initialized. Call initialize() first.',
      );
    }
    return this.amodalConfig;
  }

  /**
   * Access the VersionManager instance.
   * Throws if initialize() hasn't been called.
   */
  getVersionManager(): VersionManager {
    if (!this.versionManager) {
      throw new Error(
        'AgentSDK not initialized. Call initialize() first.',
      );
    }
    return this.versionManager;
  }

  /**
   * Access the PlatformClient instance (if platform config was provided).
   * Returns null if no platform config was set.
   */
  getPlatformClient(): PlatformClient | null {
    return this.platformClientInstance;
  }

  /**
   * Shutdown the SDK: flush audit logs.
   */
  async shutdown(): Promise<void> {
    if (this.amodalConfig) {
      await this.amodalConfig.shutdown();
    }
  }
}
