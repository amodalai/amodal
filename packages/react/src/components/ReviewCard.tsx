/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ConfirmationInfo } from '../types';

export interface ReviewCardProps {
  confirmation: ConfirmationInfo;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Structured review card: all params, reason, escalation badge, approve/deny.
 */
export function ReviewCard({ confirmation, onApprove, onDeny }: ReviewCardProps) {
  const isPending = confirmation.status === 'pending';

  return (
    <div className="amodal-review-card" data-testid="review-card">
      <div className="amodal-review-card__header">
        <span className="amodal-review-card__method">{confirmation.method}</span>
        <span className="amodal-review-card__endpoint">{confirmation.endpoint}</span>
        {confirmation.escalated && (
          <span className="amodal-review-card__badge" data-testid="escalation-badge">
            Escalated
          </span>
        )}
      </div>
      {confirmation.connectionName && (
        <div className="amodal-review-card__connection">
          Connection: {confirmation.connectionName}
        </div>
      )}
      <p className="amodal-review-card__reason">{confirmation.reason}</p>
      {confirmation.params && Object.keys(confirmation.params).length > 0 && (
        <div className="amodal-review-card__params" data-testid="review-params">
          <div className="amodal-review-card__params-title">Parameters</div>
          <pre className="amodal-review-card__params-body">
            {JSON.stringify(confirmation.params, null, 2)}
          </pre>
        </div>
      )}
      {isPending ? (
        <div className="amodal-review-card__actions">
          <button
            className="amodal-review-card__btn amodal-review-card__btn--approve"
            onClick={onApprove}
            data-testid="review-approve"
          >
            Approve
          </button>
          <button
            className="amodal-review-card__btn amodal-review-card__btn--deny"
            onClick={onDeny}
            data-testid="review-deny"
          >
            Deny
          </button>
        </div>
      ) : (
        <div className="amodal-review-card__status" data-testid="review-status">
          {confirmation.status === 'approved' ? 'Approved' : 'Denied'}
        </div>
      )}
    </div>
  );
}
