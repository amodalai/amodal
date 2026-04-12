/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {createHmac, timingSafeEqual} from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Payload carried inside a signed preview token.
 *
 * Tokens grant one user temporary access to one preview snapshot. The runtime
 * uses `snapshotId` to locate the bundle, `userId` for audit logging and
 * per-user rate limiting, and `expiresAt` to enforce the TTL.
 */
export interface PreviewTokenPayload {
  /** The snapshot ID this token grants access to. */
  snapshotId: string;
  /** The user who requested the preview (for audit + per-user rate limiting). */
  userId: string;
  /** ISO-8601 expiration timestamp. */
  expiresAt: string;
}

export interface SignPreviewTokenOptions {
  payload: PreviewTokenPayload;
  /**
   * HMAC-SHA256 key. Interpreted as a raw UTF-8 string — callers are free to
   * pass a hex or base64 value, it's treated as opaque bytes by
   * `createHmac`. Must be non-empty; empty secrets throw
   * `PreviewTokenSecretMissingError`.
   */
  secret: string;
}

export interface VerifyPreviewTokenOptions {
  token: string;
  secret: string;
  /** Clock for testability. Defaults to `Date.now`. */
  now?: () => number;
}

export type VerifyPreviewTokenFailureReason =
  | 'malformed'
  | 'invalid_signature'
  | 'expired';

export type VerifyPreviewTokenResult =
  | {ok: true; payload: PreviewTokenPayload}
  | {ok: false; reason: VerifyPreviewTokenFailureReason};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when `signPreviewToken` or `verifyPreviewToken` is invoked with an
 * empty secret. This is a configuration bug — the `PREVIEW_TOKEN_SECRET` env
 * var is missing or blank — not a user-facing denial, so we throw rather than
 * fold it into `VerifyPreviewTokenResult`.
 */
export class PreviewTokenSecretMissingError extends Error {
  override readonly name = 'PreviewTokenSecretMissingError';

  constructor() {
    super(
      'PREVIEW_TOKEN_SECRET is empty. Set a non-empty secret before signing or verifying preview tokens.',
    );
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function assertSecret(secret: string): void {
  if (secret === '') {
    throw new PreviewTokenSecretMissingError();
  }
}

function encodePayload(payload: PreviewTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function isPreviewTokenPayload(value: unknown): value is PreviewTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!('snapshotId' in value) || typeof value.snapshotId !== 'string') return false;
  if (!('userId' in value) || typeof value.userId !== 'string') return false;
  if (!('expiresAt' in value) || typeof value.expiresAt !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce a signed preview token.
 *
 * Wire format: `base64url(JSON(payload)) + "." + base64url(hmacSha256(base64url(JSON(payload))))`.
 * Two `.`-separated base64url parts. No algorithm header — HMAC-SHA256 is
 * hard-coded, so there is nothing to negotiate and no `alg: none` attack
 * surface.
 */
export function signPreviewToken(options: SignPreviewTokenOptions): string {
  const {payload, secret} = options;
  assertSecret(secret);

  const encodedPayload = encodePayload(payload);
  const signature = hmac(secret, encodedPayload).toString('base64url');
  return `${encodedPayload}.${signature}`;
}

/**
 * Parse a token and validate its signature + expiration against the given
 * secret.
 *
 * Returns a discriminated result rather than throwing so callers can map
 * failure reasons to different HTTP responses (401 for invalid, 410 for
 * expired, etc.) without pattern-matching on error messages. Unexpected
 * errors (bugs, missing secret) still throw — callers should not try to
 * swallow those.
 *
 * Signature comparison is constant-time via `timingSafeEqual`.
 *
 * Expiration semantics: a token is considered expired when
 * `expiresAt <= now` — i.e. exactly-at-now counts as expired. This matches
 * the typical "strictly less than now is valid" convention and gives callers
 * a monotonic boundary.
 */
export function verifyPreviewToken(
  options: VerifyPreviewTokenOptions,
): VerifyPreviewTokenResult {
  const {token, secret, now = Date.now} = options;
  assertSecret(secret);

  // 1. Split on `.` — must be exactly two parts.
  const parts = token.split('.');
  if (parts.length !== 2) {
    return {ok: false, reason: 'malformed'};
  }
  const encodedPayload = parts[0];
  const encodedSignature = parts[1];
  if (
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    encodedPayload === '' ||
    encodedSignature === ''
  ) {
    return {ok: false, reason: 'malformed'};
  }

  // 2. Decode payload bytes and parse as JSON. Validate shape.
  let payloadJson: string;
  try {
    const decoded = Buffer.from(encodedPayload, 'base64url');
    // Node's base64url decoder is lenient (it accepts some non-base64 chars
    // by dropping them), so round-trip to detect garbage input.
    if (decoded.toString('base64url') !== encodedPayload) {
      return {ok: false, reason: 'malformed'};
    }
    payloadJson = decoded.toString('utf8');
  } catch {
    return {ok: false, reason: 'malformed'};
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadJson);
  } catch {
    return {ok: false, reason: 'malformed'};
  }

  if (!isPreviewTokenPayload(parsedPayload)) {
    return {ok: false, reason: 'malformed'};
  }

  // 3. Recompute HMAC over the wire-form payload bytes (not the decoded
  //    object — the signed bytes are what travelled on the wire) and compare
  //    constant-time. Length mismatch is an immediate invalid_signature
  //    because timingSafeEqual throws on unequal-length buffers.
  const expectedSignature = hmac(secret, encodedPayload);
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(encodedSignature, 'base64url');
    if (actualSignature.toString('base64url') !== encodedSignature) {
      return {ok: false, reason: 'invalid_signature'};
    }
  } catch {
    return {ok: false, reason: 'invalid_signature'};
  }

  if (actualSignature.length !== expectedSignature.length) {
    return {ok: false, reason: 'invalid_signature'};
  }
  if (!timingSafeEqual(actualSignature, expectedSignature)) {
    return {ok: false, reason: 'invalid_signature'};
  }

  // 4. Expiration check. Unparseable ISO timestamps are treated as malformed.
  const expiresMs = Date.parse(parsedPayload.expiresAt);
  if (Number.isNaN(expiresMs)) {
    return {ok: false, reason: 'malformed'};
  }
  if (expiresMs <= now()) {
    return {ok: false, reason: 'expired'};
  }

  return {ok: true, payload: parsedPayload};
}
