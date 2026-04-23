/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool error types for amodal custom tools.
 */
export const AmodalToolErrorType = {
  // HTTP tool errors
  HTTP_TOOL_INVALID_URL: 'http_tool_invalid_url',
  HTTP_TOOL_PRIVATE_IP: 'http_tool_private_ip',
  HTTP_TOOL_REQUEST_FAILED: 'http_tool_request_failed',
  HTTP_TOOL_RESPONSE_ERROR: 'http_tool_response_error',
  HTTP_TOOL_TEMPLATE_ERROR: 'http_tool_template_error',

  // Chain tool errors
  CHAIN_TOOL_TIMEOUT: 'chain_tool_timeout',
  CHAIN_TOOL_STEP_FAILED: 'chain_tool_step_failed',
  CHAIN_TOOL_INVALID_URL: 'chain_tool_invalid_url',
  CHAIN_TOOL_PRIVATE_IP: 'chain_tool_private_ip',
  CHAIN_TOOL_MERGE_ERROR: 'chain_tool_merge_error',
  CHAIN_TOOL_TEMPLATE_ERROR: 'chain_tool_template_error',

  // Function tool errors
  FUNCTION_TOOL_TIMEOUT: 'function_tool_timeout',
  FUNCTION_TOOL_EXECUTION_ERROR: 'function_tool_execution_error',
} as const;
