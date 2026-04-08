/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
import {describe, it, expect} from 'vitest';
import {extractImageUrls} from './extractImageUrls';

describe('extractImageUrls', () => {
  it('extracts URLs with common image extensions', () => {
    const text = 'Here is an image: https://example.com/photo.png and another https://cdn.example.com/banner.jpg';
    expect(extractImageUrls(text)).toEqual([
      'https://example.com/photo.png',
      'https://cdn.example.com/banner.jpg',
    ]);
  });

  it('handles URLs with query params', () => {
    const text = 'https://images.example.com/photo.png?width=300&quality=80';
    expect(extractImageUrls(text)).toEqual([
      'https://images.example.com/photo.png?width=300&quality=80',
    ]);
  });

  it('supports jpeg, gif, webp, svg, bmp extensions', () => {
    const text = [
      'https://a.com/1.jpeg',
      'https://a.com/2.gif',
      'https://a.com/3.webp',
      'https://a.com/4.svg',
      'https://a.com/5.bmp',
    ].join(' ');
    expect(extractImageUrls(text)).toHaveLength(5);
  });

  it('rejects non-HTTPS URLs', () => {
    const text = 'http://example.com/photo.png';
    expect(extractImageUrls(text)).toEqual([]);
  });

  it('rejects non-image URLs', () => {
    const text = 'https://example.com/document.pdf https://example.com/data.json';
    expect(extractImageUrls(text)).toEqual([]);
  });

  it('deduplicates URLs', () => {
    const text = 'https://a.com/img.png and again https://a.com/img.png';
    expect(extractImageUrls(text)).toEqual(['https://a.com/img.png']);
  });

  it('caps at 10 URLs', () => {
    const urls = Array.from({length: 15}, (_, i) => `https://a.com/${String(i)}.png`).join(' ');
    expect(extractImageUrls(urls)).toHaveLength(10);
  });

  it('returns empty for no matches', () => {
    expect(extractImageUrls('no images here')).toEqual([]);
    expect(extractImageUrls('')).toEqual([]);
  });

  it('strips trailing punctuation', () => {
    const text = 'See https://a.com/img.png.';
    expect(extractImageUrls(text)).toEqual(['https://a.com/img.png']);
  });

  it('handles URLs in JSON strings', () => {
    const text = '{"url":"https://example.com/generated.png","revised_prompt":"a cat"}';
    expect(extractImageUrls(text)).toEqual(['https://example.com/generated.png']);
  });
});
