/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {
  Config,
  type ConfigParameters,
  type SkillManager,
  type ToolRegistry,
  type MessageBus,
  type GeminiClient,
  type AuthType,
  getAuthTypeFromEnv,
} from '@google/gemini-cli-core';
import type { ToolContext } from './tool-context.js';
import type { AuditLogger, AuditConfig, AuditContext } from './audit/index.js';
import { AuditLogger as AuditLoggerImpl } from './audit/audit-logger.js';
import type { ConnectionsMap } from './templates/index.js';
import type { ConnectionInfo } from './platform/platform-types.js';
import type { LoadedStore } from './repo/store-types.js';
import type { StoreBackend } from './stores/store-backend.js';
import type { KBDocument } from './knowledge/kb-types.js';
import { KnowledgeStore } from './knowledge/knowledge-store.js';
import { registerAmodalTools } from './tool-registration.js';
import type { ModelConfig } from './repo/config-schema.js';
import { MultiProviderContentGenerator } from './providers/content-generator/index.js';

/**
 * Extension fields that AmodalConfig adds beyond upstream ConfigParameters.
 */
export interface AmodalConfigExtensions {
  /** Platform API URL for knowledge base proposals */
  platformApiUrl?: string;
  /** Platform API key for authentication */
  platformApiKey?: string;
  /** Application ID for scope resolution */
  applicationId?: string;
  /** Audit logging configuration */
  auditConfig?: AuditConfig;
  /** User identifier for audit entries */
  auditUser?: string;
  /** Source identifier for audit entries */
  auditSource?: string;
  /** Audit version string */
  auditVersion?: string;
  /** Backend API connection secrets */
  connections?: ConnectionsMap;
  /** Application-level knowledge documents */
  appDocuments?: KBDocument[];
  /** Connection metadata for agent awareness */
  connectionInfos?: ConnectionInfo[];
  /** Agent context description */
  agentContext?: string;
  /** HTTP tool configs from version bundle or platform */
  httpToolConfigs?: unknown[];
  /** Chain tool configs from version bundle or platform */
  chainToolConfigs?: unknown[];
  /** Function tool configs from version bundle or platform */
  functionToolConfigs?: unknown[];
  /** Function tool handlers loaded from version bundle */
  functionToolHandlers?: Record<string, unknown>;
  /** Role definitions from version bundle */
  roleDefinitions?: unknown[];
  /** Active role for this session */
  activeRole?: string;
  /** Skills from version bundle */
  bundleSkills?: Array<{ name: string; description: string; body: string }>;
  /** Subagent configs from version bundle */
  bundleSubagents?: unknown[];
  /** Automation definitions from version bundle */
  automationDefinitions?: unknown[];
  /** Built-in tools to disable */
  disabledBuiltInTools?: string[];
  /** Version bundle version string (from platform config) */
  versionBundleVersion?: string;
  /** Version bundle source URL */
  versionBundleUrl?: string;
  /** Version bundle local file path */
  versionBundlePath?: string;
  /** Enable experimental Zed editor integration (ACP mode) */
  experimentalZedIntegration?: boolean;
  /** Enable prompt completion feature */
  enablePromptCompletion?: boolean;
  /** Model configuration (provider, model, credentials, fallback) for content generator */
  modelConfig?: ModelConfig;
  /** Subagent names to disable (e.g., ['explore', 'plan']) */
  disabledSubagents?: string[];
  /** Store definitions from the deployment snapshot */
  stores?: unknown[];
  /** Store backend for persisting store documents */
  storeBackend?: StoreBackend;
  /** Custom base system prompt (overrides the platform default) */
  basePrompt?: string;
  /** Agent display name */
  agentName?: string;
  /** Agent description */
  agentDescription?: string;
}

/**
 * Parameters accepted by AmodalConfig constructor.
 * Upstream ConfigParameters + our extension fields.
 */
export type AmodalConfigParameters = Partial<ConfigParameters> & AmodalConfigExtensions;

// Keys that are AmodalConfigExtensions-only (not in upstream ConfigParameters)
const EXTENSION_KEYS: ReadonlyArray<keyof AmodalConfigExtensions> = [
  'platformApiUrl',
  'platformApiKey',
  'applicationId',
  'auditConfig',
  'auditUser',
  'auditSource',
  'auditVersion',
  'connections',
  'appDocuments',
  'connectionInfos',
  'agentContext',
  'httpToolConfigs',
  'chainToolConfigs',
  'functionToolConfigs',
  'functionToolHandlers',
  'roleDefinitions',
  'activeRole',
  'bundleSkills',
  'bundleSubagents',
  'automationDefinitions',
  'disabledBuiltInTools',
  'versionBundleVersion',
  'versionBundleUrl',
  'versionBundlePath',
  'experimentalZedIntegration',
  'enablePromptCompletion',
  'modelConfig',
  'disabledSubagents',
  'stores',
  'storeBackend',
  'basePrompt',
  'agentName',
  'agentDescription',
];

