/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * HTTP-backed file tools — same tool names and schemas as the local file-tools,
 * but reads/writes go through a remote runtime's workspace API via HttpFsBackend.
 *
 * Used when the admin agent runs on a different machine than the main agent
 * (Cloud mode). Set WORKSPACE_API_URL to activate.
 */

import {z} from 'zod';
import type {ToolRegistry} from './types.js';
import type {FsBackend} from '@amodalai/types';
import type {Logger} from '../logger.js';

export interface HttpFileToolsOptions {
  fs: FsBackend;
  logger: Logger;
}

export function registerHttpFileTools(registry: ToolRegistry, opts: HttpFileToolsOptions): void {
  const {fs, logger} = opts;

  registry.register('read_repo_file', {
    description: 'Read a file from the agent repository.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within the repo'),
      offset: z.number().optional().describe('Line offset to start reading from'),
      limit: z.number().optional().describe('Max number of lines to return'),
    }),
    readOnly: true,
    metadata: {category: 'system'},
    async execute(params: {path: string; offset?: number; limit?: number}): Promise<unknown> {
      try {
        logger.debug('file_tool_call', {tool: 'read_repo_file', path: params.path});
        let content = await fs.readRepoFile(params.path);
        if (params.offset !== undefined || params.limit !== undefined) {
          const lines = content.split('\n');
          const start = params.offset ?? 0;
          const end = params.limit !== undefined ? start + params.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return content;
      } catch (err) {
        return {error: err instanceof Error ? err.message : String(err)};
      }
    },
  });

  registry.register('write_repo_file', {
    description: 'Write content to a file in the agent repository. Creates parent directories as needed.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within the repo'),
      content: z.string().describe('The content to write to the file'),
    }),
    readOnly: false,
    metadata: {category: 'system'},
    async execute(params: {path: string; content: string}): Promise<unknown> {
      try {
        logger.debug('file_tool_call', {tool: 'write_repo_file', path: params.path});
        await fs.writeRepoFile(params.path, params.content);
        return {ok: true, path: params.path};
      } catch (err) {
        return {error: err instanceof Error ? err.message : String(err)};
      }
    },
  });

  registry.register('edit_repo_file', {
    description: 'Edit a file by replacing a specific string. Use for targeted changes.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file'),
      old_string: z.string().describe('The exact text to find'),
      new_string: z.string().describe('The replacement text'),
    }),
    readOnly: false,
    metadata: {category: 'system'},
    async execute(params: {path: string; old_string: string; new_string: string}): Promise<unknown> {
      try {
        logger.debug('file_tool_call', {tool: 'edit_repo_file', path: params.path});
        const content = await fs.readRepoFile(params.path);
        if (!content.includes(params.old_string)) {
          return {error: `String not found in ${params.path}`};
        }
        const updated = content.replace(params.old_string, params.new_string);
        await fs.writeRepoFile(params.path, updated);
        return {ok: true, path: params.path};
      } catch (err) {
        return {error: err instanceof Error ? err.message : String(err)};
      }
    },
  });

  registry.register('delete_repo_file', {
    description: 'Delete a file from the agent repository.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file'),
    }),
    readOnly: false,
    metadata: {category: 'system'},
    async execute(params: {path: string}): Promise<unknown> {
      try {
        logger.debug('file_tool_call', {tool: 'delete_repo_file', path: params.path});
        await fs.deleteRepoFile(params.path);
        return {ok: true, path: params.path};
      } catch (err) {
        return {error: err instanceof Error ? err.message : String(err)};
      }
    },
  });

  registry.register('list_repo_files', {
    description: 'List files and directories at a path in the agent repository.',
    parameters: z.object({
      dir: z.string().optional().describe('Directory to list (default: repo root)'),
    }),
    readOnly: true,
    metadata: {category: 'system'},
    async execute(params: {dir?: string}): Promise<unknown> {
      try {
        logger.debug('file_tool_call', {tool: 'list_repo_files', dir: params.dir});
        const listing = await fs.listRepoFiles(params.dir ?? '.');
        const entries: string[] = [
          ...listing.directories.map((d) => `${d}/`),
          ...listing.files,
        ];
        return entries.join('\n') || '(empty directory)';
      } catch (err) {
        return {error: err instanceof Error ? err.message : String(err)};
      }
    },
  });

  registry.register('read_many_repo_files', {
    description: 'Read multiple files at once. Missing files are silently skipped.',
    parameters: z.object({
      paths: z.array(z.string()).describe('Array of relative file paths'),
    }),
    readOnly: true,
    metadata: {category: 'system'},
    async execute(params: {paths: string[]}): Promise<unknown> {
      try {
        logger.debug('file_tool_call', {tool: 'read_many_repo_files', count: params.paths.length});
        const files = await fs.readManyRepoFiles(params.paths);
        return files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
      } catch (err) {
        return {error: err instanceof Error ? err.message : String(err)};
      }
    },
  });

  logger.debug('http_file_tools_registered', {tools: 6});
}
