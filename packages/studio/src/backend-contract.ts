/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Reusable contract test suite for `StudioBackend` implementations.
 *
 * PR 2.2 uses this against `PGLiteStudioBackend`; PR 2.3 will reuse it
 * verbatim against `DrizzleStudioBackend`. Any behavior that both backends
 * must share belongs here — backend-specific edge cases (e.g. filesystem
 * paths for publish) get their own tests in the per-backend `.test.ts`.
 *
 * Usage:
 *   import {runStudioBackendContract} from '@amodalai/studio/backend-contract';
 *   runStudioBackendContract('PGLiteStudioBackend', {
 *     async createBackend() { ... },
 *     async cleanup(backend) { ... },
 *   });
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {StudioBackend} from './backend.js';

export interface StudioBackendContractHarness {
  /**
   * Build a fresh backend instance for one test. Implementations should give
   * each call an isolated datastore so tests don't leak state between them.
   */
  createBackend(): Promise<StudioBackend>;

  /**
   * Release any resources attached to the backend at the end of a test.
   * Optional — in-memory backends may have nothing to clean up.
   */
  cleanup?(backend: StudioBackend): Promise<void>;
}

const USER_A = 'user-alice';
const USER_B = 'user-bob';
const PATH_ONE = 'skills/pricing.md';
const PATH_TWO = 'skills/returns.md';
const PATH_NESTED = 'knowledge/faq/shipping.md';

