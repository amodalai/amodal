/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';

/**
 * Schema for a single tool entry in the build manifest.
 */
export const BuildManifestToolSchema = z.object({
  /** Daytona snapshot ID for fast workspace creation */
  snapshotId: z.string().min(1),
  /** Content hash of the tool's source files */
  imageHash: z.string().min(1),
  /** Sandbox language runtime */
  sandboxLanguage: z.string().default('typescript'),
  /** Whether the tool was built from a Dockerfile */
  hasDockerfile: z.boolean().default(false),
  /** Whether the tool has a setup.sh script */
  hasSetupScript: z.boolean().default(false),
});

/**
 * Schema for .amodal/build-manifest.json.
 */
export const BuildManifestSchema = z.object({
  version: z.literal(1),
  builtAt: z.string().datetime(),
  tools: z.record(z.string(), BuildManifestToolSchema),
});

export type BuildManifest = z.infer<typeof BuildManifestSchema>;
export type BuildManifestTool = z.infer<typeof BuildManifestToolSchema>;
