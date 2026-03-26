/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  PROPOSE_KNOWLEDGE_TOOL_NAME,
  LOAD_KNOWLEDGE_TOOL_NAME,
  PRESENT_TOOL_NAME,
  REQUEST_TOOL_NAME,
  DISPATCH_TOOL_NAME,
} from './amodal-tool-names.js';

describe('amodal-tool-names', () => {
  it('should export correct tool names', () => {
    expect(PROPOSE_KNOWLEDGE_TOOL_NAME).toBe('propose_knowledge');
    expect(LOAD_KNOWLEDGE_TOOL_NAME).toBe('load_knowledge');
    expect(PRESENT_TOOL_NAME).toBe('present');
    expect(REQUEST_TOOL_NAME).toBe('request');
    expect(DISPATCH_TOOL_NAME).toBe('dispatch');
  });

});
