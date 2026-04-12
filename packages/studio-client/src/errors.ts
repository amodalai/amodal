/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/** Thrown when the Studio API returns a non-OK HTTP response. */
export class StudioFetchError extends Error {
  override readonly name = 'StudioFetchError';

  constructor(
    readonly url: string,
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(
      `Studio API request failed: ${status} ${statusText} (${url})`,
    );
  }
}

/** Thrown when the Studio API response body cannot be parsed as JSON. */
export class StudioResponseParseError extends Error {
  override readonly name = 'StudioResponseParseError';

  constructor(
    readonly url: string,
    parseError: unknown,
  ) {
    super(`Failed to parse Studio API response as JSON (${url})`, { cause: parseError });
  }
}
