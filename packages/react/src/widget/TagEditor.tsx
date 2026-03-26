/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';

export interface TagEditorProps {
  tags: string[];
  onSave: (tags: string[]) => void;
}

export function TagEditor({ tags, onSave }: TagEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleRemove = useCallback(
    (tag: string) => {
      onSave(tags.filter((t) => t !== tag));
    },
    [tags, onSave],
  );

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onSave([...tags, trimmed]);
    }
    setInputValue('');
    setIsEditing(false);
  }, [inputValue, tags, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdd();
      } else if (e.key === 'Escape') {
        setInputValue('');
        setIsEditing(false);
      }
    },
    [handleAdd],
  );

  return (
    <div className="pcw-tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="pcw-tag-badge">
          {tag}
          <button
            type="button"
            className="pcw-tag-remove"
            onClick={() => handleRemove(tag)}
            aria-label={`Remove tag ${tag}`}
          >
            x
          </button>
        </span>
      ))}
      {isEditing ? (
        <input
          className="pcw-tag-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleAdd}
          placeholder="Add tag..."
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="pcw-tag-add-btn"
          onClick={() => setIsEditing(true)}
          aria-label="Add tag"
        >
          +
        </button>
      )}
    </div>
  );
}
