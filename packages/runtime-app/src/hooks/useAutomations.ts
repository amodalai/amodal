/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/App';

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Automation {
  name: string;
  schedule?: string;
  active?: boolean;
  lastRun?: string;
}

/**
 * Fetch automations list.
 */
export function useAutomations() {
  const { token } = useAuthContext();
  const enabled = !!token;

  return useQuery({
    queryKey: ['automations'],
    queryFn: async (): Promise<Automation[]> => {
      const res = await fetch('/automations', { headers: authHeaders(token) });
      if (!res.ok) return [];
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
      return data as Automation[];
    },
    enabled,
    initialData: [],
  });
}

/**
 * Run/start/stop an automation.
 */
export function useAutomationAction() {
  const { getToken } = useAuthContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, action }: { name: string; action: string }) => {
      const token = await getToken?.();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`/automations/${encodeURIComponent(name)}/${action}`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Automation ${action} failed: ${res.status} ${body}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}
