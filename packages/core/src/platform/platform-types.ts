/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import type { ConnectionsMap } from '../templates/connections.js';

/**
 * Metadata about a connected system (name, provider, description).
 * Used to inform the agent about available systems without exposing credentials.
 */
export interface ConnectionInfo {
  name: string;
  provider: string;
  description?: string;
}

/**
 * Zod schema for platform API configuration.
 */
export const PlatformConfigSchema = z.object({
  /** Platform API URL (e.g., "https://platform.company.com") */
  apiUrl: z.string().url(),
  /** Platform API key for authentication */
  apiKey: z.string().min(1),
  /** Deployment identifier (e.g., "prod", "staging"). Optional when using JWT auth without bundle fetching. */
  deployment: z.string().min(1).optional(),
});

/**
 * Platform API connection configuration.
 */
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

/**
 * Configuration for initializing the AgentSDK.
 *
 * Three config concerns:
 * - platform/localBundlePath: where to get tool/role/skill definitions
 * - connections: customer's backend URLs + secrets (never sent to platform)
 * - audit/role: operational configuration
 */
export interface AgentSDKConfig {
  /** Fetch bundle from platform API */
  platform?: PlatformConfig;
  /** Fallback: load bundle from a local file */
  localBundlePath?: string;
  /** Backend API connection secrets (resolved locally, never sent to platform) */
  connections?: ConnectionsMap;
  /** Role to activate for this session */
  activeRole?: string;
  /** Audit logging configuration */
  auditConfig?: unknown;
  /** User identifier for audit entries */
  auditUser?: string;
  /** Source identifier for audit entries (e.g., "interactive", "automation:zone-monitor") */
  auditSource?: string;
  /** Base directory for version file storage (defaults to os.tmpdir()) */
  versionBaseDir?: string;
  /** Application ID for fetching application-level knowledge base */
  applicationId?: string;
  /** Tenant ID for fetching tenant-level knowledge base */
  tenantId?: string;
  /** Agent context override (auto-detected from org if not set) */
  agentContext?: string;
  /** Platform tools to disable (e.g. shell_exec, load_knowledge) */
  disabledPlatformTools?: string[];
  /** Model for simple/data-gathering subagent tasks (falls back to default model) */
  simpleModel?: string;
  /** Model for advanced/reasoning subagent tasks (falls back to default model) */
  advancedModel?: string;
  /** Session type to pass as query parameter when fetching platform resources */
  sessionType?: string;
  /** Specific deployment ID to load instead of the active deployment */
  deployId?: string;
}
