/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Result returned by oauth2 and credential prompt flows.
 */
export interface AuthResult {
  credentials: Record<string, string>;
  summary: string;
}

/**
 * Per-endpoint test result.
 */
export interface EndpointTestResult {
  url: string;
  status: 'ok' | 'error';
  statusCode?: number;
  recordCount?: number;
  error?: string;
  durationMs: number;
}

/**
 * Aggregated connection test report.
 */
export interface ConnectionTestReport {
  connectionName: string;
  results: EndpointTestResult[];
  allPassed: boolean;
}
