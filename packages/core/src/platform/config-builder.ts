/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AmodalConfigExtensions } from '../amodal-config.js';
import type { VersionManager } from '../versions/version-manager.js';
import type { AgentSDKConfig } from './platform-types.js';

/**
 * The subset of AmodalConfigExtensions that comes from version bundles
 * and SDK-level settings, plus a versionBundleVersion string.
 */
export type PlatformConfigParams = AmodalConfigExtensions & {
  versionBundleVersion?: string;
};

/**
 * Merge version config (from VersionManager) and SDK config into
 * fields suitable for the AmodalConfig constructor.
 *
 * Bundle-derived fields (tools, roles, handlers) come from versionConfig.
 * Operational fields (connections, audit, activeRole) come from sdkConfig.
 * The bundle version string is used as auditVersion.
 */
export function buildPlatformConfigParams(
  versionConfig: ReturnType<VersionManager['getVersionConfig']>,
  sdkConfig: AgentSDKConfig,
): Partial<PlatformConfigParams> {
  const params: Partial<PlatformConfigParams> = {};

  // Platform API credentials from SDK config
  if (sdkConfig.platform) {
    params.platformApiUrl = sdkConfig.platform.apiUrl;
    params.platformApiKey = sdkConfig.platform.apiKey;
  }

  // Application and tenant IDs
  if (sdkConfig.applicationId) {
    params.applicationId = sdkConfig.applicationId;
  }
  if (sdkConfig.tenantId) {
    params.tenantId = sdkConfig.tenantId;
  }

  // Agent context from SDK config (may be auto-detected from org)
  if (sdkConfig.agentContext) {
    params.agentContext = sdkConfig.agentContext;
  }

  // Disabled platform tools from SDK config (fetched from application)
  if (sdkConfig.disabledPlatformTools && sdkConfig.disabledPlatformTools.length > 0) {
    params.disabledBuiltInTools = sdkConfig.disabledPlatformTools;
  }

  // Connections from SDK config (local secrets, never from platform)
  if (sdkConfig.connections) {
    params.connections = sdkConfig.connections;
  }

  // Active role from SDK config
  if (sdkConfig.activeRole) {
    params.activeRole = sdkConfig.activeRole;
  }

  // Audit config from SDK config
  if (sdkConfig.auditConfig != null) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- audit config from SDK
    params.auditConfig = sdkConfig.auditConfig as AmodalConfigExtensions['auditConfig'];
  }
  if (sdkConfig.auditUser) {
    params.auditUser = sdkConfig.auditUser;
  }
  if (sdkConfig.auditSource) {
    params.auditSource = sdkConfig.auditSource;
  }

  // Version bundle fields
  if (versionConfig) {
    params.httpToolConfigs = versionConfig.httpToolConfigs;
    params.chainToolConfigs = versionConfig.chainToolConfigs;
    params.functionToolConfigs = versionConfig.functionToolConfigs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- handler map from version manager
    params.functionToolHandlers = versionConfig.functionToolHandlers as unknown as Record<string, unknown>;
     
    params.roleDefinitions = versionConfig.roleDefinitions as unknown[];
    params.auditVersion = versionConfig.version;
    params.versionBundleVersion = versionConfig.version;
    params.bundleSkills = versionConfig.skills;
     
    params.automationDefinitions = versionConfig.automations as unknown[];
  }

  return params;
}
