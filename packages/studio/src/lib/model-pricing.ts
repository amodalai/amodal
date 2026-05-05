/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Model pricing data and utilities shared across Studio pages.
 * Prices are per 1M tokens.
 */

export interface ModelMeta {
  input: number;
  output: number;
  cachedInput?: number;
  context: string;
}

export const MODEL_META: Record<string, ModelMeta> = {
  'claude-opus-4-6':              { input: 15,    output: 75,   cachedInput: 1.50,  context: '1M' },
  'claude-sonnet-4-6':            { input: 3,     output: 15,   cachedInput: 0.30,  context: '1M' },
  'claude-sonnet-4-20250514':      { input: 3,     output: 15,   cachedInput: 0.30,  context: '1M' },
  'claude-haiku-4-5-20251001':    { input: 0.80,  output: 4,    cachedInput: 0.08,  context: '200K' },
  'gpt-4o':                       { input: 2.50,  output: 10,   context: '128K' },
  'gpt-4o-mini':                  { input: 0.15,  output: 0.60, context: '128K' },
  'gpt-4.1':                      { input: 2,     output: 8,    context: '1M' },
  'gpt-4.1-mini':                 { input: 0.40,  output: 1.60, context: '1M' },
  'gemini-3.1-pro-preview':        { input: 2,     output: 12,   context: '1M' },
  'gemini-3-pro-preview':          { input: 2,     output: 12,   context: '1M' },
  'gemini-3-flash-preview':        { input: 0.50,  output: 3,    context: '1M' },
  'gemini-3.1-flash-lite-preview': { input: 0.25,  output: 1.50, context: '1M' },
  'gemini-2.5-pro':               { input: 1.25,  output: 10,   context: '1M' },
  'gemini-2.5-flash':             { input: 0.15,  output: 0.60, context: '1M' },
  'deepseek-chat':                { input: 0.27,  output: 1.10, cachedInput: 0.07, context: '64K' },
  'deepseek-reasoner':            { input: 0.55,  output: 2.19, cachedInput: 0.14, context: '64K' },
  'llama-3.3-70b-versatile':      { input: 0.59,  output: 0.79, context: '128K' },
  'llama-3.1-8b-instant':         { input: 0.05,  output: 0.08, context: '128K' },
  'mistral-large-latest':          { input: 2,     output: 6,    context: '128K' },
  'mistral-small-latest':          { input: 0.10,  output: 0.30, context: '128K' },
  'codestral-latest':              { input: 0.30,  output: 0.90, context: '256K' },
  'grok-3':                        { input: 3,     output: 15,   context: '128K' },
  'grok-3-mini':                   { input: 0.30,  output: 0.50, context: '128K' },
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

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

export function priceColor(price: number): string {
  if (price <= 0.30) return 'text-emerald-500';
  if (price <= 3) return 'text-foreground';
  if (price <= 10) return 'text-amber-500';
  return 'text-red-400';
}

/**
 * Estimate cost in USD for a given model's token usage.
 * Returns null if the model isn't in the pricing table.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const meta = MODEL_META[model];
  if (!meta) return null;
  return (inputTokens / 1_000_000) * meta.input + (outputTokens / 1_000_000) * meta.output;
}