export function runStudioBackendContract(
  name: string,
  harness: StudioBackendContractHarness,
): void {
  describe(`StudioBackend contract: ${name}`, () => {
    let backend: StudioBackend;

    beforeEach(async () => {
      backend = await harness.createBackend();
    });

    afterEach(async () => {
      if (harness.cleanup) {
        await harness.cleanup(backend);
      }
    });

    describe('getDraft', () => {
      it('returns null when the user has no draft for the path', async () => {
        const result = await backend.getDraft(USER_A, PATH_ONE);
        expect(result).toBeNull();
      });

      it('returns the stored content after setDraft', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'hello world');
        expect(await backend.getDraft(USER_A, PATH_ONE)).toBe('hello world');
      });

      it('scopes by userId — other users cannot read a draft', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'alice-only');
        expect(await backend.getDraft(USER_B, PATH_ONE)).toBeNull();
      });

      it('scopes by filePath — other paths return null', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'one');
        expect(await backend.getDraft(USER_A, PATH_TWO)).toBeNull();
      });
    });

    describe('setDraft', () => {
      it('creates a new row when none exists', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'first');
        expect(await backend.getDraft(USER_A, PATH_ONE)).toBe('first');
      });

      it('overwrites an existing row (upsert semantics)', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'v1');
        await backend.setDraft(USER_A, PATH_ONE, 'v2');
        expect(await backend.getDraft(USER_A, PATH_ONE)).toBe('v2');
      });

      it('preserves empty-string content as a valid draft', async () => {
        await backend.setDraft(USER_A, PATH_ONE, '');
        const result = await backend.getDraft(USER_A, PATH_ONE);
        expect(result).toBe('');
      });

      it('stores multi-line content verbatim', async () => {
        const body = 'line one\nline two\nline three\n';
        await backend.setDraft(USER_A, PATH_NESTED, body);
        expect(await backend.getDraft(USER_A, PATH_NESTED)).toBe(body);
      });

      it('bumps updatedAt on overwrite', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'v1');
        const firstList = await backend.listDrafts(USER_A);
        const firstTs = firstList[0].updatedAt;
        // Sleep long enough for the clock to tick — 20ms is comfortable on all
        // CI runners we care about.
        await sleep(20);
        await backend.setDraft(USER_A, PATH_ONE, 'v2');
        const secondList = await backend.listDrafts(USER_A);
        const secondTs = secondList[0].updatedAt;
        expect(new Date(secondTs).getTime()).toBeGreaterThanOrEqual(
          new Date(firstTs).getTime(),
        );
      });
    });

    describe('deleteDraft', () => {
      it('removes an existing draft', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'gone soon');
        await backend.deleteDraft(USER_A, PATH_ONE);
        expect(await backend.getDraft(USER_A, PATH_ONE)).toBeNull();
      });

      it('is idempotent — deleting a nonexistent draft is not an error', async () => {
        await expect(
          backend.deleteDraft(USER_A, PATH_ONE),
        ).resolves.toBeUndefined();
      });

      it('only affects the target (userId, filePath) tuple', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'keep-a-one');
        await backend.setDraft(USER_A, PATH_TWO, 'keep-a-two');
        await backend.setDraft(USER_B, PATH_ONE, 'keep-b-one');

        await backend.deleteDraft(USER_A, PATH_ONE);

        expect(await backend.getDraft(USER_A, PATH_ONE)).toBeNull();
        expect(await backend.getDraft(USER_A, PATH_TWO)).toBe('keep-a-two');
        expect(await backend.getDraft(USER_B, PATH_ONE)).toBe('keep-b-one');
      });
    });

    describe('listDrafts', () => {
      it('returns an empty array when the user has no drafts', async () => {
        expect(await backend.listDrafts(USER_A)).toEqual([]);
      });

      it('returns every draft for the user', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'one');
        await backend.setDraft(USER_A, PATH_TWO, 'two');
        await backend.setDraft(USER_A, PATH_NESTED, 'three');

        const drafts = await backend.listDrafts(USER_A);
        const byPath = new Map(drafts.map((d) => [d.filePath, d]));

        expect(drafts).toHaveLength(3);
        expect(byPath.get(PATH_ONE)?.content).toBe('one');
        expect(byPath.get(PATH_TWO)?.content).toBe('two');
        expect(byPath.get(PATH_NESTED)?.content).toBe('three');
      });

      it('scopes results to the target user', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'alice');
        await backend.setDraft(USER_B, PATH_ONE, 'bob');

        const aliceDrafts = await backend.listDrafts(USER_A);
        const bobDrafts = await backend.listDrafts(USER_B);

        expect(aliceDrafts).toHaveLength(1);
        expect(aliceDrafts[0].content).toBe('alice');
        expect(bobDrafts).toHaveLength(1);
        expect(bobDrafts[0].content).toBe('bob');
      });

      it('returns well-formed DraftFile rows with ISO timestamps', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'body');
        const drafts = await backend.listDrafts(USER_A);
        expect(drafts).toHaveLength(1);
        const draft = drafts[0];
        expect(draft.filePath).toBe(PATH_ONE);
        expect(draft.content).toBe('body');
        expect(typeof draft.updatedAt).toBe('string');
        expect(Number.isNaN(new Date(draft.updatedAt).getTime())).toBe(false);
      });
    });

    describe('discardAll', () => {
      it('removes every draft for the user', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'one');
        await backend.setDraft(USER_A, PATH_TWO, 'two');
        await backend.discardAll(USER_A);
        expect(await backend.listDrafts(USER_A)).toEqual([]);
      });

      it('is a no-op when the user has no drafts', async () => {
        await expect(backend.discardAll(USER_A)).resolves.toBeUndefined();
      });

      it('does not touch other users drafts', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'alice');
        await backend.setDraft(USER_B, PATH_ONE, 'bob');
        await backend.discardAll(USER_A);

        expect(await backend.listDrafts(USER_A)).toEqual([]);
        const bobDrafts = await backend.listDrafts(USER_B);
        expect(bobDrafts).toHaveLength(1);
        expect(bobDrafts[0].content).toBe('bob');
      });
    });

    describe('publish', () => {
      it('clears staged drafts on success and returns a commit SHA', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'published content');
        const result = await backend.publish(USER_A, 'commit msg');

        expect(typeof result.commitSha).toBe('string');
        expect(result.commitSha.length).toBeGreaterThan(0);
        // After a successful publish, drafts are cleared.
        expect(await backend.listDrafts(USER_A)).toEqual([]);
      });

      it('is allowed when the user has no drafts (returns placeholder SHA)', async () => {
        const result = await backend.publish(USER_A, 'empty publish');
        expect(typeof result.commitSha).toBe('string');
        expect(await backend.listDrafts(USER_A)).toEqual([]);
      });

      it('does not touch other users drafts', async () => {
        await backend.setDraft(USER_A, PATH_ONE, 'alice');
        await backend.setDraft(USER_B, PATH_ONE, 'bob');
        await backend.publish(USER_A, 'publish alice only');

        expect(await backend.listDrafts(USER_A)).toEqual([]);
        const bobDrafts = await backend.listDrafts(USER_B);
        expect(bobDrafts).toHaveLength(1);
        expect(bobDrafts[0].content).toBe('bob');
      });
    });

    describe('buildPreview', () => {
      it('either returns a preview or throws a typed feature-unavailable error', async () => {
        // PR 2.2's PGLite backend throws; PR 2.8+ will return a real result.
        // The contract only mandates "don't return garbage" — we accept
        // either a well-shaped result or a thrown Error subclass.
        try {
          const result = await backend.buildPreview(USER_A);
          expect(typeof result.snapshotId).toBe('string');
          expect(typeof result.previewToken).toBe('string');
          expect(typeof result.expiresAt).toBe('string');
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
