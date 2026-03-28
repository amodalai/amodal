/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { KBProposalInfo } from '../types';

interface KBProposalCardProps {
  proposal: KBProposalInfo;
}

export function KBProposalCard({ proposal }: KBProposalCardProps) {
  return (
    <div className="pcw-kb-proposal">
      <div className="pcw-kb-proposal__header">
        <span className="pcw-kb-proposal__icon">{'\uD83D\uDCA1'}</span>
        <span className="pcw-kb-proposal__title">{proposal.title}</span>
        <span className="pcw-kb-proposal__scope">{proposal.scope}</span>
      </div>
      <p className="pcw-kb-proposal__reasoning">{proposal.reasoning}</p>
    </div>
  );
}
