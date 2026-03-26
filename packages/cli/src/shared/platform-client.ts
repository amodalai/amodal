/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {DeploySnapshot} from '@amodalai/core';
import {readProjectLink} from '../commands/link.js';
import {readRcFile} from '../commands/login.js';

/**
 * Metadata returned for a snapshot deployment.
 */
export interface SnapshotDeploymentMeta {
  id: string;
  environment: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  source: string;
  commitSha?: string;
  branch?: string;
  message?: string;
  snapshotSize: number;
}

/**
 * Resolve platform URL and API key from multiple sources:
 * 1. Explicit options (flags)
 * 2. .amodal/project.json (platformUrl from `amodal link`)
 * 3. ~/.amodalrc (auth token from `amodal login`)
 * 4. Env vars (fallback)
 */
export async function resolvePlatformConfig(options?: {
  url?: string;
  apiKey?: string;
}): Promise<{url: string; apiKey: string}> {
  let url = options?.url;
  let apiKey = options?.apiKey;

  // Try project link for URL
  if (!url) {
    const link = await readProjectLink();
    if (link?.platformUrl) {
      url = link.platformUrl;
    }
  }

  // Try rc file for auth token
  if (!apiKey) {
    const rc = await readRcFile();
    if (rc.platform?.token) {
      apiKey = rc.platform.token;
      // Also use the URL from rc if still missing
      if (!url && rc.platform.url) {
        url = rc.platform.url;
      }
    }
  }

  // Env vars as fallback
  if (!url) url = process.env['PLATFORM_API_URL'];
  if (!apiKey) apiKey = process.env['PLATFORM_API_KEY'];

  if (!url) throw new Error('Platform URL not found. Run `amodal login` + `amodal link`, or set PLATFORM_API_URL.');
  if (!apiKey) throw new Error('Platform auth not found. Run `amodal login`, or set PLATFORM_API_KEY.');

  return {url: url.replace(/\/$/, ''), apiKey};
}

/**
 * Platform API client for snapshot deployments.
 *
 * Resolves credentials from: explicit options → project link → rc file → env vars.
 * Use `PlatformClient.create()` for async auto-discovery, or `new PlatformClient()` for sync usage.
 */
export class PlatformClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options?: {url?: string; apiKey?: string}) {
    const url = options?.url ?? process.env['PLATFORM_API_URL'];
    const apiKey = options?.apiKey ?? process.env['PLATFORM_API_KEY'];
    if (!url) throw new Error('Platform URL not found. Run `amodal login` + `amodal link`, or set PLATFORM_API_URL.');
    if (!apiKey) throw new Error('Platform auth not found. Run `amodal login`, or set PLATFORM_API_KEY.');
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Create a PlatformClient with auto-discovery of credentials.
   * Resolves from: explicit options → project link → rc file → env vars.
   */
  static async create(options?: {url?: string; apiKey?: string}): Promise<PlatformClient> {
    const config = await resolvePlatformConfig(options);
    return new PlatformClient(config);
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      method,
      headers: this.headers(),
      ...(body ? {body: JSON.stringify(body)} : {}),
    });

    if (!resp.ok) {
      let detail = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const errBody = await resp.json() as {error?: string};
        detail = errBody.error ? `: ${errBody.error}` : '';
      } catch {
        // ignore parse errors
      }
      throw new Error(`Platform API ${method} ${path} failed (${resp.status})${detail}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return resp.json() as Promise<T>;
  }

  /**
   * Upload a snapshot and deploy it.
   */
  async uploadSnapshot(snapshot: DeploySnapshot, options: {
    environment?: string;
  } = {}): Promise<SnapshotDeploymentMeta> {
    return this.request<SnapshotDeploymentMeta>('POST', '/api/snapshot-deployments', {
      snapshot,
      environment: options.environment ?? 'production',
    });
  }

  /**
   * List deployments for the authenticated tenant.
   */
  async listDeployments(options: {
    environment?: string;
    limit?: number;
  } = {}): Promise<SnapshotDeploymentMeta[]> {
    const params = new URLSearchParams();
    if (options.environment) params.set('environment', options.environment);
    if (options.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<SnapshotDeploymentMeta[]>('GET', `/api/snapshot-deployments${qs ? `?${qs}` : ''}`);
  }

  /**
   * Rollback to a previous deployment.
   */
  async rollback(options: {
    deployId?: string;
    environment?: string;
  } = {}): Promise<SnapshotDeploymentMeta> {
    return this.request<SnapshotDeploymentMeta>('POST', '/api/snapshot-deployments/rollback', {
      deployId: options.deployId,
      environment: options.environment ?? 'production',
    });
  }

  /**
   * Promote a deployment from one environment to another.
   */
  async promote(fromEnv: string, toEnv: string = 'production'): Promise<SnapshotDeploymentMeta> {
    return this.request<SnapshotDeploymentMeta>('POST', '/api/snapshot-deployments/promote', {
      fromEnvironment: fromEnv,
      toEnvironment: toEnv,
    });
  }

  /**
   * Get status of a specific deployment.
   */
  async getStatus(deployId: string): Promise<SnapshotDeploymentMeta> {
    return this.request<SnapshotDeploymentMeta>('GET', `/api/snapshot-deployments/${deployId}`);
  }

  /**
   * Get the active snapshot for an environment.
   */
  async getActiveSnapshot(environment: string = 'production'): Promise<DeploySnapshot> {
    const params = new URLSearchParams({environment});
    return this.request<DeploySnapshot>('GET', `/api/snapshot-deployments/active?${params.toString()}`);
  }
}
