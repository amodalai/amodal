/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Extract image URLs from a tool result string.
 *
 * Detects HTTPS URLs ending in common image extensions or matching
 * known image CDN patterns, plus base64 data URIs. Returns
 * deduplicated URLs, capped at 10.
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp)(\?[^\s"')\]]*)?$/i;

const IMAGE_URL_PATTERN = new RegExp(
  'https://[^\\s"\'<>)\\]]+',
  'gi',
);

/** Match data:image/... URIs (base64 inline images from tools like generate_image). */
const DATA_URI_PATTERN = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;

const MAX_IMAGE_URLS = 10;

export function extractImageUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  // 1. Extract data URIs first (higher priority — they're self-contained)
  const dataMatches = text.match(DATA_URI_PATTERN);
  if (dataMatches) {
    for (const uri of dataMatches) {
      if (seen.has(uri)) continue;
      seen.add(uri);
      urls.push(uri);
      if (urls.length >= MAX_IMAGE_URLS) return urls;
    }
  }

  // 2. Extract HTTPS image URLs
  const httpsMatches = text.match(IMAGE_URL_PATTERN);
  if (httpsMatches) {
    for (const url of httpsMatches) {
      const cleaned = url.replace(/[.,;:!?]+$/, '');
      if (!IMAGE_EXTENSIONS.test(cleaned)) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      urls.push(cleaned);
      if (urls.length >= MAX_IMAGE_URLS) break;
    }
  }

  return urls;
}
