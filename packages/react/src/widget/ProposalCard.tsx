/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ProposalBlock} from '../types';

interface ProposalCardProps {
  block: ProposalBlock;
  /**
   * Called once when the user clicks Looks right or Adjust. The chat
   * reducer marks the block as submitted on the same dispatch and
   * locks the buttons; subsequent `update_plan` events from the
   * agent re-open them.
   */
  onSubmit: (proposalId: string, answer: 'confirm' | 'adjust', message: string) => void;
}

/**
 * Plan proposal card emitted by the admin agent's `propose_plan` tool
 * (Phase D — Path B custom-description flow). Renders the inferred
 * Plan in plain English and lets the user confirm or open the Adjust
 * conversation.
 *
 * Skill / connection rows show only the author-facing label +
 * description — the proposal tool never quotes raw npm package names,
 * so the user sees "CRM" / "Web analytics", not "@amodalai/connection-ga4".
 *
 * Subsequent `update_plan` events mutate this same card in place
 * (matched on `proposalId` by the reducer), so the chat doesn't
 * accumulate duplicate proposals as the user iterates.
 */
export function ProposalCard({block, onSubmit}: ProposalCardProps) {
  const submitted = block.status === 'submitted';

  if (submitted) {
    const verb = block.answer === 'adjust' ? 'Adjusting' : 'Looks right';
    return (
      <div className="pcw-proposal pcw-proposal--submitted">
        <div className="pcw-proposal__summary">{block.summary}</div>
        <ProposalSections block={block} />
        <div className="pcw-proposal__answer">{verb}</div>
      </div>
    );
  }

  return (
    <div className="pcw-proposal">
      <div className="pcw-proposal__summary">{block.summary}</div>
      <ProposalSections block={block} />
      <div className="pcw-proposal__actions">
        <button
          type="button"
          className="pcw-proposal__btn pcw-proposal__btn--primary"
          onClick={() => onSubmit(block.proposalId, 'confirm', 'Looks right')}
        >
          Looks right →
        </button>
        <button
          type="button"
          className="pcw-proposal__btn pcw-proposal__btn--secondary"
          onClick={() => onSubmit(block.proposalId, 'adjust', 'Adjust')}
        >
          Adjust
        </button>
      </div>
    </div>
  );
}

function ProposalSections({block}: {block: ProposalBlock}) {
  return (
    <>
      {block.skills.length > 0 && (
        <Section title="What it does">
          {block.skills.map((s, i) => (
            <Row key={`skill-${String(i)}`} label={s.label} description={s.description} />
          ))}
        </Section>
      )}
      {block.requiredConnections.length > 0 && (
        <Section title="Connections">
          {block.requiredConnections.map((c, i) => (
            <Row
              key={`req-${String(i)}`}
              label={c.label}
              description={c.description}
            />
          ))}
        </Section>
      )}
      {block.optionalConnections.length > 0 && (
        <Section title="Optional">
          {block.optionalConnections.map((c, i) => (
            <Row key={`opt-${String(i)}`} label={c.label} description={c.description} />
          ))}
        </Section>
      )}
    </>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <div className="pcw-proposal__section">
      <div className="pcw-proposal__section-title">{title}</div>
      <div className="pcw-proposal__rows">{children}</div>
    </div>
  );
}

function Row({label, description}: {label: string; description: string}) {
  return (
    <div className="pcw-proposal__row">
      <span className="pcw-proposal__row-label">{label}</span>
      <span className="pcw-proposal__row-desc">{description}</span>
    </div>
  );
}
