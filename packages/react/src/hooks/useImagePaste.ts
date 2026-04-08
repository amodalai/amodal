/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';

export interface ImageAttachment {
  mimeType: string;
  data: string; // base64, no data URI prefix
  preview: string; // data URI for rendering
}

export const DEFAULT_IMAGE_PROMPT = 'Analyze this image.';
export const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_COUNT = 5;

export interface UseImagePasteOptions {
  onReject?: (reason: string) => void;
}

export function useImagePaste(opts?: UseImagePasteOptions) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const onRejectRef = useRef(opts?.onReject);
  onRejectRef.current = opts?.onReject;

  const addImageFromFile = useCallback((file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      onRejectRef.current?.(`Unsupported image type: ${file.type}`);
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      onRejectRef.current?.(`Image exceeds 5 MB limit`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = String(reader.result);
      const base64 = dataUri.split(',')[1];
      setImages((prev) => {
        if (prev.length >= MAX_IMAGE_COUNT) {
          onRejectRef.current?.(`Maximum of ${String(MAX_IMAGE_COUNT)} images allowed`);
          return prev;
        }
        return [...prev, {
          mimeType: file.type,
          data: base64,
          preview: dataUri,
        }];
      });
    };
    reader.onerror = () => {
      // eslint-disable-next-line no-console -- surface FileReader failures for debugging
      console.warn('[useImagePaste] FileReader failed for', file.name, reader.error);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file);
        return;
      }
    }
  }, [addImageFromFile]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
  }, []);

  return { images, handlePaste, removeImage, clearImages, addImageFromFile };
}
