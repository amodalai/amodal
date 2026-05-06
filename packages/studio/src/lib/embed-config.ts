/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export const EMBED_CONFIG_FILE_PATH = 'amodal.json';
export const EMBED_CONFIG_API_PATH = '/api/embed-config';

export const EMBED_POSITIONS = ['floating', 'right', 'bottom', 'inline'] as const;
export type EmbedPosition = typeof EMBED_POSITIONS[number];

export const EMBED_SCOPE_MODES = ['optional', 'required'] as const;
export type EmbedScopeMode = typeof EMBED_SCOPE_MODES[number];

export interface EmbedThemeConfig {
  headerText: string;
  placeholder: string;
  emptyStateText: string;
  primaryColor: string;
  mode: 'light' | 'dark' | 'auto';
}

export interface EmbedConfig {
  enabled: boolean;
  position: EmbedPosition;
  defaultOpen: boolean;
  historyEnabled: boolean;
  showFeedback: boolean;
  verboseTools: boolean;
  scopeMode: EmbedScopeMode;
  allowedDomains: string[];
  theme: EmbedThemeConfig;
}

export interface EmbedConfigResponse {
  config: EmbedConfig;
  source: 'default' | 'file' | 'draft';
  snippet: string;
}

export interface EmbedConfigSaveRequest {
  config: EmbedConfig;
}

export interface EmbedConfigSaveResponse extends EmbedConfigResponse {
  draftPath: typeof EMBED_CONFIG_FILE_PATH;
}

const DEFAULT_PRIMARY_COLOR = '#0d9e87';

export const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  enabled: true,
  position: 'right',
  defaultOpen: false,
  historyEnabled: true,
  showFeedback: true,
  verboseTools: false,
  scopeMode: 'optional',
  allowedDomains: [],
  theme: {
    headerText: 'AI Assistant',
    placeholder: 'Ask a question...',
    emptyStateText: 'Send a message to start a conversation.',
    primaryColor: DEFAULT_PRIMARY_COLOR,
    mode: 'auto',
  },
};

export interface SnippetInput {
  config: EmbedConfig;
  serverUrl: string;
}

export class EmbedConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmbedConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const domains = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const domain = entry.trim().toLowerCase();
    if (domain.length > 0) domains.add(domain);
  }
  return [...domains].sort();
}

export function normalizeEmbedConfig(value: unknown): EmbedConfig {
  const raw = isRecord(value) ? value : {};
  const rawTheme = isRecord(raw['theme']) ? raw['theme'] : {};

  return {
    enabled: booleanValue(raw['enabled'], DEFAULT_EMBED_CONFIG.enabled),
    position: enumValue(raw['position'], EMBED_POSITIONS, DEFAULT_EMBED_CONFIG.position),
    defaultOpen: booleanValue(raw['defaultOpen'], DEFAULT_EMBED_CONFIG.defaultOpen),
    historyEnabled: booleanValue(raw['historyEnabled'], DEFAULT_EMBED_CONFIG.historyEnabled),
    showFeedback: booleanValue(raw['showFeedback'], DEFAULT_EMBED_CONFIG.showFeedback),
    verboseTools: booleanValue(raw['verboseTools'], DEFAULT_EMBED_CONFIG.verboseTools),
    scopeMode: enumValue(raw['scopeMode'], EMBED_SCOPE_MODES, DEFAULT_EMBED_CONFIG.scopeMode),
    allowedDomains: normalizeDomains(raw['allowedDomains']),
    theme: {
      headerText: stringValue(rawTheme['headerText'], DEFAULT_EMBED_CONFIG.theme.headerText),
      placeholder: stringValue(rawTheme['placeholder'], DEFAULT_EMBED_CONFIG.theme.placeholder),
      emptyStateText: stringValue(rawTheme['emptyStateText'], DEFAULT_EMBED_CONFIG.theme.emptyStateText),
      primaryColor: stringValue(rawTheme['primaryColor'], DEFAULT_EMBED_CONFIG.theme.primaryColor),
      mode: enumValue(rawTheme['mode'], ['light', 'dark', 'auto'] as const, DEFAULT_EMBED_CONFIG.theme.mode),
    },
  };
}

export function parseAmodalJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new EmbedConfigError(`${EMBED_CONFIG_FILE_PATH} must contain a JSON object`);
  }
  return parsed;
}

export function readEmbedConfigFromAmodalJson(content: string): EmbedConfig {
  const parsed = parseAmodalJson(content);
  return normalizeEmbedConfig(parsed['embed']);
}

export function writeEmbedConfigToAmodalJson(content: string, config: EmbedConfig): string {
  const parsed = parseAmodalJson(content);
  parsed['embed'] = config;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function buildEmbedSnippet(input: SnippetInput): string {
  const { config, serverUrl } = input;
  const lines = [
    "import { ChatWidget } from '@amodalai/react/widget';",
    "import '@amodalai/react/widget/style.css';",
    '',
    'export function AgentChat() {',
    '  return (',
    '    <ChatWidget',
    `      serverUrl=${JSON.stringify(serverUrl)}`,
    '      user={{ id: user.id }}',
    `      position=${JSON.stringify(config.position)}`,
    `      defaultOpen={${String(config.defaultOpen)}}`,
    `      historyEnabled={${String(config.historyEnabled)}}`,
    `      showFeedback={${String(config.showFeedback)}}`,
  ];

  if (config.scopeMode === 'required') {
    lines.push('      scopeId={tenant.id}');
  }

  lines.push(
    '      theme={{',
    `        headerText: ${JSON.stringify(config.theme.headerText)},`,
    `        placeholder: ${JSON.stringify(config.theme.placeholder)},`,
    `        emptyStateText: ${JSON.stringify(config.theme.emptyStateText)},`,
    `        primaryColor: ${JSON.stringify(config.theme.primaryColor)},`,
    `        mode: ${JSON.stringify(config.theme.mode)},`,
    `        verboseTools: ${String(config.verboseTools)},`,
    '      }}',
    '    />',
    '  );',
    '}',
  );

  return lines.join('\n');
}
