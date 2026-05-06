/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useEffect, useState} from 'react';
import {studioApiUrl} from '@/lib/api';
import {API_MODELS_CATALOG_PATH} from '@/lib/routes';
import type {ModelCatalogResponse, ModelCatalogSaveResponse} from '@/lib/model-catalog';
import type {ModelConfig} from '@amodalai/types';

class ModelCatalogRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelCatalogRequestError';
  }
}

export interface ModelCatalogResult {
  catalog: ModelCatalogResponse | null;
  error: string | null;
  saveError: string | null;
  loading: boolean;
  saving: boolean;
  saveMainModel(model: ModelConfig): Promise<ModelCatalogSaveResponse>;
}

async function parseModelCatalogResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  if (!response.ok) {
    throw new ModelCatalogRequestError(`Studio returned ${String(response.status)} for model catalog`);
  }
  if (rawBody.length === 0) {
    throw new ModelCatalogRequestError('Studio returned an empty model catalog response');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing our own API route response
  return JSON.parse(rawBody) as T;
}

export function useModelCatalog(): ModelCatalogResult {
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(studioApiUrl(API_MODELS_CATALOG_PATH), {signal: AbortSignal.timeout(5_000)})
      .then((response) => parseModelCatalogResponse<ModelCatalogResponse>(response))
      .then((body) => {
        setCatalog(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, []);

  const saveMainModel = async (model: ModelConfig): Promise<ModelCatalogSaveResponse> => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(studioApiUrl(API_MODELS_CATALOG_PATH), {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model}),
        signal: AbortSignal.timeout(5_000),
      });
      const body = await parseModelCatalogResponse<ModelCatalogSaveResponse>(response);
      setCatalog(body);
      return body;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      throw new ModelCatalogRequestError(message, {cause: err});
    } finally {
      setSaving(false);
    }
  };

  return {catalog, error, saveError, loading: !catalog && !error, saving, saveMainModel};
}
