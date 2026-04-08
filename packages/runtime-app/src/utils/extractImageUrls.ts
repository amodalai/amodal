/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp)(\?[^\s"')\]]*)?$/i;

const IMAGE_URL_PATTERN = new RegExp(
  'https://[^\\s"\'<>)\\]]+',
  'gi',
);

const MAX_IMAGE_URLS = 10;

export function extractImageUrls(text: string): string[] {
  const matches = text.match(IMAGE_URL_PATTERN);
  if (!matches) return [];

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const url of matches) {
    // Strip trailing punctuation that might have been captured
    const cleaned = url.replace(/[.,;:!?]+$/, '');
    if (!IMAGE_EXTENSIONS.test(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
    if (urls.length >= MAX_IMAGE_URLS) break;
  }

  return urls;
}
