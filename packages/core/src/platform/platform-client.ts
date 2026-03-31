/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { VersionBundle, BundleToolConfig, BundleSkill, SubagentConfig } from '../versions/version-bundle-types.js';
import { VersionBundleSchema, BundleToolConfigSchema, BundleSkillSchema, SubagentConfigSchema } from '../versions/version-bundle-types.js';
import { z } from 'zod';
import { VersionBundleError } from '../versions/bundle-loader.js';
import type { PlatformConfig, ConnectionInfo } from './platform-types.js';
import { PlatformConfigSchema } from './platform-types.js';
import type { KBDocument, ScopeType } from '../knowledge/kb-types.js';

/**
 * Organization record returned by the platform API.
 */
export interface OrgRecord {
  id: string;
  name: string;
  agent_context?: string;
}

/**
 * Application record returned by the platform API.
 */
export interface AppRecord {
  id: string;
  org_id: string;
  name: string;
  base_prompt?: string;
  agent_context?: string;
  disabled_platform_tools?: string[];
  model?: string;
  simple_model?: string;
  advanced_model?: string;
  provider?: string;
  provider_base_url?: string;
  provider_api_key?: string;
}

/**
 * A resolved secret (name + decrypted value) returned by the platform API.
 */
export interface ResolvedSecret {
  name: string;
  value: string;
}

/**
 * Request config for a connection, describing how to build HTTP requests.
 */
export interface RequestConfigRecord {
  base_url_field: string;
  auth: Array<{ header: string; value_template: string }>;
  default_headers: Record<string, string>;
}

/**
 * A resolved connection with credentials and optional request config.
 */
export interface ResolvedConnection {
  credentials: Record<string, string>;
  request_config?: RequestConfigRecord;
}

/**
 * Map of connection names to their resolved credentials and request config.
 */
export type ResolvedConnectionMap = Record<string, ResolvedConnection>;

/**
 * Build the API URL path for fetching documents by scope.
 * All documents are now application-scoped.
 */
function buildDocumentsPath(_scopeType: ScopeType, scopeId: string): string {
  const encodedId = encodeURIComponent(scopeId);
  return `/api/applications/${encodedId}/documents`;
}

/**
 * Client for communicating with the platform API.
 * Fetches version bundles for a specific deployment.
 */
export class PlatformClient {
  private readonly config: PlatformConfig;

  constructor(config: PlatformConfig) {
    const parsed = PlatformConfigSchema.safeParse(config);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid platform config: ${issues}`);
    }
    this.config = parsed.data;
  }

  /**
   * Fetch the latest version bundle for this deployment.
   */
  async fetchLatestBundle(timeout = 30000): Promise<VersionBundle> {
    if (!this.config.deployment) {
      throw new Error('Cannot fetch bundle: deployment is not configured');
    }
    const url = `${this.config.apiUrl}/deployments/${encodeURIComponent(this.config.deployment)}/bundle`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new VersionBundleError(
          'FETCH_FAILED',
          `Request timed out fetching bundle from ${url}`,
          err,
        );
      }
      throw new VersionBundleError(
        'FETCH_FAILED',
        `Failed to fetch bundle from ${url}`,
        err,
      );
    }

    if (!response.ok) {
      throw new VersionBundleError(
        'FETCH_FAILED',
        `HTTP ${String(response.status)} fetching bundle from ${url}`,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new VersionBundleError(
        'PARSE_FAILED',
        `Invalid JSON in bundle response from ${url}`,
        err,
      );
    }

    try {
      return VersionBundleSchema.parse(data);
    } catch (err) {
      throw new VersionBundleError(
        'VALIDATION_FAILED',
        `Bundle validation failed for deployment "${this.config.deployment}"`,
        err,
      );
    }
  }

  /**
   * Fetch knowledge base documents for a given scope.
   *
   * @param scopeType 'application'
   * @param scopeId The application ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchDocuments(
    scopeType: ScopeType,
    scopeId: string,
    sessionType?: string,
    timeout = 30000,
  ): Promise<KBDocument[]> {
    const urlPath = buildDocumentsPath(scopeType, scopeId);
    const sessionParam = sessionType ? `?session_type=${encodeURIComponent(sessionType)}` : '';
    const url = `${this.config.apiUrl}${urlPath}${sessionParam}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching documents from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch documents from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching documents from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response validated at API layer
    return (await response.json()) as KBDocument[];
  }

