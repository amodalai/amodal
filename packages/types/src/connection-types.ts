/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// Connection spec types (from repo/connection-schemas.ts)
// ---------------------------------------------------------------------------

/**
 * A single context injection field declaration.
 *
 * Tells the runtime how to inject a value from the session's scopeContext
 * into outgoing HTTP requests for this connection.
 */
export interface ContextInjectionField {
  /** Where to inject the value in the HTTP request. */
  in: 'query' | 'header' | 'path' | 'body';
  /** The field name (query param name, header name, body key, or path param name). */
  field: string;
  /** When true, requests fail if the scope context does not contain this key. */
  required?: boolean;
}

export interface ConnectionSpec {
  protocol: 'rest' | 'mcp';
  baseUrl?: string;
  specUrl?: string;
  testPath?: string;
  format?: 'openapi' | 'graphql' | 'grpc' | 'rest' | 'aws-api';
  auth?: {
    type: string;
    token?: string;
    header?: string;
    prefix?: string;
  };
  sync?: {
    auto: boolean;
    frequency: 'on_push' | 'manual' | 'daily' | 'weekly' | 'hourly';
    notify_drift: boolean;
  };
  filter?: {
    tags?: string[];
    include_paths?: string[];
    exclude_paths?: string[];
  };
  transport?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  trust?: boolean;
  /**
   * Scope context injection rules.
   *
   * Keys are scopeContext keys; values declare where to inject their values
   * into outgoing HTTP requests for this connection.
   */
  contextInjection?: Record<string, ContextInjectionField>;
}

export interface Threshold {
  field: string;
  above: number;
  escalate: 'review' | 'never';
}

export interface EndpointAccess {
  returns: string[];
  confirm?: true | 'review' | 'never';
  reason?: string;
  thresholds?: Threshold[];
}

export interface FieldRestriction {
  entity: string;
  field: string;
  policy: 'never_retrieve' | 'retrieve_but_redact' | 'role_gated';
  sensitivity: string;
  reason?: string;
  allowedRoles?: string[];
  group?: string;
}

export type ScopingRule =
  | ScopingRuleFieldMatch
  | ScopingRuleAll
  | ScopingRuleThroughRelation;

export interface ScopingRuleFieldMatch {
  type: 'field_match';
  userContextField: string;
  label?: string;
}

export interface ScopingRuleAll {
  type: 'all';
  label?: string;
}

export interface ScopingRuleThroughRelation {
  type: 'through_relation';
  throughEntity: string;
  label?: string;
}

export interface AlternativeLookup {
  restrictedField: string;
  alternativeEndpoint: string;
  description?: string;
}

export interface AccessConfig {
  endpoints: Record<string, EndpointAccess>;
  fieldRestrictions?: FieldRestriction[];
  rowScoping?: Record<string, Record<string, ScopingRule>>;
  delegations?: {
    enabled: boolean;
    maxDurationDays?: number;
    escalateConfirm: boolean;
  };
  alternativeLookups?: AlternativeLookup[];
}

// ---------------------------------------------------------------------------
// Loaded connection (from repo/connection-types.ts)
// ---------------------------------------------------------------------------

export interface SurfaceEndpoint {
  method: string;
  path: string;
  description: string;
  included: boolean;
  operationType?: 'query' | 'mutation' | 'subscription';
}

export interface LoadedConnection {
  name: string;
  spec: ConnectionSpec;
  access: AccessConfig;
  surface: SurfaceEndpoint[];
  entities?: string;
  rules?: string;
  location: string;
}
