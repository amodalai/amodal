/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {PlanModeManager} from './plan-mode.js';

describe('PlanModeManager', () => {
  let manager: PlanModeManager;

  beforeEach(() => {
    manager = new PlanModeManager();
  });

  it('starts inactive', () => {
    expect(manager.isActive()).toBe(false);
  });

  it('enter() activates plan mode', () => {
    manager.enter();
    expect(manager.isActive()).toBe(true);
  });

  it('exit() deactivates plan mode', () => {
    manager.enter();
    manager.exit();
    expect(manager.isActive()).toBe(false);
  });

  it('approve() deactivates plan mode and stores plan', () => {
    manager.enter();
    manager.approve('Step 1: do X\nStep 2: do Y');
    expect(manager.isActive()).toBe(false);
    expect(manager.getApprovedPlan()).toBe('Step 1: do X\nStep 2: do Y');
  });

  it('getApprovedPlan() returns null initially', () => {
    expect(manager.getApprovedPlan()).toBeNull();
  });

  it('getApprovedPlan() returns plan text after approve', () => {
    manager.enter();
    manager.approve('my plan');
    expect(manager.getApprovedPlan()).toBe('my plan');
  });

  it('approve() clears active state (writes re-enabled)', () => {
    manager.enter();
    expect(manager.isActive()).toBe(true);
    manager.approve('plan');
    expect(manager.isActive()).toBe(false);
  });

  it('exit() does not clear approved plan', () => {
    manager.enter();
    manager.approve('preserved plan');
    manager.enter();
    manager.exit();
    expect(manager.getApprovedPlan()).toBeNull();
  });

  it('double enter is idempotent (stays active)', () => {
    manager.enter();
    manager.enter();
    expect(manager.isActive()).toBe(true);
  });

  it('second enter updates reason', () => {
    manager.enter('first reason');
    manager.enter('second reason');
    expect(manager.getReason()).toBe('second reason');
  });

  it('exit when not active is a no-op', () => {
    manager.exit();
    expect(manager.isActive()).toBe(false);
  });

  it('getPlanningReminder() returns text when active', () => {
    manager.enter();
    const reminder = manager.getPlanningReminder();
    expect(reminder).not.toBeNull();
    expect(reminder).toContain('## Planning Mode Active');
    expect(reminder).toContain('Present your plan to the user');
    expect(reminder).toContain('Read operations and the explore tool are allowed freely');
  });

  it('getPlanningReminder() includes reason when provided', () => {
    manager.enter('complex multi-system change');
    const reminder = manager.getPlanningReminder();
    expect(reminder).toContain('Reason: complex multi-system change');
  });

  it('getPlanningReminder() returns null when not active', () => {
    expect(manager.getPlanningReminder()).toBeNull();
  });

  it('getApprovedPlanContext() returns text after approve', () => {
    manager.enter();
    manager.approve('1. Create resource\n2. Update config');
    const context = manager.getApprovedPlanContext();
    expect(context).not.toBeNull();
    expect(context).toContain('## Approved Plan');
    expect(context).toContain('Execute it step by step');
    expect(context).toContain('1. Create resource\n2. Update config');
  });

  it('getApprovedPlanContext() returns null when no plan', () => {
    expect(manager.getApprovedPlanContext()).toBeNull();
  });

  it('getReason() returns null initially', () => {
    expect(manager.getReason()).toBeNull();
  });

  it('getReason() returns reason after enter', () => {
    manager.enter('needs review');
    expect(manager.getReason()).toBe('needs review');
  });

  it('enter() clears previously approved plan', () => {
    manager.enter();
    manager.approve('old plan');
    expect(manager.getApprovedPlan()).toBe('old plan');
    manager.enter();
    expect(manager.getApprovedPlan()).toBeNull();
  });
});
