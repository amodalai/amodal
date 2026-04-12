/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {
  signPreviewToken,
  verifyPreviewToken,
  PreviewTokenSecretMissingError,
  type PreviewTokenPayload,
} from './token.js';

const SECRET = 'test-secret-do-not-use-in-prod';

function futurePayload(overrides: Partial<PreviewTokenPayload> = {}): PreviewTokenPayload {
  return {
    snapshotId: 'snap_abc123',
    userId: 'user_42',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('signPreviewToken / verifyPreviewToken', () => {
  it('round-trips a valid payload', () => {
    const payload = futurePayload();
    const token = signPreviewToken({payload, secret: SECRET});
    const result = verifyPreviewToken({token, secret: SECRET});
    expect(result).toEqual({ok: true, payload});
  });

  it('rejects an expired token', () => {
    const payload = futurePayload({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const token = signPreviewToken({payload, secret: SECRET});
    const result = verifyPreviewToken({token, secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'expired'});
  });

  it('treats expiresAt exactly equal to now as expired', () => {
    // Semantics: expiresAt <= now is expired. Exactly-at-now is NOT valid.
    const fixedNow = 1_700_000_000_000;
    const payload = futurePayload({
      expiresAt: new Date(fixedNow).toISOString(),
    });
    const token = signPreviewToken({payload, secret: SECRET});
    const result = verifyPreviewToken({
      token,
      secret: SECRET,
      now: () => fixedNow,
    });
    expect(result).toEqual({ok: false, reason: 'expired'});
  });

  it('accepts a token one ms before expiry', () => {
    const fixedNow = 1_700_000_000_000;
    const payload = futurePayload({
      expiresAt: new Date(fixedNow + 1).toISOString(),
    });
    const token = signPreviewToken({payload, secret: SECRET});
    const result = verifyPreviewToken({
      token,
      secret: SECRET,
      now: () => fixedNow,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered payload as invalid_signature', () => {
    const token = signPreviewToken({payload: futurePayload(), secret: SECRET});
    const [encodedPayload, signature] = token.split('.') as [string, string];
    // Flip the last character of the payload part to something else that is
    // still valid base64url.
    const last = encodedPayload.slice(-1);
    const replacement = last === 'A' ? 'B' : 'A';
    const tampered = `${encodedPayload.slice(0, -1)}${replacement}.${signature}`;
    const result = verifyPreviewToken({token: tampered, secret: SECRET});
    // Either the flipped byte still decodes to a valid payload shape (→
    // invalid_signature) or it corrupts the JSON (→ malformed). Both are
    // acceptable denials; we assert it is not `ok`.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['invalid_signature', 'malformed']).toContain(result.reason);
    }
  });

  it('rejects a tampered signature', () => {
    const token = signPreviewToken({payload: futurePayload(), secret: SECRET});
    const [encodedPayload, signature] = token.split('.') as [string, string];
    const last = signature.slice(-1);
    const replacement = last === 'A' ? 'B' : 'A';
    const tampered = `${encodedPayload}.${signature.slice(0, -1)}${replacement}`;
    const result = verifyPreviewToken({token: tampered, secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'invalid_signature'});
  });

  it('rejects a token signed with a different secret', () => {
    const token = signPreviewToken({payload: futurePayload(), secret: 'secret-A'});
    const result = verifyPreviewToken({token, secret: 'secret-B'});
    expect(result).toEqual({ok: false, reason: 'invalid_signature'});
  });

  it('returns malformed when there is no separator', () => {
    const result = verifyPreviewToken({token: 'notavalidtoken', secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'malformed'});
  });

  it('returns malformed when there are too many parts', () => {
    const result = verifyPreviewToken({token: 'a.b.c', secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'malformed'});
  });

  it('returns malformed when base64url decode fails', () => {
    const result = verifyPreviewToken({token: '$$$.zzz', secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'malformed'});
  });

  it('returns malformed when the payload is not valid JSON', () => {
    const notJson = Buffer.from('this is not json', 'utf8').toString('base64url');
    // Give it a real signature so we don't trip invalid_signature first —
    // verifyPreviewToken parses the payload before checking the signature.
    const token = `${notJson}.AAAA`;
    const result = verifyPreviewToken({token, secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'malformed'});
  });

  it('returns malformed when the payload JSON is missing required fields', () => {
    const partial = Buffer.from(
      JSON.stringify({snapshotId: 'x', userId: 'y'}),
      'utf8',
    ).toString('base64url');
    const token = `${partial}.AAAA`;
    const result = verifyPreviewToken({token, secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'malformed'});
  });

  it('returns malformed when expiresAt is not a valid date', () => {
    const payload = futurePayload({expiresAt: 'not a date'});
    // Sign it properly so we get past signature check and into the expiry
    // branch.
    const token = signPreviewToken({payload, secret: SECRET});
    const result = verifyPreviewToken({token, secret: SECRET});
    expect(result).toEqual({ok: false, reason: 'malformed'});
  });

  it('throws PreviewTokenSecretMissingError when signing with empty secret', () => {
    expect(() =>
      signPreviewToken({payload: futurePayload(), secret: ''}),
    ).toThrow(PreviewTokenSecretMissingError);
  });

  it('throws PreviewTokenSecretMissingError when verifying with empty secret', () => {
    const token = signPreviewToken({payload: futurePayload(), secret: SECRET});
    expect(() => verifyPreviewToken({token, secret: ''})).toThrow(
      PreviewTokenSecretMissingError,
    );
  });

  it('honors the injected clock', () => {
    const payload = futurePayload({
      expiresAt: new Date(500).toISOString(),
    });
    const token = signPreviewToken({payload, secret: SECRET});

    // At now=0, token is valid.
    const early = verifyPreviewToken({token, secret: SECRET, now: () => 0});
    expect(early.ok).toBe(true);

    // At now=1000, token is expired.
    const late = verifyPreviewToken({token, secret: SECRET, now: () => 1000});
    expect(late).toEqual({ok: false, reason: 'expired'});
  });
});
