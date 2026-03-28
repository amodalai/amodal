/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import type { WidgetProps } from './WidgetRenderer';

interface DocumentPreviewData {
  preview_id: string;
  resource_type: 'kb_document' | 'tool' | 'skill' | 'subagent' | 'automation';
  title: string;
  body: string;
  category?: string;
  action: 'create' | 'update';
  proposal_id?: string;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'New',
  update: 'Update',
};

export function DocumentPreview({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as DocumentPreviewData;

  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(d.body);
  const [approved, setApproved] = useState(false);

  const handleApprove = useCallback(() => {
    setApproved(true);
    sendMessage(`I've approved the ${d.resource_type} '${d.preview_id}'.`);
  }, [d.resource_type, d.preview_id, sendMessage]);

  const handleEditFirst = useCallback(() => {
    setEditing(true);
  }, []);

  const handleApproveWithEdits = useCallback(() => {
    setApproved(true);
    setEditing(false);
    sendMessage(
      `I've approved the ${d.resource_type} '${d.preview_id}' with edits:\n\n${editedBody}`,
    );
  }, [d.resource_type, d.preview_id, editedBody, sendMessage]);

  if (approved) {
    return (
      <div className="pcw-widget-card pcw-widget-card--document-preview">
        <div className="pcw-document-preview__header">
          <span className="pcw-document-preview__title">{d.title}</span>
          <span className="pcw-document-preview__badge pcw-document-preview__badge--approved">
            Approved
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pcw-widget-card pcw-widget-card--document-preview">
      <div className="pcw-document-preview__header">
        <span className="pcw-document-preview__title">{d.title}</span>
        {d.category && (
          <span className="pcw-document-preview__badge pcw-document-preview__badge--category">
            {d.category}
          </span>
        )}
        <span className="pcw-document-preview__badge pcw-document-preview__badge--action">
          {ACTION_LABELS[d.action] ?? d.action}
        </span>
      </div>
      {editing ? (
        <div className="pcw-document-preview__editor-container">
          <textarea
            className="pcw-document-preview__editor"
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={12}
          />
          <div className="pcw-document-preview__actions">
            <button
              type="button"
              className="pcw-document-preview__btn pcw-document-preview__btn--primary"
              onClick={handleApproveWithEdits}
            >
              Approve with edits
            </button>
            <button
              type="button"
              className="pcw-document-preview__btn pcw-document-preview__btn--secondary"
              onClick={() => {
                setEditing(false);
                setEditedBody(d.body);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <pre className="pcw-document-preview__body">
            <code>{d.body}</code>
          </pre>
          <div className="pcw-document-preview__actions">
            <button
              type="button"
              className="pcw-document-preview__btn pcw-document-preview__btn--primary"
              onClick={handleApprove}
            >
              Approve
            </button>
            <button
              type="button"
              className="pcw-document-preview__btn pcw-document-preview__btn--secondary"
              onClick={handleEditFirst}
            >
              Edit First
            </button>
          </div>
        </>
      )}
    </div>
  );
}
