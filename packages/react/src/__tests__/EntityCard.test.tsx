/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntityCard } from '../widget/widgets/EntityCard';

const defaultData = {
  mac: 'AA:BB:CC:DD:EE:01',
  manufacturer: 'Espressif',
  protocols: ['wifi_2.4', 'zigbee'],
  zone: 'C',
  zone_name: 'Server Room',
  suspicion_score: 87,
  score_factors: {
    unknown_manufacturer: 20,
    no_entry_trajectory: 25,
    restricted_zone: 20,
    protocol_mismatch: 12,
    unusual_dwell: 10,
  },
  tag_status: 'untagged',
  dwell_time_minutes: 30,
  signal_strength_dbm: -42,
};

describe('EntityCard', () => {
  it('renders MAC address and manufacturer', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeDefined();
    expect(screen.getByText('Espressif')).toBeDefined();
  });

  it('renders protocol badges', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    expect(screen.getByText('wifi_2.4')).toBeDefined();
    expect(screen.getByText('zigbee')).toBeDefined();
  });

  it('renders zone with name', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    expect(screen.getByText('Zone C (Server Room)')).toBeDefined();
  });

  it('renders score bar with value', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    expect(screen.getByText('Score: 87')).toBeDefined();
  });

  it('renders score factors', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    expect(screen.getByText('unknown manufacturer')).toBeDefined();
    expect(screen.getByText('no entry trajectory')).toBeDefined();
    expect(screen.getByText('+25')).toBeDefined();
    // Multiple factors have +20 (unknown_manufacturer and restricted_zone)
    expect(screen.getAllByText('+20')).toHaveLength(2);
  });

  it('sends investigate message on button click', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    fireEvent.click(screen.getByText('Investigate'));
    expect(sendMessage).toHaveBeenCalledWith('Investigate device AA:BB:CC:DD:EE:01 in Zone C');
  });

  it('sends tag message on button click', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    fireEvent.click(screen.getByText('Tag'));
    expect(sendMessage).toHaveBeenCalledWith('Tag device AA:BB:CC:DD:EE:01 as suspicious');
  });

  it('renders dwell time', () => {
    const sendMessage = vi.fn();
    render(<EntityCard data={defaultData} sendMessage={sendMessage} />);

    expect(screen.getByText('Dwell: 30min')).toBeDefined();
  });

  it('renders without optional fields', () => {
    const sendMessage = vi.fn();
    const minimalData = {
      mac: 'FF:FF:FF:FF:FF:FF',
      manufacturer: 'Unknown',
      protocols: ['ble'],
      zone: 'A',
      suspicion_score: 15,
      tag_status: 'benign',
    };
    render(<EntityCard data={minimalData} sendMessage={sendMessage} />);

    expect(screen.getByText('FF:FF:FF:FF:FF:FF')).toBeDefined();
    expect(screen.getByText('Tag: benign')).toBeDefined();
  });

  it('clamps score bar width to 0-100%', () => {
    const sendMessage = vi.fn();
    const overData = { ...defaultData, suspicion_score: 150 };
    const { container } = render(<EntityCard data={overData} sendMessage={sendMessage} />);

    const fill = container.querySelector('.pcw-score-bar__fill');
    expect(fill).toBeDefined();
    expect(fill?.getAttribute('style')).toContain('width: 100%');
  });
});
