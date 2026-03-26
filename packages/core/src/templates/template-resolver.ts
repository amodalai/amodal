/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Context for template resolution. Contains namespaced data sources.
 */
export interface TemplateContext {
  connections: Record<string, Record<string, unknown>>;
  params: Record<string, unknown>;
}

/**
 * An error encountered during template resolution.
 */
export interface TemplateError {
  expression: string;
  message: string;
}

/**
 * Result of resolving a single template string.
 */
export interface TemplateResult {
  value: string;
  errors: TemplateError[];
}

const VALID_NAMESPACES = new Set(['connections', 'params']);

// Matches {{expression}} but not \{{expression}}
const TEMPLATE_REGEX = /(?<!\\)\{\{([^}]+)\}\}/g;

// Matches escaped \{{ to un-escape
const ESCAPED_TEMPLATE_REGEX = /\\\{\{([^}]*)\}\}/g;

/**
 * Resolve a dot-separated path on a nested object.
 * Returns undefined if any segment is missing.
 */
function resolvePath(
  obj: Record<string, unknown>,
  dotPath: string,
): unknown {
  const segments = dotPath.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment]; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
  }
  return current;
}

/**
 * Convert a resolved value to a string suitable for template substitution.
 */
function valueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Resolve all `{{namespace.path}}` expressions in a template string.
 *
 * - `{{connections.x.y}}` resolves from context.connections
 * - `{{params.x}}` resolves from context.params
 * - Missing variables produce errors (never silently empty)
 * - Escaped `\{{literal}}` is converted to `{{literal}}` without resolution
 * - Invalid namespaces produce errors
 */
export function resolveTemplate(
  template: string,
  context: TemplateContext,
): TemplateResult {
  const errors: TemplateError[] = [];

  // Replace unescaped {{expressions}}
  let value = template.replace(TEMPLATE_REGEX, (_match, expression: string) => {
    const trimmed = expression.trim();
    const dotIndex = trimmed.indexOf('.');
    if (dotIndex === -1) {
      errors.push({
        expression: trimmed,
        message: `Invalid template expression "${trimmed}": must be in format "namespace.path"`,
      });
      return `{{${trimmed}}}`;
    }

    const namespace = trimmed.slice(0, dotIndex);
    const path = trimmed.slice(dotIndex + 1);

    if (!VALID_NAMESPACES.has(namespace)) {
      errors.push({
        expression: trimmed,
        message: `Unknown namespace "${namespace}". Valid namespaces: ${[...VALID_NAMESPACES].join(', ')}`,
      });
      return `{{${trimmed}}}`;
    }

    const source: Record<string, unknown> | undefined =
      namespace === 'connections' ? context.connections :
      namespace === 'params' ? context.params :
      undefined;
    if (!source || typeof source !== 'object') {
      errors.push({
        expression: trimmed,
        message: `Namespace "${namespace}" is empty or not configured`,
      });
      return `{{${trimmed}}}`;
    }

    const resolved = resolvePath(source, path);
    if (resolved === undefined) {
      errors.push({
        expression: trimmed,
        message: `Variable "${trimmed}" not found`,
      });
      return `{{${trimmed}}}`;
    }

    return valueToString(resolved);
  });

  // Un-escape \{{ → {{
  value = value.replace(ESCAPED_TEMPLATE_REGEX, '{{$1}}');

  return { value, errors };
}

/**
 * Recursively resolve all string values in an object.
 * Non-string values are passed through unchanged.
 * Collects all errors from all resolved strings.
 */
export function resolveTemplateObject<T>(
  obj: T,
  context: TemplateContext,
): { value: T; errors: TemplateError[] } {
  const errors: TemplateError[] = [];

  function resolve(val: unknown): unknown {
    if (typeof val === 'string') {
      const result = resolveTemplate(val, context);
      errors.push(...result.errors);
      return result.value;
    }
    if (Array.isArray(val)) {
      return val.map(resolve);
    }
    if (val !== null && typeof val === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const key of Object.keys(val)) {
        resolved[key] = resolve((val as Record<string, unknown>)[key]); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
      }
      return resolved;
    }
    return val;
  }

  const value = resolve(obj) as T; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
  return { value, errors };
}
