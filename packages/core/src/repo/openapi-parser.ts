/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A parsed endpoint from an OpenAPI spec.
 */
export interface ParsedEndpoint {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: ParsedParameter[];
  deprecated: boolean;
}

export interface ParsedParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  type?: string;
  description?: string;
}

interface OpenAPISpec {
  openapi?: string;
  paths?: Record<string, Record<string, OpenAPIOperation>>;
}

interface OpenAPIOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: Array<{
    name?: string;
    in?: string;
    required?: boolean;
    schema?: {type?: string};
    description?: string;
  }>;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/**
 * Parse an OpenAPI 3.0/3.1 spec object into a flat list of endpoints.
 */
export function parseOpenAPISpec(spec: unknown): ParsedEndpoint[] {
  if (!spec || typeof spec !== 'object') {
    return [];
  }

   
  const apiSpec = spec as OpenAPISpec;

  if (!apiSpec.paths) {
    return [];
  }

  const version = apiSpec.openapi ?? '';
  if (!version.startsWith('3.')) {
    // Only support OpenAPI 3.x
    return [];
  }

  const endpoints: ParsedEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(apiSpec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== 'object') continue;

       
      const op = operation;

      const parameters: ParsedParameter[] = [];
      if (Array.isArray(op.parameters)) {
        for (const param of op.parameters) {
          if (param.name && param.in) {
            parameters.push({
              name: param.name,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary
              in: param.in as ParsedParameter['in'],
              required: param.required ?? false,
              type: param.schema?.type,
              description: param.description,
            });
          }
        }
      }

      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: op.summary,
        description: op.description,
        tags: op.tags ?? [],
        parameters,
        deprecated: op.deprecated ?? false,
      });
    }
  }

  return endpoints;
}

/**
 * Fetch an OpenAPI spec from a URL and parse it.
 */
export async function fetchAndParseSpec(
  url: string,
  auth?: {header: string; value: string},
): Promise<ParsedEndpoint[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/json, application/yaml',
  };

  if (auth) {
    headers[auth.header] = auth.value;
  }

  const response = await fetch(url, {headers});

  if (!response.ok) {
    throw new Error(`Failed to fetch spec from ${url}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  let parsed: unknown;

  if (contentType.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')) {
    // Dynamic import for YAML support
    try {
      const yaml = await import('js-yaml');
      parsed = yaml.load(text);
    } catch {
      throw new Error('js-yaml is required for YAML spec parsing. Install it with: pnpm add js-yaml');
    }
  } else {
    parsed = JSON.parse(text);
  }

  return parseOpenAPISpec(parsed);
}
