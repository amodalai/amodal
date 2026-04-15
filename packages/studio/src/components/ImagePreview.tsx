/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

''/**
 * Renders a row of image thumbnails from tool results.
 * Accepts URL strings or base64 data objects.
 * Clicking an image opens it full-size in a new tab.
 */

import { useState } from 'react';
import { ImageOff } from 'lucide-react';

export type ImageSource =
  | string
  | { mimeType: string; data: string };

interface ImagePreviewProps {
  images: ImageSource[];
}

function toSrc(img: ImageSource): string {
  if (typeof img === 'string') return img;
  // Some MCP tools return data as a full data URI already
  if (img.data.startsWith('data:')) return img.data;
  return `data:${img.mimeType};base64,${img.data}`;
}

function toAlt(img: ImageSource, i: number): string {
  if (typeof img === 'string') {
    try { return new URL(img).pathname.split('/').pop() ?? `Image ${String(i + 1)}`; } catch { return `Image ${String(i + 1)}`; }
  }
  return `Image ${String(i + 1)}`;
}

function ImageThumbnail({ img, index }: { img: ImageSource; index: number }) {
  const [failed, setFailed] = useState(false);
  const src = toSrc(img);
  const alt = toAlt(img, index);

  if (failed) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-muted border border-border text-xs text-muted-foreground max-w-[200px]">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{typeof img === 'string' ? img : alt}</span>
      </div>
    );
  }

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block shrink-0">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-[200px] max-w-[300px] rounded-lg border border-border object-contain bg-muted"
      />
    </a>
  );
}

export function ImagePreview({ images }: ImagePreviewProps) {
  if (images.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap px-3.5 pb-2 pt-1">
      {images.map((img, i) => (
        <ImageThumbnail key={i} img={img} index={i} />
      ))}
    </div>
  );
}
