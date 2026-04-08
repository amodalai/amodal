/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent, ClipboardEvent } from 'react';

export interface ImageAttachment {
  mimeType: string;
  data: string; // base64, no data URI prefix
  preview: string; // data URI for rendering
}

interface InputBarProps {
  onSend: (text: string, images?: ImageAttachment[]) => void;
  onStop?: () => void;
  disabled: boolean;
  isStreaming?: boolean;
  placeholder: string;
}

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function InputBar({ onSend, onStop, disabled, isStreaming, placeholder }: InputBarProps) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addImageFromFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.has(file.type)) return;
    if (file.size > MAX_IMAGE_SIZE) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = String(reader.result);
      const base64 = dataUri.split(',')[1];
      setImages((prev) => [...prev, {
        mimeType: file.type,
        data: base64,
        preview: dataUri,
      }]);
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

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0 && images.length === 0) return;
    onSend(trimmed || 'Analyze this image.', images.length > 0 ? images : undefined);
    setValue('');
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, images, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, 120))}px`;
  }, []);

  return (
    <div className="pcw-input">
      {images.length > 0 && (
        <div className="pcw-input__images">
          {images.map((img, i) => (
            <div key={i} className="pcw-input__image-thumb">
              <img src={img.preview} alt="Attachment" />
              <button
                type="button"
                className="pcw-input__image-remove"
                onClick={() => removeImage(i)}
                aria-label="Remove image"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="pcw-input__textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onPaste={handlePaste}
        placeholder={placeholder}
        disabled={disabled && !isStreaming}
        rows={1}
      />
      {isStreaming ? (
        <button
          type="button"
          className="pcw-input__send pcw-input__stop"
          onClick={onStop}
          aria-label="Stop generating"
        >
          <StopIcon />
        </button>
      ) : (
        <button
          type="button"
          className="pcw-input__send"
          onClick={handleSend}
          disabled={disabled || (value.trim().length === 0 && images.length === 0)}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      )}
    </div>
  );
}
