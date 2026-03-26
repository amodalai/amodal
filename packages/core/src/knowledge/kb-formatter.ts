/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { KBDocument, DocumentCategory } from './kb-types.js';

/**
 * Display order and names for document categories.
 * Application-level first, then tenant-level.
 */
const CATEGORY_ORDER: DocumentCategory[] = [
  // Application-level categories
  'system_docs',
  'methodology',
  'patterns',
  'false_positives',
  'response_procedures',
  // Tenant-level categories
  'environment',
  'baselines',
  'team',
  'incident_history',
  'working_memory',
];

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
 * Format documents grouped by category into a markdown section.
 * Documents with legacy categories are normalized to new names before grouping.
 */
function formatDocsByCategory(docs: KBDocument[]): string {
  const sections: string[] = [];

  for (const category of CATEGORY_ORDER) {
    const categoryDocs = docs.filter(
      (d) => d.category === category,
    );
    if (categoryDocs.length === 0) continue;

    const heading = CATEGORY_DISPLAY_NAMES[category];
    const docEntries = categoryDocs
      .map((d) => `### ${d.title}\n${d.body}`)
      .join('\n\n');
    sections.push(`## ${heading}\n${docEntries}`);
  }

  return sections.join('\n\n');
}

/**
 * Format org-level and segment-level knowledge base documents into a
 * markdown string suitable for injection into the system prompt.
 *
 * Documents with legacy category names are automatically normalized.
 * Empty categories are omitted.
 * Returns empty string when no documents exist.
 */
export function formatKnowledgeBase(
  appDocs: KBDocument[],
  tenantDocs: KBDocument[],
): string {
  const sections: string[] = [];

  if (appDocs.length > 0) {
    const appContent = formatDocsByCategory(appDocs);
    if (appContent) {
      sections.push(
        `# Application Knowledge\n(product-level domain expertise, shared across all tenants)\n\n${appContent}`,
      );
    }
  }

  if (tenantDocs.length > 0) {
    const tenantContent = formatDocsByCategory(tenantDocs);
    if (tenantContent) {
      sections.push(
        `# Tenant Knowledge\n(specific to this deployment)\n\n${tenantContent}`,
      );
    }
  }

  return sections.join('\n\n');
}
