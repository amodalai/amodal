/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as matchers from '@testing-library/jest-dom/matchers';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

expect.extend(matchers);

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});
