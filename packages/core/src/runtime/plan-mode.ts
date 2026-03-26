/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Manages plan mode state for a session.
 *
 * When active, write operations are blocked via the request tool's
 * planModeActive callback. Once the user approves a plan, it's stored
 * and injected into the context for execution.
 */
export class PlanModeManager {
  private active = false;
  private approvedPlan: string | null = null;
  private reason: string | null = null;

  /** Whether plan mode is currently active (writes blocked). */
  isActive(): boolean {
    return this.active;
  }

  /** The approved plan text, if any. */
  getApprovedPlan(): string | null {
    return this.approvedPlan;
  }

  /** The reason plan mode was entered, if any. */
  getReason(): string | null {
    return this.reason;
  }

  /** Enter plan mode. Writes are blocked until a plan is approved. */
  enter(reason?: string): void {
    this.active = true;
    this.reason = reason ?? null;
    this.approvedPlan = null;
  }

  /** Approve a plan. Stores the plan text and exits plan mode (writes re-enabled). */
  approve(planText: string): void {
    this.active = false;
    this.approvedPlan = planText;
  }

  /** Exit plan mode without approving a plan. */
  exit(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
  }

  /**
   * Get the planning reminder text for injection into the system prompt.
   * Returns null if plan mode is not active.
   */
  getPlanningReminder(): string | null {
    if (!this.active) {
      return null;
    }

    const lines = [
      '## Planning Mode Active',
      'You are currently in planning mode. Present your plan to the user for approval before executing write operations.',
      'Read operations and the explore tool are allowed freely.',
    ];

    if (this.reason) {
      lines.push(`Reason: ${this.reason}`);
    }

    return lines.join('\n');
  }

  /**
   * Get the approved plan context for injection into the system prompt.
   * Returns null if no plan has been approved.
   */
  getApprovedPlanContext(): string | null {
    if (this.approvedPlan === null) {
      return null;
    }

    return [
      '## Approved Plan',
      'The following plan has been approved by the user. Execute it step by step.',
      '',
      this.approvedPlan,
    ].join('\n');
  }
}
