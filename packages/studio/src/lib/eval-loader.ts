/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Scans an agent repo's `evals/` directory for `.md` eval definitions
 * and upserts them into the eval_suites Postgres table.
 *
 * Called once at Studio server startup so that eval suites authored
 * on disk appear on the Evals page without manual import.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { upsertEvalSuite } from './eval-queries';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Eval markdown parser (self-contained — studio does not depend on @amodalai/core)
// ---------------------------------------------------------------------------

interface ParsedEval {
  name: string;
  title: string;
  description: string;
  query: string;
  assertions: Array<{ text: string; negated: boolean }>;
}

/**
 * Extract named `## Section` blocks from markdown content.
 */
function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const sectionRe = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const boundaries: Array<{ name: string; start: number }> = [];

  while ((match = sectionRe.exec(content)) !== null) {
    boundaries.push({
      name: match[1].trim(),
      start: match.index + match[0].length,
    });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    const end =
      i + 1 < boundaries.length
        ? boundaries[i + 1].start - boundaries[i + 1].name.length - 3
        : content.length;
    sections[boundary.name] = content.slice(boundary.start, end).trim();
  }

  return sections;
}

/**
 * Parse assertion lines from markdown list items.
 */
function parseAssertions(text: string): Array<{ text: string; negated: boolean }> {
  const assertions: Array<{ text: string; negated: boolean }> = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    const assertionText = trimmed.slice(2).trim();
    if (!assertionText) continue;
    const negated = /^Should\s+(?:NOT|not)\s+/i.test(assertionText);
    assertions.push({ text: assertionText, negated });
  }
  return assertions;
}

/**
 * Parse an eval `.md` file into a structured definition.
 */
function parseEvalFile(content: string, fileName: string): ParsedEval {
  const name = fileName.replace(/\.md$/, '');
  const titleMatch = /^#\s+(?:Eval:\s+)?(.+)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : name;

  let description = '';
  if (titleMatch) {
    const afterTitle = content.slice(titleMatch.index + titleMatch[0].length);
    const firstSection = afterTitle.search(/^##\s+/m);
    if (firstSection >= 0) {
      description = afterTitle.slice(0, firstSection).trim();
    } else {
      description = afterTitle.trim();
    }
  }

  const sections = extractSections(content);

  let query = (sections['Query'] ?? '').trim();
  const quoteMatch = /^"(.+)"$/s.exec(query);
  if (quoteMatch) {
    query = quoteMatch[1]!;
  }

  const assertions = parseAssertions(sections['Assertions'] ?? '');

  return { name, title, description, query, assertions };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Scan the `evals/` directory inside `repoPath`, parse each `.md` file,
 * and upsert the resulting eval suite into Postgres.
 *
 * Skips gracefully if the directory does not exist.
 */
export async function loadEvalsFromDisk(
  repoPath: string,
  agentId: string,
): Promise<number> {
  const evalsDir = path.join(repoPath, 'evals');

  let entries: string[];
  try {
    const dirEntries = await fs.readdir(evalsDir, { withFileTypes: true });
    entries = dirEntries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch (err: unknown) {
    // Directory doesn't exist — no evals to load
    if (err != null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      logger.debug('eval_loader_no_dir', { evalsDir });
      return 0;
    }
    throw err;
  }

  if (entries.length === 0) {
    logger.debug('eval_loader_empty', { evalsDir });
    return 0;
  }

  let loaded = 0;
  for (const fileName of entries) {
    const filePath = path.join(evalsDir, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseEvalFile(content, fileName);

      await upsertEvalSuite(agentId, parsed.name, {
        title: parsed.title,
        description: parsed.description,
        query: parsed.query,
        assertions: parsed.assertions,
        cases: parsed.query
          ? [{ input: parsed.query, expected: undefined }]
          : [],
      });

      loaded++;
    } catch (err: unknown) {
      logger.warn('eval_loader_file_error', {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('eval_loader_complete', { evalsDir, loaded, total: entries.length });
  return loaded;
}
