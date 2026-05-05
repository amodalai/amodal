/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';

import type {LoadedTool, ToolHandlerDefinition} from './tool-types.js';
import {ToolJsonSchema, TOOL_NAME_REGEX} from './tool-types.js';
import {RepoError} from './repo-types.js';

/**
 * List subdirectories in a directory. Returns [] if dir doesn't exist.
 */
async function listSubdirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Validate that a directory name is a valid tool name.
 */
function validateToolName(dirName: string): void {
  if (!TOOL_NAME_REGEX.test(dirName)) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Tool directory "${dirName}" is not a valid tool name. ` +
      'Tool names must be snake_case (lowercase letters, digits, underscores), starting with a letter.',
    );
  }
}

/**
 * Load a tool that has a tool.json file.
 */
async function loadToolWithJson(
  toolDir: string,
  dirName: string,
  handlerPath: string,
): Promise<LoadedTool> {
  const toolJsonPath = path.join(toolDir, 'tool.json');
  let toolJsonContent: string;
  try {
    toolJsonContent = await readFile(toolJsonPath, 'utf-8');
  } catch {
    throw new RepoError(
      'CONFIG_NOT_FOUND',
      `Missing tool.json for tool "${dirName}" at ${toolJsonPath}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(toolJsonContent);
  } catch (err) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid JSON in tool.json for tool "${dirName}"`,
      err,
    );
  }

  const parsed = ToolJsonSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Invalid tool.json for tool "${dirName}": ${issues}`,
    );
  }

  const toolJson = parsed.data;

  // If name is provided, it must match the directory name
  if (toolJson.name && toolJson.name !== dirName) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Tool name "${toolJson.name}" in tool.json does not match directory name "${dirName}". ` +
      'Either remove the name field (directory name is used) or make them match.',
    );
  }

  const [hasPackageJson, hasSetupScript, hasRequirementsTxt, hasDockerfile] = await Promise.all([
    fileExists(path.join(toolDir, 'package.json')),
    fileExists(path.join(toolDir, 'setup.sh')),
    fileExists(path.join(toolDir, 'requirements.txt')),
    fileExists(path.join(toolDir, 'Dockerfile')),
  ]);

  const loaded: LoadedTool = {
    name: dirName,
    description: toolJson.description,
    parameters: toolJson.parameters,
    confirm: toolJson.confirm,
    timeout: toolJson.timeout,
    env: toolJson.env,
    handlerPath,
    location: toolDir,
    hasPackageJson,
    hasSetupScript,
    hasRequirementsTxt,
    hasDockerfile,
    sandboxLanguage: toolJson.sandbox?.language ?? 'typescript',
  };

  if (toolJson.responseShaping) {
    loaded.responseShaping = toolJson.responseShaping;
  }

  if (toolJson.runningLabel) {
    loaded.runningLabel = toolJson.runningLabel;
  }
  if (toolJson.completedLabel) {
    loaded.completedLabel = toolJson.completedLabel;
  }

  return loaded;
}

/**
 * Check if a value is a ToolHandlerDefinition (from defineToolHandler).
 */
function isToolHandlerDefinition(value: unknown): value is ToolHandlerDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__toolHandler' in value &&
    value['__toolHandler'] === true
  );
}

/**
 * Load a tool from handler.ts metadata (no tool.json).
 *
 * Supports two patterns:
 *
 * 1. defineToolHandler default export:
 *    ```ts
 *    export default defineToolHandler({
 *      description: '...',
 *      parameters: { ... },
 *      handler: async (params, ctx) => { ... }
 *    })
 *    ```
 *
 * 2. Named exports:
 *    ```ts
 *    export const description = '...'
 *    export const parameters = { ... }
 *    export default async (params, ctx) => { ... }
 *    ```
 */
async function loadToolFromHandler(
  toolDir: string,
  dirName: string,
  handlerPath: string,
): Promise<LoadedTool> {
  // We can't dynamically import at load time in the core package
  // (handler.ts is TypeScript that hasn't been compiled).
  // Instead, we read the file and extract metadata from export statements.
  let content: string;
  try {
    content = await readFile(handlerPath, 'utf-8');
  } catch {
    throw new RepoError(
      'READ_FAILED',
      `Failed to read handler.ts for tool "${dirName}"`,
    );
  }

  // Look for a defineToolHandler call — if present, we'll extract metadata at runtime.
  // For load-time, extract the description from the source text.
  const meta = extractHandlerMetadata(content, dirName);

  const [hasPackageJson, hasSetupScript, hasRequirementsTxt, hasDockerfile] = await Promise.all([
    fileExists(path.join(toolDir, 'package.json')),
    fileExists(path.join(toolDir, 'setup.sh')),
    fileExists(path.join(toolDir, 'requirements.txt')),
    fileExists(path.join(toolDir, 'Dockerfile')),
  ]);

  return {
    name: dirName,
    description: meta.description,
    parameters: meta.parameters ?? {},
    confirm: meta.confirm ?? false,
    timeout: meta.timeout ?? 30000,
    env: meta.env ?? [],
    handlerPath,
    location: toolDir,
    hasPackageJson,
    hasSetupScript,
    hasRequirementsTxt,
    hasDockerfile,
    sandboxLanguage: 'typescript',
  };
}

/**
 * Extract tool metadata from handler.ts source text.
 *
 * Looks for patterns like:
 *   export const description = "..."
 *   export const description = '...'
 *   defineToolHandler({ description: "..." })
 */
function extractHandlerMetadata(
  source: string,
  dirName: string,
): {
  description: string;
  parameters?: Record<string, unknown>;
  confirm?: false | true | 'review' | 'never';
  timeout?: number;
  env?: string[];
} {
  // Try to find description from named export
  const descMatch = source.match(
    /export\s+const\s+description\s*=\s*(['"`])([\s\S]*?)\1/,
  );
  if (descMatch) {
    return {description: descMatch[2]};
  }

  // Try to find description from defineToolHandler call
  const defineMatch = source.match(
    /defineToolHandler\s*\(\s*\{[^}]*description\s*:\s*(['"`])([\s\S]*?)\1/,
  );
  if (defineMatch) {
    return {description: defineMatch[2]};
  }

  throw new RepoError(
    'CONFIG_VALIDATION_FAILED',
    `Tool "${dirName}" has no tool.json and no description found in handler.ts. ` +
    'Either create a tool.json with a description, use defineToolHandler({ description: "..." }), ' +
    'or add: export const description = "..."',
  );
}

/**
 * Load all custom tools from the tools/ directory.
 *
 * Each tool is a subdirectory containing either:
 *
 * **Option A — tool.json + handler.ts:**
 * ```
 * tools/my_tool/
 *   tool.json      ← { "description": "...", "parameters": { ... } }
 *   handler.ts     ← export default async (params, ctx) => { ... }
 * ```
 *
 * **Option B — handler.ts only (single-file tool):**
 * ```
 * tools/my_tool/
 *   handler.ts     ← export default defineToolHandler({ description: "...", handler: ... })
 * ```
 *
 * The tool name is always the directory name (must be snake_case).
 * Missing tools/ directory returns [].
 */
export async function loadTools(repoPath: string): Promise<LoadedTool[]> {
  const toolsDir = path.join(repoPath, 'tools');
  const dirs = await listSubdirs(toolsDir);

  if (dirs.length === 0) {
    return [];
  }

  const results = await Promise.all(
    dirs.map(async (dirName) => {
      const toolDir = path.join(toolsDir, dirName);

      // Validate directory name is a valid tool name
      validateToolName(dirName);

      // handler.ts is always required
      const handlerPath = path.join(toolDir, 'handler.ts');
      if (!(await fileExists(handlerPath))) {
        throw new RepoError(
          'CONFIG_NOT_FOUND',
          `Missing handler.ts for tool "${dirName}" at ${handlerPath}`,
        );
      }

      // If tool.json exists, use it for metadata
      const hasToolJson = await fileExists(path.join(toolDir, 'tool.json'));
      if (hasToolJson) {
        return loadToolWithJson(toolDir, dirName, handlerPath);
      }

      // Otherwise, extract metadata from handler.ts
      return loadToolFromHandler(toolDir, dirName, handlerPath);
    }),
  );

  return results;
}

// Re-export for use by the runtime when loading defineToolHandler modules
export {isToolHandlerDefinition};
