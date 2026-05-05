/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { studioApiUrl } from '@/lib/api';
import { API_EMBED_CONFIG_PATH } from '@/lib/routes';
import type { EmbedConfig, EmbedConfigResponse, EmbedConfigSaveResponse } from '@/lib/embed-config';

class EmbedConfigRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmbedConfigRequestError';
  }
}

export interface UseEmbedConfigResult {
  config: EmbedConfig | null;
  source: EmbedConfigResponse['source'] | null;
  snippet: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveError: string | null;
  save(config: EmbedConfig): Promise<EmbedConfigSaveResponse>;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  if (!response.ok) {
    let body: unknown;
    try {
      body = rawBody.length > 0 ? JSON.parse(rawBody) : null;
    } catch (err: unknown) {
      throw new EmbedConfigRequestError(`Studio returned ${String(response.status)} with malformed JSON`, { cause: err });
    }
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? JSON.stringify((body as Record<string, unknown>)['error'])
      : `Studio returned ${String(response.status)}`;
    throw new EmbedConfigRequestError(message);
  }
  if (rawBody.length === 0) {
    throw new EmbedConfigRequestError(`Studio returned ${String(response.status)} with an empty body`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing our own API route response
  return JSON.parse(rawBody) as T;
}

export function useEmbedConfig(): UseEmbedConfigResult {
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [source, setSource] = useState<EmbedConfigResponse['source'] | null>(null);
  const [snippet, setSnippet] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(studioApiUrl(API_EMBED_CONFIG_PATH), { signal: AbortSignal.timeout(5_000) })
      .then((response) => parseResponse<EmbedConfigResponse>(response))
      .then((body) => {
        setConfig(body.config);
        setSource(body.source);
        setSnippet(body.snippet);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const save = useCallback(async (nextConfig: EmbedConfig) => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(studioApiUrl(API_EMBED_CONFIG_PATH), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = await parseResponse<EmbedConfigSaveResponse>(response);
      setConfig(body.config);
      setSource(body.source);
      setSnippet(body.snippet);
      return body;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      throw new EmbedConfigRequestError(message, { cause: err });
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, source, snippet, loading, saving, error, saveError, save };
}
