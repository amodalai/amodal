/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { extractPath } from './tool-utils.js';

/**
 * Error from merge template resolution.
 */
export interface MergeTemplateError {
  expression: string;
  message: string;
}

/**
 * Context for merge template resolution — step results keyed by step name.
 */
export type MergeTemplateContext = Record<string, unknown>;

/**
 * Result of merge template resolution.
 */
export interface MergeTemplateResult<T> {
  value: T;
  errors: MergeTemplateError[];
}

const TEMPLATE_REGEX = /(?<!\\)\{\{(steps\.[a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;
const ESCAPED_REGEX = /\\\{\{(.+?)\}\}/g;

/**
 * Resolve a single string merge template, replacing {{steps.NAME.path}}
 * with values from the step results context.
 */
export function resolveMergeTemplate(
  template: string,
  context: MergeTemplateContext,
): MergeTemplateResult<string> {
  const errors: MergeTemplateError[] = [];

  const value = template.replace(TEMPLATE_REGEX, (_match, expr: string) => {
    // expr is like "steps.basic_info.mac"
    const parts = expr.split('.');
    // parts[0] is "steps", parts[1] is the step name, rest is the path
    if (parts.length < 2 || parts[0] !== 'steps') {
      errors.push({ expression: expr, message: 'Invalid merge template expression' });
      return `{{${expr}}}`;
    }

    const stepName = parts[1];
    const stepData = context[stepName];
    if (stepData === undefined) {
      errors.push({ expression: expr, message: `Step "${stepName}" not found in results` });
      return `{{${expr}}}`;
    }

    if (parts.length === 2) {
      // Just {{steps.NAME}} — return the whole step result
      return typeof stepData === 'string' ? stepData : JSON.stringify(stepData);
    }

    // {{steps.NAME.path.to.value}}
    const path = parts.slice(2).join('.');
    const extracted = extractPath(stepData, path);
    if (extracted === undefined) {
      errors.push({ expression: expr, message: `Path "${path}" not found in step "${stepName}"` });
      return `{{${expr}}}`;
    }

    return typeof extracted === 'string' ? extracted : JSON.stringify(extracted);
  });

  // Unescape escaped expressions
  const unescaped = value.replace(ESCAPED_REGEX, '{{$1}}');

  return { value: unescaped, errors };
}

/**
 * Resolve a merge template that is an object — recursively resolve all
 * string values.
 */
export function resolveMergeTemplateObject(
  template: Record<string, unknown>,
  context: MergeTemplateContext,
): MergeTemplateResult<Record<string, string>> {
  const errors: MergeTemplateError[] = [];
  const result: Record<string, string> = {};

  for (const [key, val] of Object.entries(template)) {
    if (typeof val === 'string') {
      const resolved = resolveMergeTemplate(val, context);
      errors.push(...resolved.errors);
      result[key] = resolved.value;
    } else {
      result[key] = typeof val === 'string' ? val : JSON.stringify(val);
    }
  }

  return { value: result, errors };
}
