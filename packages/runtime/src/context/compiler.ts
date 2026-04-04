/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Context Compiler (Phase 3.2).
 *
 * Standalone module that compiles an agent's configuration into a system
 * prompt string. This is the SINGLE place where prompt compilation happens.
 *
 * Replaces the scattered logic across session-manager.ts and inspect.ts
 * that manually assembled buildDefaultPrompt() inputs from bundle data.
 *
 * The compiler takes raw bundle-level objects (connections, skills,
 * knowledge, stores) and handles all intermediate processing internally:
 * - Field guidance generation from connection access configs
 * - Scope label resolution from row scoping rules
 * - Alternative lookup guidance from connection configs
 * - Store schema rendering
 */

import type {StoreFieldDefinition} from '@amodalai/types';
import type {
  CompilerInput,
  CompilerOutput,
  CompilerConnection,
  CompilerContribution,
} from './types.js';

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Field guidance (internalized from user-context.ts)
// ---------------------------------------------------------------------------

function generateFieldGuidance(
  connections: CompilerConnection[],
  userRoles: string[],
): string {
  const lines: string[] = [];

  for (const conn of connections) {
    if (!conn.fieldRestrictions || conn.fieldRestrictions.length === 0) continue;

    for (const r of conn.fieldRestrictions) {
      if (r.policy === 'never_retrieve') {
        const reason = r.reason ? ` (${r.reason})` : '';
        lines.push(`Do not request: ${r.entity}.${r.field}${reason}`);
      } else if (r.policy === 'role_gated') {
        const allowed = r.allowedRoles ?? [];
        const hasAccess = userRoles.some((role) => allowed.includes(role));
        if (!hasAccess) {
          lines.push(
            `Do not request: ${r.entity}.${r.field} (requires role: ${allowed.join(', ')})`,
          );
        }
      } else if (r.policy === 'retrieve_but_redact') {
        lines.push(`Will be redacted: ${r.entity}.${r.field}`);
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Scope labels
// ---------------------------------------------------------------------------

function resolveScopeLabels(
  connections: CompilerConnection[],
  userRoles: string[],
): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const conn of connections) {
    if (!conn.rowScoping) continue;

    for (const [entity, roleMap] of Object.entries(conn.rowScoping)) {
      if (labels[entity]) continue; // already resolved from a prior connection

      for (const role of userRoles) {
        const rule = roleMap[role];
        if (rule) {
          labels[entity] = rule.label ?? `scoped by ${rule.type}`;
          break;
        }
      }
    }
  }

  return labels;
}

// ---------------------------------------------------------------------------
// Alternative lookup guidance
// ---------------------------------------------------------------------------

function generateAlternativeLookupGuidance(
  connections: CompilerConnection[],
): string {
  const lines: string[] = [];

  for (const conn of connections) {
    if (!conn.alternativeLookups || conn.alternativeLookups.length === 0) continue;

    for (const lookup of conn.alternativeLookups) {
      const desc = lookup.description ? ` — ${lookup.description}` : '';
      lines.push(
        `Instead of ${lookup.restrictedField}, use ${lookup.alternativeEndpoint}${desc}`,
      );
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Store schema rendering
// ---------------------------------------------------------------------------

function renderFieldType(field: StoreFieldDefinition): string {
  switch (field.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'datetime':
      return field.nullable ? `${field.type} | null` : field.type;
    case 'enum':
      return field.values ? field.values.join(' | ') : 'enum';
    case 'array':
      return field.item ? `${renderFieldType(field.item)}[]` : 'array';
    case 'object':
      return 'object';
    case 'ref':
      return field.store ? `ref → ${field.store}` : 'ref';
    default: {
      const _exhaustive: never = field.type;
      return String(_exhaustive);
    }
  }
}

function renderStoreSection(
  stores: Array<{name: string; entity: {name: string; key: string; schema: Record<string, StoreFieldDefinition>}}>,
): string {
  const parts: string[] = ['## Data Stores', ''];

  for (const store of stores) {
    parts.push(`### ${store.name}`);
    parts.push(`Entity: ${store.entity.name} (key: \`${store.entity.key}\`)`);
    parts.push('');
    parts.push('| Field | Type |');
    parts.push('| ----- | ---- |');
    for (const [name, field] of Object.entries(store.entity.schema)) {
      parts.push(`| ${name} | ${renderFieldType(field)} |`);
    }
    parts.push('');
    parts.push('Use the store tools (`write_<store>`, `batch_<store>`, `query_stores`) to read and write data.');
    parts.push('');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main compiler
// ---------------------------------------------------------------------------

/**
 * Compile an agent's configuration into a system prompt.
 *
 * This is the single entry point for prompt compilation. It replaces the
 * scattered buildDefaultPrompt() callsites in session-manager and inspect.
 */
export function compileContext(input: CompilerInput): CompilerOutput {
  // Short-circuit: if basePrompt is set, use it directly
  if (input.basePrompt) {
    return {
      systemPrompt: input.basePrompt,
      source: 'base_prompt_override',
      contributions: [{name: 'Base prompt override', category: 'system', tokens: estimateTokens(input.basePrompt)}],
    };
  }

  const parts: string[] = [];
  const contributions: CompilerContribution[] = [];

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------
  const identity = `You are ${input.name}${input.description ? ` — ${input.description}` : ''}.`;
  parts.push(identity);
  parts.push('');

  // -------------------------------------------------------------------------
  // User context (standing instructions for this deployment)
  // -------------------------------------------------------------------------
  if (input.userContext) {
    parts.push(input.userContext);
    parts.push('');
  }

  // -------------------------------------------------------------------------
  // Agent override (custom prompt from agents/main.md)
  // -------------------------------------------------------------------------
  if (input.agentOverride) {
    parts.push(input.agentOverride);
    parts.push('');
    contributions.push({name: 'Agent override', category: 'system', tokens: estimateTokens(input.agentOverride)});
  }

  // -------------------------------------------------------------------------
  // Core behavior
  // -------------------------------------------------------------------------
  const coreBehavior = `## How you work

- Use the **request** tool to query connected systems. Always specify the connection name, HTTP method, endpoint, and intent (read or write).
- Answer straightforward questions directly. If the user asks for a list, give them a complete list with all requested fields — don't summarize or editorialize. Save analysis and recommendations for when they're asked for.
- Write operations require user confirmation unless the user has explicitly approved the action.
- Never fabricate data. If a query returns no results, say so. If you're uncertain, ask.
- When the user's question requires data from external systems, always query first — do not guess.
- Keep responses concise and grounded in the data you retrieve.`;
  parts.push(coreBehavior);
  parts.push('');

  // -------------------------------------------------------------------------
  // Error handling guidance
  // -------------------------------------------------------------------------
  const errorGuidance = `## Error handling

- If a query returns empty results, try different parameters before giving up (e.g. broader filters, different sort/state).
- If a tool call returns an error, report it clearly to the user with the connection name and what went wrong.
- On 401/403 errors: tell the user their credentials may be misconfigured. Do not retry.
- On network errors: tell the user the service appears unreachable. Do not retry.
- If a connection name is not recognized, use the suggestion from the error message.`;
  parts.push(errorGuidance);
  parts.push('');

  const baseTokens = estimateTokens(identity + coreBehavior + errorGuidance);
  contributions.push({name: 'Base prompt', category: 'system', tokens: baseTokens});

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------
  if (input.connections && input.connections.length > 0) {
    parts.push('## Connected systems');
    parts.push('');

    for (const conn of input.connections) {
      const connParts: string[] = [];
      connParts.push(`### Connection: ${conn.name}`);
      if (conn.description) {
        connParts.push(conn.description);
      }
      if (conn.endpoints.length > 0) {
        connParts.push('');
        connParts.push('**Available Endpoints:**');
        for (const ep of conn.endpoints) {
          connParts.push(`- ${ep.method} ${ep.path} — ${ep.description}`);
        }
      }
      if (conn.entities) {
        connParts.push('');
        connParts.push(conn.entities);
      }
      if (conn.rules) {
        connParts.push('');
        connParts.push(conn.rules);
      }
      connParts.push('');

      const connText = connParts.join('\n');
      parts.push(connText);
      contributions.push({name: conn.name, category: 'connection', tokens: estimateTokens(connText)});
    }

    parts.push('Use `request` with the connection name, method, endpoint, and intent to interact with these systems.');
    parts.push('');
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------
  if (input.skills && input.skills.length > 0) {
    parts.push('## Skills');
    parts.push('');

    for (const skill of input.skills) {
      const skillParts: string[] = [];
      skillParts.push(`### ${skill.name}`);
      if (skill.trigger) {
        skillParts.push(`**When to activate:** ${skill.trigger}`);
      }
      skillParts.push(skill.description);
      if (skill.body) {
        skillParts.push('');
        skillParts.push(skill.body);
      }
      skillParts.push('');

      const skillText = skillParts.join('\n');
      parts.push(skillText);
      contributions.push({name: skill.name, category: 'skill', tokens: estimateTokens(skillText)});
    }
  }

  // -------------------------------------------------------------------------
  // Knowledge
  // -------------------------------------------------------------------------
  if (input.knowledge && input.knowledge.length > 0) {
    parts.push('## Knowledge Base');
    parts.push('');

    for (const doc of input.knowledge) {
      const docParts: string[] = [];
      docParts.push(`### ${doc.title ?? doc.name}`);
      if (doc.body) {
        docParts.push(doc.body);
      }
      docParts.push('');

      const docText = docParts.join('\n');
      parts.push(docText);
      contributions.push({name: doc.title ?? doc.name, category: 'knowledge', tokens: estimateTokens(docText)});
    }
  }

  // -------------------------------------------------------------------------
  // Stores
  // -------------------------------------------------------------------------
  if (input.stores && input.stores.length > 0) {
    const storeText = renderStoreSection(input.stores);
    parts.push(storeText);
    parts.push('');

    for (const store of input.stores) {
      const singleStoreText = renderStoreSection([store]);
      contributions.push({name: store.name, category: 'store', tokens: estimateTokens(singleStoreText)});
    }
  }

  // -------------------------------------------------------------------------
  // Field access restrictions (generated from connection access configs)
  // -------------------------------------------------------------------------
  const userRoles = input.userRoles ?? [];

  if (input.connections && input.connections.length > 0) {
    const fieldGuidance = generateFieldGuidance(input.connections, userRoles);
    if (fieldGuidance) {
      parts.push('## Field Access Restrictions');
      parts.push(fieldGuidance);
      parts.push('');
      contributions.push({name: 'Field guidance', category: 'system', tokens: estimateTokens(fieldGuidance)});
    }

    const scopeLabels = resolveScopeLabels(input.connections, userRoles);
    if (Object.keys(scopeLabels).length > 0) {
      parts.push('## Data Scope');
      for (const [entity, label] of Object.entries(scopeLabels)) {
        parts.push(`- ${entity}: ${label}`);
      }
      parts.push('');
    }

    const altLookup = generateAlternativeLookupGuidance(input.connections);
    if (altLookup) {
      parts.push(altLookup);
      parts.push('');
      contributions.push({name: 'Alternative lookups', category: 'system', tokens: estimateTokens(altLookup)});
    }
  }

  // -------------------------------------------------------------------------
  // Plan mode
  // -------------------------------------------------------------------------
  if (input.planMode) {
    parts.push('## Planning Mode Active');
    parts.push('You are currently in planning mode. Present your plan to the user before executing write operations.');
    parts.push('Read operations and explore are allowed freely.');
    if (input.approvedPlan) {
      parts.push('');
      parts.push('## Approved Plan');
      parts.push('Execute the following approved plan:');
      parts.push(input.approvedPlan);
    }
    parts.push('');
  }

  const systemPrompt = parts.join('\n').trim();

  return {
    systemPrompt,
    source: 'compiled',
    contributions,
  };
}
