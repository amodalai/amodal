/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/// <reference types="vite/client" />

declare module 'virtual:amodal-manifest' {
  export interface PageConfig {
    name: string;
    icon?: string;
    description?: string;
    context?: Record<string, string>;
    hidden?: boolean;
    filePath: string;
  }

  export interface AutomationConfig {
    name: string;
    title?: string;
    schedule?: string;
    trigger: string;
  }

  export const pages: PageConfig[];
  export const automations: AutomationConfig[];
}

declare module 'virtual:amodal-pages' {
  const pages: Record<string, React.ComponentType<Record<string, string>>>;
  export default pages;
}