  /**
   * Fetch documents matching any of the given tags.
   */
  async fetchDocumentsByTags(
    scopeType: ScopeType,
    scopeId: string,
    tags: string[],
    timeout = 30000,
  ): Promise<KBDocument[]> {
    return this.fetchDocumentsWithParams(
      scopeType,
      scopeId,
      { tags: tags.join(',') },
      timeout,
    );
  }

  /**
   * Search documents by title keyword.
   */
  async searchDocuments(
    scopeType: ScopeType,
    scopeId: string,
    query: string,
    timeout = 30000,
  ): Promise<KBDocument[]> {
    return this.fetchDocumentsWithParams(
      scopeType,
      scopeId,
      { search: query },
      timeout,
    );
  }

  /**
   * Fetch specific documents by their IDs.
   */
  async fetchDocumentsByIds(
    scopeType: ScopeType,
    scopeId: string,
    ids: string[],
    timeout = 30000,
  ): Promise<KBDocument[]> {
    return this.fetchDocumentsWithParams(
      scopeType,
      scopeId,
      { ids: ids.join(',') },
      timeout,
    );
  }

  /**
   * Internal helper: fetch documents with optional query params.
   */
  private async fetchDocumentsWithParams(
    scopeType: ScopeType,
    scopeId: string,
    params: Record<string, string>,
    timeout: number,
  ): Promise<KBDocument[]> {
    const urlPath = buildDocumentsPath(scopeType, scopeId);
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.config.apiUrl}${urlPath}?${queryString}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching documents from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch documents from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching documents from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response validated at API layer
    return (await response.json()) as KBDocument[];
  }

  /**
   * Fetch organization details.
   *
   * @param orgId The organization ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchOrganization(
    orgId: string,
    timeout = 30000,
  ): Promise<OrgRecord> {
    const url = `${this.config.apiUrl}/api/orgs/${encodeURIComponent(orgId)}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `Request timed out fetching organization from ${url}`,
          { cause: err },
        );
      }
      throw new Error(`Failed to fetch organization from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching organization from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response validated at API layer
    return (await response.json()) as OrgRecord;
  }

  /**
   * Fetch application details (including base_prompt and agent_context).
   *
   * @param appId The application ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchApplication(
    appId: string,
    timeout = 30000,
  ): Promise<AppRecord> {
    const url = `${this.config.apiUrl}/api/applications/${encodeURIComponent(appId)}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `Request timed out fetching application from ${url}`,
          { cause: err },
        );
      }
      throw new Error(`Failed to fetch application from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching application from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response validated at API layer
    return (await response.json()) as AppRecord;
  }

  /**
   * Fetch the active deployment snapshot blob.
   * Returns the raw snapshot record or null if none is active.
   */
  async fetchActiveSnapshot(
    timeout = 30000,
    deployId?: string,
  ): Promise<Record<string, unknown> | null> {
    const params = new URLSearchParams({environment: 'production'});
    if (deployId) params.set('deployId', deployId);
    const url = `${this.config.apiUrl}/api/snapshot-deployments/active?${params.toString()}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);

      if (!response.ok) return null;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- raw snapshot blob
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Resolve decrypted secrets for an application.
   *
   * @param appId The application ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async resolveSecrets(
    appId: string,
    timeout = 30000,
  ): Promise<ResolvedSecret[]> {
    const url = `${this.config.apiUrl}/api/applications/${encodeURIComponent(appId)}/secrets/resolve`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching secrets from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch secrets from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching secrets from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response validated at API layer
    return (await response.json()) as ResolvedSecret[];
  }

  /**
   * Resolve connections for an application — returns per-connection credentials + request_config.
   *
   * @param appId The application ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async resolveConnections(
    appId: string,
    timeout = 30000,
  ): Promise<ResolvedConnectionMap> {
    const url = `${this.config.apiUrl}/api/applications/${encodeURIComponent(appId)}/connections/resolve`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching connections from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch connections from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching connections from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response validated at API layer
    return (await response.json()) as ResolvedConnectionMap;
  }

  /**
   * Fetch custom tools for a deployment (application).
   *
   * @param appId The application/deployment ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchTools(
    appId: string,
    sessionType?: string,
    timeout = 30000,
  ): Promise<BundleToolConfig[]> {
    const sessionParam = sessionType ? `&session_type=${encodeURIComponent(sessionType)}` : '';
    const url = `${this.config.apiUrl}/api/tools?deployment=${encodeURIComponent(appId)}${sessionParam}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching tools from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch tools from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching tools from ${url}`,
      );
    }

    const data: unknown = await response.json();
    const parsed = z.array(BundleToolConfigSchema).safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid tools response from ${url}`);
    }
    return parsed.data;
  }

  /**
   * Fetch skills for a deployment (application).
   *
   * @param appId The application/deployment ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchSkills(
    appId: string,
    sessionType?: string,
    timeout = 30000,
  ): Promise<BundleSkill[]> {
    const sessionParam = sessionType ? `&session_type=${encodeURIComponent(sessionType)}` : '';
    const url = `${this.config.apiUrl}/api/skills?deployment=${encodeURIComponent(appId)}${sessionParam}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching skills from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch skills from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching skills from ${url}`,
      );
    }

    const data: unknown = await response.json();
    const parsed = z.array(BundleSkillSchema).safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid skills response from ${url}`);
    }
    return parsed.data;
  }

  /**
   * Fetch subagent (task agent) configurations for a deployment.
   *
   * @param appId The application/deployment ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchSubagents(
    appId: string,
    sessionType?: string,
    timeout = 30000,
  ): Promise<SubagentConfig[]> {
    const sessionParam = sessionType ? `&session_type=${encodeURIComponent(sessionType)}` : '';
    const url = `${this.config.apiUrl}/api/subagents?deployment=${encodeURIComponent(appId)}${sessionParam}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out fetching subagents from ${url}`, { cause: err });
      }
      throw new Error(`Failed to fetch subagents from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching subagents from ${url}`,
      );
    }

    const data: unknown = await response.json();
    const parsed = z.array(SubagentConfigSchema).safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid subagents response from ${url}`);
    }
    return parsed.data;
  }

  /**
   * Fetch connection metadata for an application.
   * Returns name, provider, and description for each connection — no credentials.
   *
   * @param appId The application ID
   * @param timeout Request timeout in ms (default 30000)
   */
  async fetchConnections(
    appId: string,
    sessionType?: string,
    timeout = 30000,
  ): Promise<ConnectionInfo[]> {
    const sessionParam = sessionType ? `?session_type=${encodeURIComponent(sessionType)}` : '';
    const url = `${this.config.apiUrl}/api/applications/${encodeURIComponent(appId)}/connections${sessionParam}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `Request timed out fetching connections from ${url}`,
          { cause: err },
        );
      }
      throw new Error(`Failed to fetch connections from ${url}`, { cause: err });
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${String(response.status)} fetching connections from ${url}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response
    const raw = (await response.json()) as Array<Record<string, unknown>>;
    return raw.map((c) => ({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting known fields
      name: c['name'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting known fields
      provider: c['provider'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting known fields
      description: c['description'] as string | undefined,
    }));
  }
}
