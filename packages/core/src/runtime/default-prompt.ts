/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Build the default Amodal system prompt.
 *
 * Used when the user has not set a custom `basePrompt` in amodal.json
 * or on the application record. This replaces the upstream Gemini CLI
 * system prompt with one tailored for the Amodal agent runtime.
 */
export function buildDefaultPrompt(opts: {
  name: string;
  description?: string;
  agentContext?: string;
  connectionNames?: string[];
  connections?: Array<{
    name: string;
    description?: string;
    endpoints?: Array<{method: string; path: string; description: string}>;
    entities?: string;
    rules?: string;
  }>;
  skills?: Array<{name: string; description: string; trigger?: string; body?: string}>;
  knowledge?: Array<{name: string; title?: string}>;
}): string {
  const parts: string[] = [];

  // Identity
  parts.push(`You are ${opts.name}${opts.description ? ` — ${opts.description}` : ''}.`);
  parts.push('');

  // Agent context (if set by the deployment)
  if (opts.agentContext) {
    parts.push(opts.agentContext);
    parts.push('');
  }

  // Core behavior
  parts.push(`## How you work

- Use the **request** tool to query connected systems. Always specify the connection name, HTTP method, endpoint, and intent (read or write).
- Write operations require user confirmation unless the user has explicitly approved the action.
- Never fabricate data. If a query returns no results, say so. If you're uncertain, ask.
- When the user's question requires data from external systems, always query first — do not guess.
- Keep responses concise and grounded in the data you retrieve.`);
  parts.push('');

  // Error handling guidance
  parts.push(`## Error handling

- If a tool call returns an error, report it clearly to the user with the connection name and what went wrong. Do not silently retry or attempt workarounds.
- On 401/403 errors: tell the user their credentials may be misconfigured. Do not retry with different parameters.
- On network errors: tell the user the service appears unreachable. Do not try alternative endpoints.
- If a connection name is not recognized, use the suggestion from the error message. Do not guess connection names.
- If a skill or tool is not found, report the error and list what is available.`);
  parts.push('');

  // Connections — include API surface so the model knows available endpoints
  if (opts.connections && opts.connections.length > 0) {
    parts.push('## Connected systems');
    parts.push('');
    for (const conn of opts.connections) {
      parts.push(`### Connection: ${conn.name}`);
      if (conn.description) {
        parts.push(conn.description);
      }
      if (conn.endpoints && conn.endpoints.length > 0) {
        parts.push('');
        parts.push('**Available Endpoints:**');
        for (const ep of conn.endpoints) {
          parts.push(`- ${ep.method} ${ep.path} — ${ep.description}`);
        }
      }
      if (conn.entities) {
        parts.push('');
        parts.push(conn.entities);
      }
      if (conn.rules) {
        parts.push('');
        parts.push(conn.rules);
      }
      parts.push('');
    }
    parts.push('Use `request` with the connection name, method, endpoint, and intent to interact with these systems.');
    parts.push('');
  } else if (opts.connectionNames && opts.connectionNames.length > 0) {
    // Fallback: just names
    parts.push('## Connected systems');
    parts.push('');
    for (const name of opts.connectionNames) {
      parts.push(`- **${name}**`);
    }
    parts.push('');
  }

  // Skills
  if (opts.skills && opts.skills.length > 0) {
    parts.push('## Skills');
    parts.push('');
    for (const skill of opts.skills) {
      parts.push(`### ${skill.name}`);
      if (skill.trigger) {
        parts.push(`**When to activate:** ${skill.trigger}`);
      }
      parts.push(skill.description);
      if (skill.body) {
        parts.push('');
        parts.push(skill.body);
      }
      parts.push('');
    }
  }

  // Knowledge
  if (opts.knowledge && opts.knowledge.length > 0) {
    parts.push('## Available knowledge');
    parts.push('');
    for (const doc of opts.knowledge) {
      parts.push(`- ${doc.title ?? doc.name}`);
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}
