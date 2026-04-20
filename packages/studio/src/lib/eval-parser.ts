/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Pure eval markdown parser — no Node dependencies.
 * Used by both browser (EvalsPage, ArenaPage) and server (eval-runner).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedEval {
  name: string;
  title: string;
  description: string;
  query: string;
  assertions: Array<{ text: string; negated: boolean }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an eval `.md` file into a structured definition.
 */
export function parseEvalMarkdown(content: string, fileName: string): ParsedEval {
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
