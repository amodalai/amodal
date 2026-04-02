/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';

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

