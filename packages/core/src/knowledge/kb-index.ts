/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { KBDocument, DocumentCategory, ScopeType } from './kb-types.js';

/**
 * A compact index entry for a KB document (used in the system prompt
 * instead of loading the full body).
 */
export interface KBIndexEntry {
  id: string;
  title: string;
  category: DocumentCategory;
  tags: string[];
  scope_type: ScopeType;
}

/**
 * Build a list of index entries from KB documents.
 */
export function buildKnowledgeIndex(docs: KBDocument[]): KBIndexEntry[] {
  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    category: doc.category,
    tags: doc.tags,
    scope_type: doc.scope_type,
  }));
}

const CATEGORY_DISPLAY_NAMES: Record<DocumentCategory, string> = {
  system_docs: 'System Documentation',
  methodology: 'Methodology',
  patterns: 'Patterns',
  false_positives: 'False Positive Patterns',
  response_procedures: 'Response Procedures',
  environment: 'Environment',
  baselines: 'Baselines',
  team: 'Team',
  incident_history: 'Incident History',
  working_memory: 'Working Memory',
};

/**
 * Format KB documents as a compact index table for the system prompt.
 * Shows title, category, tags, and ID.
 * The agent can then use `load_knowledge` to fetch full bodies on demand.
 */
export function formatKnowledgeIndex(
  appDocs: KBDocument[],
): string {
  const sections: string[] = [];

  if (appDocs.length > 0) {
    sections.push(formatScopeIndex('Application', appDocs));
  }

  if (sections.length === 0) {
    return (
      '# Knowledge Base\n\n' +
      'No knowledge base documents are available. This means no connections have been configured yet — ' +
      'the agent has no system documentation, no credentials, and no domain knowledge to work with.\n\n' +
      'When the analyst asks you to investigate, triage, or scan systems, let them know that ' +
      'no connections are configured and suggest setting up connections through the admin UI first.\n\n' +
      'You can still have a general conversation, answer questions about investigation methodology, ' +
      'or help the analyst plan their setup.'
    );
  }

  return (
    `# Available Knowledge Base\nUse \`load_knowledge\` to load documents when you need their content.\n\n` +
    sections.join('\n\n')
  );
}

function formatScopeIndex(scopeLabel: string, docs: KBDocument[]): string {
  const header = `## ${scopeLabel} Knowledge (${String(docs.length)} document${docs.length === 1 ? '' : 's'})`;
  const tableHeader = '| Title | Category | Tags | ID |';
  const tableSep = '| --- | --- | --- | --- |';
  const rows = docs.map((doc) => {
    const displayCategory = CATEGORY_DISPLAY_NAMES[doc.category];
    const tags = doc.tags.length > 0 ? doc.tags.join(', ') : '-';
    return `| ${doc.title} | ${displayCategory} | ${tags} | ${doc.id} |`;
  });
  return [header, tableHeader, tableSep, ...rows].join('\n');
}
