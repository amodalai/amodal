/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useImagePaste,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  MAX_IMAGE_COUNT,
  DEFAULT_IMAGE_PROMPT,
} from '../useImagePaste';

function makeFile(name: string, type: string, size: number): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

// Minimal mock for FileReader since jsdom's doesn't fire onload synchronously
class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(_file: File) {
    // Simulate a small base64 data URI
    this.result = `data:image/png;base64,iVBORw0KGgo=`;
    setTimeout(() => this.onload?.(), 0);
  }
}

describe('useImagePaste', () => {
  it('exports DEFAULT_IMAGE_PROMPT constant', () => {
    expect(DEFAULT_IMAGE_PROMPT).toBe('Analyze this image.');
  });

  it('exports ACCEPTED_IMAGE_TYPES with expected types', () => {
    expect(ACCEPTED_IMAGE_TYPES.has('image/png')).toBe(true);
    expect(ACCEPTED_IMAGE_TYPES.has('image/jpeg')).toBe(true);
    expect(ACCEPTED_IMAGE_TYPES.has('image/gif')).toBe(true);
    expect(ACCEPTED_IMAGE_TYPES.has('image/webp')).toBe(true);
    expect(ACCEPTED_IMAGE_TYPES.has('image/bmp')).toBe(false);
  });

  it('exports MAX_IMAGE_SIZE as 5 MB', () => {
    expect(MAX_IMAGE_SIZE).toBe(5 * 1024 * 1024);
  });

  it('exports MAX_IMAGE_COUNT as 5', () => {
    expect(MAX_IMAGE_COUNT).toBe(5);
  });

  it('rejects unsupported mime type and calls onReject', () => {
    const onReject = vi.fn();
    const { result } = renderHook(() => useImagePaste({ onReject }));

    act(() => {
      result.current.addImageFromFile(makeFile('test.bmp', 'image/bmp', 100));
    });

    expect(onReject).toHaveBeenCalledWith('Unsupported image type: image/bmp');
    expect(result.current.images).toHaveLength(0);
  });

  it('rejects oversized file and calls onReject', () => {
    const onReject = vi.fn();
    const { result } = renderHook(() => useImagePaste({ onReject }));

    act(() => {
      result.current.addImageFromFile(makeFile('big.png', 'image/png', MAX_IMAGE_SIZE + 1));
    });

    expect(onReject).toHaveBeenCalledWith('Image exceeds 5 MB limit');
    expect(result.current.images).toHaveLength(0);
  });

  it('enforces max 5 images and calls onReject', async () => {
    const originalFileReader = globalThis.FileReader;
    // @ts-expect-error -- mock FileReader
    globalThis.FileReader = MockFileReader;

    try {
      const onReject = vi.fn();
      const { result } = renderHook(() => useImagePaste({ onReject }));

      // Add 5 valid images
      for (let i = 0; i < MAX_IMAGE_COUNT; i++) {
        act(() => {
          result.current.addImageFromFile(makeFile(`img${i}.png`, 'image/png', 100));
        });
      }

      // Wait for all FileReader callbacks to fire
      await waitFor(() => {
        expect(result.current.images).toHaveLength(MAX_IMAGE_COUNT);
      });

      // 6th should be rejected
      act(() => {
        result.current.addImageFromFile(makeFile('img5.png', 'image/png', 100));
      });

      await waitFor(() => {
        expect(onReject).toHaveBeenCalledWith(`Maximum of ${MAX_IMAGE_COUNT} images allowed`);
      });
    } finally {
      globalThis.FileReader = originalFileReader;
    }
  });

  it('adds a valid image via addImageFromFile', async () => {
    const originalFileReader = globalThis.FileReader;
    // @ts-expect-error -- mock FileReader
    globalThis.FileReader = MockFileReader;

    try {
      const { result } = renderHook(() => useImagePaste());

      act(() => {
        result.current.addImageFromFile(makeFile('photo.png', 'image/png', 1024));
      });

      await waitFor(() => {
        expect(result.current.images).toHaveLength(1);
      });

      expect(result.current.images[0].mimeType).toBe('image/png');
      expect(result.current.images[0].data).toBe('iVBORw0KGgo=');
      expect(result.current.images[0].preview).toBe('data:image/png;base64,iVBORw0KGgo=');
    } finally {
      globalThis.FileReader = originalFileReader;
    }
  });
});
