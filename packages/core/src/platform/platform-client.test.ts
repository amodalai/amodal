/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformClient } from './platform-client.js';
import { VersionBundleError } from '../versions/bundle-loader.js';

const VALID_CONFIG = {
  apiUrl: 'https://platform.example.com',
  apiKey: 'sk-platform-test',
  deployment: 'prod',
};

const VALID_BUNDLE = {
  version: '1.0.0',
  tools: [],
  skills: [],
  handlers: {},
  dependencies: {},
  roles: [],
  automations: [],
};

describe('PlatformClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('accepts valid config', () => {
      expect(() => new PlatformClient(VALID_CONFIG)).not.toThrow();
    });

    it('rejects invalid apiUrl', () => {
      expect(
        () => new PlatformClient({ ...VALID_CONFIG, apiUrl: 'not-a-url' }),
      ).toThrow('Invalid platform config');
    });

    it('rejects empty apiKey', () => {
      expect(
        () => new PlatformClient({ ...VALID_CONFIG, apiKey: '' }),
      ).toThrow('Invalid platform config');
    });

    it('rejects empty deployment (min length 1)', () => {
      expect(
        () => new PlatformClient({ ...VALID_CONFIG, deployment: '' }),
      ).toThrow('Invalid platform config');
    });

    it('accepts config without deployment', () => {
      const { deployment: _, ...configWithoutDeployment } = VALID_CONFIG;
      expect(() => new PlatformClient(configWithoutDeployment)).not.toThrow();
    });
  });

  describe('fetchLatestBundle', () => {
    it('throws when deployment is not configured', async () => {
      const { deployment: _, ...configWithoutDeployment } = VALID_CONFIG;
      const client = new PlatformClient(configWithoutDeployment);
      await expect(client.fetchLatestBundle()).rejects.toThrow(
        'Cannot fetch bundle: deployment is not configured',
      );
    });

    it('constructs correct URL with encoded deployment', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify(VALID_BUNDLE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient({
        ...VALID_CONFIG,
        deployment: 'my deploy',
      });
      await client.fetchLatestBundle();

      expect(capturedUrl).toBe(
        'https://platform.example.com/deployments/my%20deploy/bundle',
      );
    });

    it('sends Authorization header with Bearer token', async () => {
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedHeaders = init?.headers;
          return new Response(JSON.stringify(VALID_BUNDLE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchLatestBundle();

      expect(capturedHeaders).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-platform-test',
        }),
      );
    });

    it('returns validated bundle on success', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_BUNDLE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const bundle = await client.fetchLatestBundle();

      expect(bundle.version).toBe('1.0.0');
      expect(bundle.tools).toEqual([]);
      expect(bundle.roles).toEqual([]);
    });

    it('throws FETCH_FAILED on HTTP 401', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Unauthorized', { status: 401 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(client.fetchLatestBundle()).rejects.toThrow(
        VersionBundleError,
      );
      await expect(client.fetchLatestBundle()).rejects.toThrow(/HTTP 401/);
    });

    it('throws FETCH_FAILED on HTTP 404', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Not Found', { status: 404 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const error = await client
        .fetchLatestBundle()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VersionBundleError);
      expect((error as VersionBundleError).code).toBe('FETCH_FAILED');
    });

    it('throws FETCH_FAILED on HTTP 500', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Internal Server Error', { status: 500 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const error = await client
        .fetchLatestBundle()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VersionBundleError);
      expect((error as VersionBundleError).code).toBe('FETCH_FAILED');
      expect((error as VersionBundleError).message).toContain('HTTP 500');
    });

    it('throws PARSE_FAILED on invalid JSON', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response('not json', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const error = await client
        .fetchLatestBundle()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VersionBundleError);
      expect((error as VersionBundleError).code).toBe('PARSE_FAILED');
    });

    it('throws VALIDATION_FAILED on invalid bundle schema', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ invalid: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const error = await client
        .fetchLatestBundle()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VersionBundleError);
      expect((error as VersionBundleError).code).toBe('VALIDATION_FAILED');
    });

    it('throws FETCH_FAILED on network error', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const error = await client
        .fetchLatestBundle()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VersionBundleError);
      expect((error as VersionBundleError).code).toBe('FETCH_FAILED');
    });

    it('throws FETCH_FAILED on abort/timeout', async () => {
      globalThis.fetch = vi.fn(async () => {
        const err = new DOMException('The operation was aborted', 'AbortError');
        throw err;
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const error = await client
        .fetchLatestBundle()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VersionBundleError);
      expect((error as VersionBundleError).code).toBe('FETCH_FAILED');
      expect((error as VersionBundleError).message).toContain('timed out');
    });

    it('passes custom timeout to abort controller', async () => {
      let capturedSignal: AbortSignal | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedSignal = init?.signal ?? undefined;
          return new Response(JSON.stringify(VALID_BUNDLE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchLatestBundle(5000);

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);
    });

    it('sends Accept: application/json header', async () => {
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedHeaders = init?.headers;
          return new Response(JSON.stringify(VALID_BUNDLE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchLatestBundle();

      expect(capturedHeaders).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
        }),
      );
    });

    it('returns bundle with tools and roles', async () => {
      const bundleWithData = {
        version: '2.0.0',
        tools: [
          {
            type: 'http',
            name: 'get_devices',
            displayName: 'Get Devices',
            description: 'Fetch devices',
            method: 'GET',
            urlTemplate: '{{connections.api.base_url}}/devices',
            parameters: {},
          },
        ],
        skills: [
          { name: 'triage', description: 'Triage skill', body: '# Triage' },
        ],
        handlers: {},
        dependencies: {},
        roles: [{ name: 'analyst', tools: ['get_devices'] }],
        automations: [],
      };

      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(bundleWithData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const bundle = await client.fetchLatestBundle();

      expect(bundle.version).toBe('2.0.0');
      expect(bundle.tools).toHaveLength(1);
      expect(bundle.roles).toHaveLength(1);
      expect(bundle.skills).toHaveLength(1);
    });
  });

  describe('fetchOrganization', () => {
    const MOCK_ORG = {
      id: 'org-123',
      name: 'SurveillanceCo',
    };

    it('constructs correct URL with encoded orgId', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify(MOCK_ORG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchOrganization('org 123');

      expect(capturedUrl).toBe(
        'https://platform.example.com/api/orgs/org%20123',
      );
    });

    it('sends Bearer auth header', async () => {
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedHeaders = init?.headers;
          return new Response(JSON.stringify(MOCK_ORG), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchOrganization('org-123');

      expect(capturedHeaders).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-platform-test',
        }),
      );
    });

    it('returns org record on success', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(MOCK_ORG), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const org = await client.fetchOrganization('org-123');

      expect(org.id).toBe('org-123');
      expect(org.name).toBe('SurveillanceCo');
    });

    it('throws on HTTP 404', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Not Found', { status: 404 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchOrganization('org-missing'),
      ).rejects.toThrow('HTTP 404');
    });

    it('throws on network error', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchOrganization('org-1'),
      ).rejects.toThrow('Failed to fetch organization');
    });
  });

  describe('fetchDocuments', () => {
    const API_RESPONSE_DOCS = [
      {
        id: 'doc-1',
        scope_type: 'application',
        scope_id: 'app-1',
        title: 'API Docs',
        category: 'methodology',
        body: 'How the API works.',
        status: 'active',
        created_by: 'admin',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];

    it('fetches application-scope documents using /api/applications/ path', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(
        async (input: RequestInfo | URL) => {
          capturedUrl =
            typeof input === 'string' ? input : input.toString();
          return new Response(JSON.stringify(API_RESPONSE_DOCS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const docs = await client.fetchDocuments('application', 'app-123');

      expect(capturedUrl).toBe(
        'https://platform.example.com/api/applications/app-123/documents',
      );
      expect(docs).toEqual(API_RESPONSE_DOCS);
    });

    it('fetches tenant-scope documents using /api/tenants/ path', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(
        async (input: RequestInfo | URL) => {
          capturedUrl =
            typeof input === 'string' ? input : input.toString();
          return new Response(JSON.stringify([{
            ...API_RESPONSE_DOCS[0],
            scope_type: 'tenant',
            scope_id: 'ten-456',
          }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const docs = await client.fetchDocuments('tenant', 'ten-456');

      expect(capturedUrl).toBe(
        'https://platform.example.com/api/tenants/ten-456/documents',
      );
      expect(docs[0]?.scope_type).toBe('tenant');
    });

    it('returns documents with scope_type as-is from API', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(API_RESPONSE_DOCS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const docs = await client.fetchDocuments('application', 'app-1');

      expect(docs[0]?.scope_type).toBe('application');
    });

    it('throws on HTTP 404', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response('Not Found', { status: 404 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchDocuments('application', 'app-missing'),
      ).rejects.toThrow('HTTP 404');
    });

    it('throws on network error', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchDocuments('application', 'app-1'),
      ).rejects.toThrow('Failed to fetch documents');
    });

    it('handles empty array response', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const docs = await client.fetchDocuments('application', 'app-1');
      expect(docs).toEqual([]);
    });

    it('sends Authorization header with Bearer token', async () => {
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedHeaders = init?.headers;
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchDocuments('application', 'app-1');

      expect(capturedHeaders).toBeDefined();
      const headers = capturedHeaders as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-platform-test');
    });
  });

  describe('fetchDocumentsByTags', () => {
    it('sends tags as query param', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchDocumentsByTags('application', 'app-1', [
        'api-docs',
        'endpoints',
      ]);

      expect(capturedUrl).toContain('tags=api-docs%2Cendpoints');
      expect(capturedUrl).toContain('/api/applications/app-1/documents');
    });
  });

  describe('searchDocuments', () => {
    it('sends search as query param', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.searchDocuments('tenant', 'ten-1', 'threat');

      expect(capturedUrl).toContain('search=threat');
      expect(capturedUrl).toContain('/api/tenants/ten-1/documents');
    });
  });

  describe('fetchDocumentsByIds', () => {
    it('sends ids as query param', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchDocumentsByIds('application', 'app-1', ['doc-1', 'doc-3']);

      expect(capturedUrl).toContain('ids=doc-1%2Cdoc-3');
      expect(capturedUrl).toContain('/api/applications/app-1/documents');
    });
  });

  describe('fetchApplication', () => {
    const MOCK_APP = {
      id: 'app-123',
      org_id: 'org-1',
      name: 'TestApp',
      base_prompt: 'You are an investigation agent.',
      agent_context: 'Monitoring wireless devices.',
    };

    it('constructs correct URL with encoded appId', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify(MOCK_APP), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchApplication('app 123');

      expect(capturedUrl).toBe(
        'https://platform.example.com/api/applications/app%20123',
      );
    });

    it('returns app record on success', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(MOCK_APP), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const app = await client.fetchApplication('app-123');

      expect(app.id).toBe('app-123');
      expect(app.name).toBe('TestApp');
      expect(app.base_prompt).toBe('You are an investigation agent.');
      expect(app.agent_context).toBe('Monitoring wireless devices.');
    });

    it('throws on HTTP 404', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Not Found', { status: 404 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchApplication('app-missing'),
      ).rejects.toThrow('HTTP 404');
    });

    it('throws on network error', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchApplication('app-1'),
      ).rejects.toThrow('Failed to fetch application');
    });
  });

  describe('resolveSecrets', () => {
    const MOCK_SECRETS = [
      { name: 'API_BASE_URL', value: 'https://api.example.com' },
      { name: 'API_KEY', value: 'sk-secret-123' },
    ];

    it('constructs correct URL with encoded tenantId', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify(MOCK_SECRETS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.resolveSecrets('ten 456');

      expect(capturedUrl).toBe(
        'https://platform.example.com/api/tenants/ten%20456/secrets/resolve',
      );
    });

    it('sends Authorization header with Bearer token', async () => {
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedHeaders = init?.headers;
          return new Response(JSON.stringify(MOCK_SECRETS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.resolveSecrets('seg-1');

      expect(capturedHeaders).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-platform-test',
        }),
      );
    });

    it('returns resolved secrets on success', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(MOCK_SECRETS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const secrets = await client.resolveSecrets('seg-1');

      expect(secrets).toHaveLength(2);
      expect(secrets[0]).toEqual({
        name: 'API_BASE_URL',
        value: 'https://api.example.com',
      });
      expect(secrets[1]).toEqual({
        name: 'API_KEY',
        value: 'sk-secret-123',
      });
    });

    it('throws on HTTP 404', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Not Found', { status: 404 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.resolveSecrets('seg-missing'),
      ).rejects.toThrow('HTTP 404');
    });

    it('throws on network error', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.resolveSecrets('seg-1'),
      ).rejects.toThrow('Failed to fetch secrets');
    });

    it('handles empty array response', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const secrets = await client.resolveSecrets('seg-1');
      expect(secrets).toEqual([]);
    });
  });

  describe('fetchConnections', () => {
    const MOCK_CONNECTIONS = [
      {
        id: 'conn-1',
        name: 'datadog',
        provider: 'Datadog',
        description: 'Monitoring platform',
        credential_schema: { API_KEY: { type: 'string' } },
        request_config: { base_url_field: 'API_BASE_URL' },
      },
      {
        id: 'conn-2',
        name: 'slack',
        provider: 'Slack',
      },
    ];

    it('constructs correct URL with encoded orgId', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify(MOCK_CONNECTIONS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchConnections('org 123');

      expect(capturedUrl).toBe(
        'https://platform.example.com/api/applications/org%20123/connections',
      );
    });

    it('sends Bearer auth header', async () => {
      let capturedHeaders: HeadersInit | undefined;
      globalThis.fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedHeaders = init?.headers;
          return new Response(JSON.stringify(MOCK_CONNECTIONS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await client.fetchConnections('org-1');

      expect(capturedHeaders).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-platform-test',
        }),
      );
    });

    it('returns stripped ConnectionInfo array (no id, credential_schema, request_config)', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(MOCK_CONNECTIONS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      const connections = await client.fetchConnections('org-1');

      expect(connections).toHaveLength(2);
      expect(connections[0]).toEqual({
        name: 'datadog',
        provider: 'Datadog',
        description: 'Monitoring platform',
      });
      expect(connections[1]).toEqual({
        name: 'slack',
        provider: 'Slack',
        description: undefined,
      });
    });

    it('throws on HTTP error', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response('Not Found', { status: 404 }),
      ) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchConnections('org-missing'),
      ).rejects.toThrow('HTTP 404');
    });

    it('throws on timeout', async () => {
      globalThis.fetch = vi.fn(async () => {
        const err = new DOMException('The operation was aborted', 'AbortError');
        throw err;
      }) as typeof fetch;

      const client = new PlatformClient(VALID_CONFIG);
      await expect(
        client.fetchConnections('org-1'),
      ).rejects.toThrow('timed out');
    });
  });
});
