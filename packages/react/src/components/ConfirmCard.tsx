/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ConfirmationInfo } from '../types';

export interface ConfirmCardProps {
  confirmation: ConfirmationInfo;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Simple confirmation card: shows endpoint + method + reason, approve/deny buttons.
 */
export function ConfirmCard({ confirmation, onApprove, onDeny }: ConfirmCardProps) {
  const isPending = confirmation.status === 'pending';

  return (
    <div className="amodal-confirm-card" data-testid="confirm-card">
      <div className="amodal-confirm-card__header">
        <span className="amodal-confirm-card__method">{confirmation.method}</span>
        <span className="amodal-confirm-card__endpoint">{confirmation.endpoint}</span>
      </div>
      <p className="amodal-confirm-card__reason">{confirmation.reason}</p>
      {isPending ? (
        <div className="amodal-confirm-card__actions">
          <button
            className="amodal-confirm-card__btn amodal-confirm-card__btn--approve"
            onClick={onApprove}
            data-testid="confirm-approve"
          >
            Approve
          </button>
          <button
            className="amodal-confirm-card__btn amodal-confirm-card__btn--deny"
            onClick={onDeny}
            data-testid="confirm-deny"
          >
            Deny
          </button>
        </div>
      ) : (
        <div className="amodal-confirm-card__status" data-testid="confirm-status">
          {confirmation.status === 'approved' ? 'Approved' : 'Denied'}
        </div>
      )}
    </div>
  );
}
