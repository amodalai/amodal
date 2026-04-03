/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Parsed GraphQL operation from an introspection result.
 */
export interface ParsedGraphQLOperation {
  name: string;
  operationType: 'query' | 'mutation' | 'subscription';
  args: Array<{name: string; type: string; required: boolean}>;
  returnType: string;
  description?: string;
}

/**
 * Minimal introspection schema shape for parsing.
 */
interface IntrospectionSchema {
  __schema?: {
    queryType?: {name?: string};
    mutationType?: {name?: string};
    subscriptionType?: {name?: string};
    types?: IntrospectionType[];
  };
  data?: {
    __schema?: {
      queryType?: {name?: string};
      mutationType?: {name?: string};
      subscriptionType?: {name?: string};
      types?: IntrospectionType[];
    };
  };
}

interface IntrospectionType {
  name?: string;
  kind?: string;
  fields?: IntrospectionField[];
  description?: string;
}

interface IntrospectionField {
  name?: string;
  description?: string;
  args?: IntrospectionArg[];
  type?: IntrospectionTypeRef;
}

interface IntrospectionArg {
  name?: string;
  description?: string;
  type?: IntrospectionTypeRef;
}

interface IntrospectionTypeRef {
  kind?: string;
  name?: string;
  ofType?: IntrospectionTypeRef;
}

/**
 * Parse a GraphQL introspection result into a flat list of operations.
 */
export function parseGraphQLIntrospection(
  introspection: unknown,
): ParsedGraphQLOperation[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing unknown introspection shape
  const schema = introspection as IntrospectionSchema;
  const root = schema.__schema ?? schema.data?.__schema;

  if (!root) {
    return [];
  }

  const types = root.types ?? [];
  const operations: ParsedGraphQLOperation[] = [];

  const rootTypeNames = new Map<string, 'query' | 'mutation' | 'subscription'>();
  if (root.queryType?.name) {
    rootTypeNames.set(root.queryType.name, 'query');
  }
  if (root.mutationType?.name) {
    rootTypeNames.set(root.mutationType.name, 'mutation');
  }
  if (root.subscriptionType?.name) {
    rootTypeNames.set(root.subscriptionType.name, 'subscription');
  }

  for (const type of types) {
    if (!type.name) continue;
    const operationType = rootTypeNames.get(type.name);
    if (!operationType) continue;

    for (const field of type.fields ?? []) {
      if (!field.name) continue;
      // Skip internal fields
      if (field.name.startsWith('__')) continue;

      operations.push({
        name: field.name,
        operationType,
        args: (field.args ?? []).map((arg) => ({
          name: arg.name ?? '',
          type: formatTypeRef(arg.type),
          required: isRequired(arg.type),
        })),
        returnType: formatTypeRef(field.type),
        description: field.description ?? undefined,
      });
    }
  }

  return operations;
}

/**
 * Format a type reference into a human-readable string.
 */
function formatTypeRef(ref: IntrospectionTypeRef | undefined): string {
  if (!ref) return 'Unknown';

  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
  switch (ref.kind) {
    case 'NON_NULL':
      return `${formatTypeRef(ref.ofType)}!`;
    case 'LIST':
      return `[${formatTypeRef(ref.ofType)}]`;
    case 'SCALAR':
    case 'OBJECT':
    case 'ENUM':
    case 'INPUT_OBJECT':
    case 'INTERFACE':
    case 'UNION':
      return ref.name ?? 'Unknown';
    default:
      return ref.name ?? 'Unknown';
  }
}

/**
 * Check if a type reference is non-null (required).
 */
function isRequired(ref: IntrospectionTypeRef | undefined): boolean {
  return ref?.kind === 'NON_NULL';
}

/**
 * Fetch an introspection result from a GraphQL endpoint and parse it.
 */
export async function fetchAndParseGraphQLSchema(
  url: string,
  auth?: {header: string; value: string},
): Promise<ParsedGraphQLOperation[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    headers[auth.header] = auth.value;
  }

  const query = `{
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        name
        kind
        description
        fields {
          name
          description
          args {
            name
            type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
          }
          type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        }
      }
    }
  }`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({query}),
  });

  if (!response.ok) {
    throw new Error(`GraphQL introspection failed: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  return parseGraphQLIntrospection(data);
}
