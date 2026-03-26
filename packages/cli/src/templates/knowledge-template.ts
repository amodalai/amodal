/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Generates a starter knowledge.md.
 */
export function generateKnowledgeTemplate(): string {
  return `---
title: Domain Knowledge
---

## Getting Started

Add domain-specific knowledge here. Good knowledge documents include:

- **Terminology**: Define domain-specific terms the agent should understand
- **Baselines**: What "normal" looks like for key metrics
- **Common patterns**: Recurring scenarios the agent should recognize
- **Decision frameworks**: How to prioritize or categorize findings
`;
}
