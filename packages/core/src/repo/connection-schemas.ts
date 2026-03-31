/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';

/**
 * Schema for spec.json — the structural layer of a connection.
 */
export const ConnectionSpecSchema = z.object({
  /** Connection protocol. Defaults to 'rest' for backward compat. */
  protocol: z.enum(['rest', 'mcp']).default('rest'),
  // --- REST fields ---
  baseUrl: z.string().min(1).optional(),
  specUrl: z.string().min(1).optional(),
  /** Relative path to test during validate (e.g. "/me", "/v1/status"). Appended to baseUrl. */
  testPath: z.string().optional(),
  format: z.enum(['openapi', 'graphql', 'grpc', 'rest', 'aws-api']).optional(),
  auth: z
    .object({
      type: z.string().min(1),
      token: z.string().optional(),
      header: z.string().optional(),
      prefix: z.string().optional(),
    })
    .optional(),
  sync: z
    .object({
      auto: z.boolean().default(true),
      frequency: z.enum(['on_push', 'manual', 'daily', 'weekly', 'hourly']).default('on_push'),
      notify_drift: z.boolean().default(true),
    })
    .optional(),
  filter: z
    .object({
      tags: z.array(z.string()).optional(),
      include_paths: z.array(z.string()).optional(),
      exclude_paths: z.array(z.string()).optional(),
    })
    .optional(),
  // --- MCP fields ---
  transport: z.enum(['stdio', 'sse', 'http']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  trust: z.boolean().optional(),
});

export type ConnectionSpec = z.infer<typeof ConnectionSpecSchema>;

/**
 * Schema for a threshold escalation rule.
 */
export const ThresholdSchema = z.object({
  field: z.string().min(1),
  above: z.number(),
  escalate: z.enum(['review', 'never']),
});

export type Threshold = z.infer<typeof ThresholdSchema>;

/**
 * Schema for an endpoint access entry.
 */
export const EndpointAccessSchema = z.object({
  returns: z.array(z.string().min(1)),
  confirm: z.union([z.literal(true), z.literal('review'), z.literal('never')]).optional(),
  reason: z.string().optional(),
  thresholds: z.array(ThresholdSchema).optional(),
});

export type EndpointAccess = z.infer<typeof EndpointAccessSchema>;

/**
 * Schema for a field restriction.
 */
export const FieldRestrictionSchema = z.object({
  entity: z.string().min(1),
  field: z.string().min(1),
  policy: z.enum(['never_retrieve', 'retrieve_but_redact', 'role_gated']),
  sensitivity: z.string().min(1),
  reason: z.string().optional(),
  allowedRoles: z.array(z.string().min(1)).optional(),
  group: z.string().optional(),
});

export type FieldRestriction = z.infer<typeof FieldRestrictionSchema>;

/**
 * Schema for row-level scoping rules.
 */
export const ScopingRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('field_match'),
    userContextField: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal('all'),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal('through_relation'),
    throughEntity: z.string().min(1),
    label: z.string().optional(),
  }),
]);

export type ScopingRule = z.infer<typeof ScopingRuleSchema>;

/**
 * Schema for an alternative lookup.
 */
export const AlternativeLookupSchema = z.object({
  restrictedField: z.string().min(1),
  alternativeEndpoint: z.string().min(1),
  description: z.string().optional(),
});

export type AlternativeLookup = z.infer<typeof AlternativeLookupSchema>;

/**
 * Schema for access.json — the permission layer of a connection.
 */
export const AccessConfigSchema = z.object({
  endpoints: z.record(z.string(), EndpointAccessSchema),
  fieldRestrictions: z.array(FieldRestrictionSchema).optional(),
  rowScoping: z.record(z.string(), z.record(z.string(), ScopingRuleSchema)).optional(),
  delegations: z
    .object({
      enabled: z.boolean().default(false),
      maxDurationDays: z.number().optional(),
      escalateConfirm: z.boolean().default(false),
    })
    .optional(),
  alternativeLookups: z.array(AlternativeLookupSchema).optional(),
});

export type AccessConfig = z.infer<typeof AccessConfigSchema>;