/**
 * Composition wrapper around upstream Config.
 *
 * Holds an upstream Config instance for the ReAct loop, tool registry, and
 * model configuration. Adds our extension state (platform, knowledge,
 * connections, audit) and implements ToolContext so our tools can access
 * extension fields without coupling to Config internals.
 *
 * After initialize(), registers amodal-specific tools (propose_knowledge,
 * load_knowledge, present, request, custom HTTP/chain/function tools) on
 * the upstream ToolRegistry.
 */
export class AmodalConfig implements ToolContext {
  private readonly config: Config;
  private readonly extensions: AmodalConfigExtensions;
  private readonly knowledgeStore: KnowledgeStore;
  private auditLogger: AuditLogger | undefined;

  constructor(params: AmodalConfigParameters) {
    // Separate extension fields from upstream ConfigParameters
    const extensions: Record<string, unknown> = {};
    const upstreamParams: Record<string, unknown> = {};

    const extensionKeySet = new Set<string>(EXTENSION_KEYS);

    for (const [key, value] of Object.entries(params)) {
      if (extensionKeySet.has(key)) {
        extensions[key] = value;
      } else {
        upstreamParams[key] = value;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- splitting merged params
    this.extensions = extensions as unknown as AmodalConfigExtensions;

    // Disable upstream Gemini CLI builtin skills not relevant to the Amodal runtime
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream params are untyped Record
    const existingDisabled = (upstreamParams['disabledSkills'] as string[] | undefined) ?? [];
    upstreamParams['disabledSkills'] = [...existingDisabled, 'skill-creator'];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- passing upstream params
    this.config = new Config(upstreamParams as unknown as ConfigParameters);

    // Initialize knowledge store from KB docs
    this.knowledgeStore = new KnowledgeStore(
      this.extensions.appDocuments ?? [],
    );

    // Initialize audit logger if configured
    if (this.extensions.auditConfig) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- audit config shape
      const auditConfig = this.extensions.auditConfig as unknown as import('./audit/audit-types.js').AuditConfig;
      const context: AuditContext = {
        sessionId: params.sessionId ?? 'unknown',
        user: this.extensions.auditUser ?? 'unknown',
        source: this.extensions.auditSource ?? 'interactive',
        version: this.extensions.auditVersion ?? 'local',
        role: this.extensions.activeRole ?? 'default',
      };
      this.auditLogger = new AuditLoggerImpl(auditConfig, context);
    }
  }

  /**
   * Initialize the upstream Config, then register amodal tools on its registry.
   */
  async initialize(): Promise<void> {
    await this.config.initialize();
    await this.registerTools();
  }

  /**
   * Register amodal-specific tools and skills on the upstream registry.
   * Called after the upstream Config is already initialized.
   */
  async registerTools(): Promise<void> {
    await registerAmodalTools(this, this.config);
    await this.registerBundleSkills();
  }

  // ---------------------------------------------------------------------------
  // ToolContext implementation
  // ---------------------------------------------------------------------------

  getSessionId(): string {
    return this.config.getSessionId();
  }

  getPlatformApiUrl(): string | undefined {
    return this.extensions.platformApiUrl;
  }

  getPlatformApiKey(): string | undefined {
    return this.extensions.platformApiKey;
  }

  getApplicationId(): string | undefined {
    return this.extensions.applicationId;
  }

  getAppId(): string | undefined {
    return this.extensions.applicationId;
  }

  getAuditLogger(): AuditLogger | undefined {
    return this.auditLogger;
  }

  getConnections(): ConnectionsMap {
    return this.extensions.connections ?? {};
  }

  getKnowledgeStore(): KnowledgeStore {
    return this.knowledgeStore;
  }

  getConnectionInfos(): ConnectionInfo[] {
    return this.extensions.connectionInfos ?? [];
  }

  getAgentContext(): string | undefined {
    return this.extensions.agentContext;
  }

  getBasePrompt(): string | undefined {
    return this.extensions.basePrompt;
  }

  getAgentName(): string | undefined {
    return this.extensions.agentName;
  }

  getBundleSubagents(): unknown[] {
    return this.extensions.bundleSubagents ?? [];
  }

  getDisabledSubagents(): string[] {
    return this.extensions.disabledSubagents ?? [];
  }

  getStores(): LoadedStore[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stores from snapshot are validated at load time
    return (this.extensions.stores ?? []) as LoadedStore[];
  }

  getStoreBackend(): StoreBackend | undefined {
    return this.extensions.storeBackend;
  }

  getSessionEnv(): Record<string, string> {
    const secrets = this.extensions.connections?.['_secrets'];
    if (secrets && typeof secrets === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- _secrets is stored as Record<string, string> by AgentSDK
      return secrets as unknown as Record<string, string>;
    }
    return {};
  }

  setStoreBackend(backend: StoreBackend): void {
    this.extensions.storeBackend = backend;
  }

  getAgentDescription(): string | undefined {
    return this.extensions.agentDescription;
  }

  getRoleDefinitions(): unknown[] {
    return this.extensions.roleDefinitions ?? [];
  }

  getActiveRoleName(): string | undefined {
    return this.extensions.activeRole;
  }

  getVersionBundleVersion(): string | undefined {
    return this.extensions.versionBundleVersion;
  }

  getVersionBundleUrl(): string | undefined {
    return this.extensions.versionBundleUrl;
  }

  getVersionBundlePath(): string | undefined {
    return this.extensions.versionBundlePath;
  }

  getExperimentalZedIntegration(): boolean {
    return this.extensions.experimentalZedIntegration ?? false;
  }

  getEnablePromptCompletion(): boolean {
    return this.extensions.enablePromptCompletion ?? false;
  }

  // ---------------------------------------------------------------------------
  // Upstream delegation
  // ---------------------------------------------------------------------------

  /** Access the upstream Config instance directly. */
  getUpstreamConfig(): Config {
    return this.config;
  }

  getToolRegistry(): ToolRegistry {
    return this.config.getToolRegistry();
  }

  getMessageBus(): MessageBus {
    return this.config.getMessageBus();
  }

  getSkillManager(): SkillManager {
    return this.config.getSkillManager();
  }

  getGeminiClient(): GeminiClient {
    return this.config.getGeminiClient();
  }

  getModel(): string {
    return this.config.getModel();
  }

  getModelConfig(): ModelConfig | undefined {
    return this.extensions.modelConfig;
  }

  setModelConfig(mc: ModelConfig): void {
    this.extensions.modelConfig = mc;
  }

  async refreshAuth(authType: AuthType, apiKey?: string, baseUrl?: string, customHeaders?: Record<string, string>): Promise<void> {
    return this.config.refreshAuth(authType, apiKey, baseUrl, customHeaders);
  }

  /**
   * Initialize the upstream content generator.
   *
   * When a non-Google provider is configured (via modelConfig), creates a
   * MultiProviderContentGenerator that routes calls through our existing
   * RuntimeProvider system (Anthropic, OpenAI, Bedrock, Azure, etc.).
   *
   * For Google providers (or when no modelConfig is set), falls back to
   * the upstream Gemini content generator.
   */
  async initializeAuth(): Promise<void> {
    const modelConfig = this.extensions.modelConfig;

    if (modelConfig && modelConfig.provider !== 'google') {
      // Create our multi-provider content generator
      const generator = new MultiProviderContentGenerator(modelConfig);

      // Replace the content generator on the upstream Config (private field).
      // Skip refreshAuth entirely — it hangs without Gemini credentials and
      // is unnecessary since we're replacing the content generator.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const raw = this.config as unknown as Record<string, unknown>;
      raw['contentGenerator'] = generator;
      return;
    }

    // Default: use upstream Gemini content generator
    const authType = getAuthTypeFromEnv();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    await this.config.refreshAuth(authType ?? ('gemini-api-key' as AuthType));
  }

  /**
   * Allowlist environment variable names on the upstream Config so the
   * sanitization pipeline doesn't strip them.
   */
  addAllowedEnvironmentVariables(names: string[]): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing private field for runtime env var allowlisting
    const raw = this.config as unknown as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing private field
    const existing = raw['allowedEnvironmentVariables'] as string[] | undefined;
    raw['allowedEnvironmentVariables'] = [...(existing ?? []), ...names];
  }

  /**
   * Alias for shutdown — used by session manager to flush audit on destroy.
   */
  async shutdownAudit(): Promise<void> {
    return this.shutdown();
  }

  /**
   * Shutdown: flush audit logs and dispose upstream Config.
   * Disposing the upstream Config removes coreEvents listeners, stops MCP
   * servers, and frees GeminiClient/AgentRegistry resources — critical for
   * preventing listener leaks in multi-session server runtimes.
   */
  async shutdown(): Promise<void> {
    if (this.auditLogger) {
      await this.auditLogger.flush();
    }
    try {
      await this.config.dispose();
    } catch {
      // Best-effort — upstream may already be partially torn down
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Register bundle skills on the upstream SkillManager.
   */
  private async registerBundleSkills(): Promise<void> {
    const skills = this.extensions.bundleSkills;
    if (!skills || skills.length === 0) return;

    const skillManager = this.config.getSkillManager();
    skillManager.addSkills(
      skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        body: skill.body,
        location: 'bundle', // virtual location for bundle-sourced skills
      })),
    );
  }
}
