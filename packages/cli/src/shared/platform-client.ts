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
    let resp = await fetch(url, {
      method,
      headers: this.headers(),
      ...(body ? {body: JSON.stringify(body)} : {}),
    });

    // Auto-refresh on 401
    if (resp.status === 401) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        resp = await fetch(url, {
          method,
          headers: this.headers(),
          ...(body ? {body: JSON.stringify(body)} : {}),
        });
      }
    }

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
   * Try to refresh the token using the stored refresh token.
   * Updates both the in-memory key and the rc file on success.
   */
  private async tryRefreshToken(): Promise<boolean> {
    try {
      const {readRcFile} = await import('../commands/login.js');
      const rc = await readRcFile();
      if (!rc.platform?.refreshToken) return false;

      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({refresh_token: rc.platform.refreshToken}),
      });
      if (!res.ok) return false;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const data = (await res.json()) as {access_token?: string; refresh_token?: string};
      if (!data.access_token) return false;

      // Update in-memory
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- private field update
      (this as unknown as {apiKey: string}).apiKey = data.access_token;

      // Persist to rc file
      rc.platform.token = data.access_token;
      if (data.refresh_token) rc.platform.refreshToken = data.refresh_token;
      const {writeFile} = await import('node:fs/promises');
      const {homedir} = await import('node:os');
      const path = await import('node:path');
      const rcPath = path.join(homedir(), '.amodalrc');
      await writeFile(rcPath, JSON.stringify(rc, null, 2) + '\n', {mode: 0o600});

      process.stderr.write('[auth] Token refreshed automatically.\n');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Upload a snapshot and deploy it.
   */
  async uploadSnapshot(snapshot: DeploySnapshot, options: {
    environment?: string;
    appId?: string;
  } = {}): Promise<SnapshotDeploymentMeta> {
    return this.request<SnapshotDeploymentMeta>('POST', '/api/snapshot-deployments', {
      snapshot,
      environment: options.environment ?? 'production',
      appId: options.appId,
    });
  }

  /**
   * Trigger a runtime-app build on the build server.
   * Sends the repo tarball to the build server which builds the SPA and uploads to R2.
   */
  async triggerBuild(
    buildServerUrl: string,
    appId: string,
    deployId: string,
    repoTarball: import('node:fs').ReadStream,
  ): Promise<void> {
    const url = `${buildServerUrl}/build`;

    const formData = new FormData();
    formData.append('appId', appId);
    formData.append('deployId', deployId);

    // Convert ReadStream to Blob for FormData
    const chunks: Uint8Array[] = [];
    for await (const chunk of repoTarball) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ReadStream chunks are Buffer/Uint8Array
      chunks.push(chunk as Uint8Array);
    }
    const blob = new Blob(chunks, {type: 'application/gzip'});
    formData.append('repo', blob, 'repo.tar.gz');

    const resp = await fetch(url, {
      method: 'POST',
      headers: {Authorization: `Bearer ${this.apiKey}`},
      body: formData,
    });

    if (!resp.ok) {
      let detail = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const errBody = await resp.json() as {error?: string; message?: string};
        detail = errBody.message ?? errBody.error ?? '';
      } catch { /* ignore */ }
      throw new Error(`Build server failed (${resp.status}): ${detail}`);
    }
  }

  /**
   * Trigger a remote build:
   * 1. Get a presigned R2 upload URL from the platform API
   * 2. Upload the tarball directly to R2
   * 3. Tell the platform API to trigger a Fly Machine build
   *
   * Returns a buildId for polling.
   */
  async triggerRemoteBuild(
    appId: string,
    environment: string,
    tarballPath: string,
    message?: string,
  ): Promise<{ buildId: string }> {
    // Step 1: Get presigned upload URL
     
    const uploadInfo = await this.request<{buildId: string; tarballKey: string; uploadUrl: string}>(
      'POST',
      '/api/deploys/build?action=upload-url',
      {appId},
    );

    // Step 2: Upload tarball directly to R2
    const {readFileSync} = await import('node:fs');
    const tarball = readFileSync(tarballPath);

    const uploadResp = await fetch(uploadInfo.uploadUrl, {
      method: 'PUT',
      headers: {'Content-Type': 'application/gzip'},
      body: tarball,
    });

    if (!uploadResp.ok) {
      throw new Error(`Tarball upload failed: ${uploadResp.status}`);
    }

    // Step 3: Trigger the build
     
    const result = await this.request<{buildId: string}>(
      'POST',
      '/api/deploys/build?action=trigger',
      {appId, tarballKey: uploadInfo.tarballKey, environment, message},
    );

    return result;
  }

  /**
   * Poll build status.
   */
  async getBuildStatus(buildId: string): Promise<{
    status: 'building' | 'complete' | 'error';
    deployId?: string;
    environment?: string;
    error?: string;
  }> {
    return this.request('GET', `/api/builds/${encodeURIComponent(buildId)}/status`);
  }

  /**
   * List deployments for the authenticated app.
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
