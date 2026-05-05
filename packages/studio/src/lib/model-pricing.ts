/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Model display data and utilities shared across Studio pages.
 * Cost estimates come from runtime session snapshots, not browser-side rates.
 */

export interface ModelMeta {
  label?: string;
  context: string;
}

export const MODEL_META: Record<string, ModelMeta> = {
  'claude-opus-4-6':              {label: 'Opus 4.6', context: '1M'},
  'claude-sonnet-4-6':            {label: 'Sonnet 4.6', context: '1M'},
  'claude-sonnet-4-20250514':      {label: 'Sonnet 4', context: '1M'},
  'claude-haiku-4-5-20251001':    {label: 'Haiku 4.5', context: '200K'},
  'gpt-4o':                       {context: '128K'},
  'gpt-4o-mini':                  {context: '128K'},
  'gpt-4.1':                      {context: '1M'},
  'gpt-4.1-mini':                 {context: '1M'},
  'gemini-3.1-pro-preview':        {label: 'Gemini 3.1 Pro', context: '1M'},
  'gemini-3-pro-preview':          {label: 'Gemini 3 Pro', context: '1M'},
  'gemini-3-flash-preview':        {label: 'Gemini 3 Flash', context: '1M'},
  'gemini-3.1-flash-lite-preview': {label: 'Gemini 3.1 Flash Lite', context: '1M'},
  'gemini-2.5-pro':               {label: 'Gemini 2.5 Pro', context: '1M'},
  'gemini-2.5-flash':             {label: 'Gemini 2.5 Flash', context: '1M'},
  'deepseek-chat':                {context: '64K'},
  'deepseek-reasoner':            {context: '64K'},
  'llama-3.3-70b-versatile':      {context: '128K'},
  'llama-3.1-8b-instant':         {context: '128K'},
  'mistral-large-latest':          {context: '128K'},
  'mistral-small-latest':          {context: '128K'},
  'codestral-latest':              {context: '256K'},
  'grok-3':                        {context: '128K'},
  'grok-3-mini':                   {context: '128K'},
};

export const PROVIDER_COLORS: Record<string, {bg: string; text: string; dot: string}> = {
  anthropic: {bg: 'bg-amber-500/10', text: 'text-amber-600', dot: 'bg-amber-500'},
  openai:    {bg: 'bg-emerald-500/10', text: 'text-emerald-600', dot: 'bg-emerald-500'},
  google:    {bg: 'bg-blue-500/10', text: 'text-blue-600', dot: 'bg-blue-500'},
  deepseek:  {bg: 'bg-cyan-500/10', text: 'text-cyan-600', dot: 'bg-cyan-500'},
  groq:      {bg: 'bg-purple-500/10', text: 'text-purple-600', dot: 'bg-purple-500'},
  mistral:   {bg: 'bg-orange-500/10', text: 'text-orange-600', dot: 'bg-orange-500'},
  xai:       {bg: 'bg-rose-500/10', text: 'text-rose-600', dot: 'bg-rose-500'},
};

const MODEL_PROVIDER_MAP: Record<string, string> = {
  claude: 'anthropic',
  gpt: 'openai',
  gemini: 'google',
  deepseek: 'deepseek',
  llama: 'groq',
  mistral: 'mistral',
  codestral: 'mistral',
  grok: 'xai',
};

export function modelToProvider(modelName: string): string {
  for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
    if (modelName.startsWith(prefix)) return provider;
  }
  return 'unknown';
}

export function modelDisplayName(modelName: string): string {
  const meta = MODEL_META[modelName];
  if (meta?.label) return meta.label;
  return modelName
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}
