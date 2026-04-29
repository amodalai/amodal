/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ShowGalleryBlock } from '../types';

interface Props {
  block: ShowGalleryBlock;
  sendMessage?: (text: string) => void;
}

export function ShowGalleryCard({ block, sendMessage }: Props) {
  return (
    <div className="pcw-gallery">
      <div className="pcw-gallery__title">{block.title}</div>
      <div className="pcw-gallery__grid">
        {block.templates.map((t) => (
          <button
            key={t.repo}
            className="pcw-gallery__card"
            onClick={() => sendMessage?.(`I want ${t.title}`)}
          >
            <div className="pcw-gallery__card-title">{t.title}</div>
            <div className="pcw-gallery__card-tagline">{t.tagline}</div>
            <div className="pcw-gallery__card-meta">
              {t.verified && <span className="pcw-gallery__badge">✓</span>}
              <span className="pcw-gallery__author">{t.author}</span>
            </div>
          </button>
        ))}
      </div>
      {block.allow_custom && (
        <button
          className="pcw-gallery__custom"
          onClick={() => sendMessage?.('I want to build something custom')}
        >
          Build custom →
        </button>
      )}
    </div>
  );
}
