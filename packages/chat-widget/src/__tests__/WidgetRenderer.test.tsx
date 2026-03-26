/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetRenderer } from '../components/widgets/WidgetRenderer';

const sendMessage = vi.fn();

describe('WidgetRenderer', () => {
  it('renders a platform entity-card widget', () => {
    render(
      <WidgetRenderer
        widgetType="entity-card"
        data={{
          mac: 'AA:BB:CC:DD:EE:01',
          manufacturer: 'Espressif',
          protocols: ['wifi_2.4', 'zigbee'],
          zone: 'C',
          suspicion_score: 87,
          tag_status: 'untagged',
        }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeDefined();
    expect(screen.getByText('Espressif')).toBeDefined();
  });

  it('renders a platform alert-card widget', () => {
    render(
      <WidgetRenderer
        widgetType="alert-card"
        data={{
          id: 'anom-1',
          type: 'rogue_ap',
          zone: 'B',
          severity: 'critical',
          description: 'Evil twin AP detected',
          involved_devices: ['DE:AD:BE:EF:00:01'],
          protocols_involved: ['wifi_2.4'],
          detected_at: '2025-01-01T00:00:00Z',
        }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('CRITICAL')).toBeDefined();
    expect(screen.getByText('Evil twin AP detected')).toBeDefined();
  });

  it('renders a platform data-table widget', () => {
    render(
      <WidgetRenderer
        widgetType="data-table"
        data={{
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'value', label: 'Value' },
          ],
          rows: [{ name: 'Zone A', value: '42' }],
        }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Zone A')).toBeDefined();
  });

  it('renders a platform scope-map widget', () => {
    render(
      <WidgetRenderer
        widgetType="scope-map"
        data={{
          highlight_zones: ['C'],
          label: 'Rogue sensor location',
        }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('Rogue sensor location')).toBeDefined();
  });

  it('renders a platform timeline widget', () => {
    render(
      <WidgetRenderer
        widgetType="timeline"
        data={{
          events: [
            { timestamp: '2025-01-01T00:00:00Z', label: 'Device appeared' },
            { timestamp: '2025-01-01T00:30:00Z', label: 'Zone change' },
          ],
        }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('Device appeared')).toBeDefined();
    expect(screen.getByText('Zone change')).toBeDefined();
  });

  it('prefers custom widget over platform widget', () => {
    const CustomWidget = ({ data }: { data: Record<string, unknown> }) => (
      <div>Custom: {String(data['mac'])}</div>
    );

    render(
      <WidgetRenderer
        widgetType="entity-card"
        data={{ mac: 'FF:FF:FF:FF:FF:FF' }}
        sendMessage={sendMessage}
        customWidgets={{ 'entity-card': CustomWidget }}
      />,
    );
    expect(screen.getByText('Custom: FF:FF:FF:FF:FF:FF')).toBeDefined();
  });

  it('renders custom widget for unknown type', () => {
    const SignalHeatmap = ({ data }: { data: Record<string, unknown> }) => (
      <div>Heatmap: {String(data['zone'])}</div>
    );

    render(
      <WidgetRenderer
        widgetType="signal-heatmap"
        data={{ zone: 'A' }}
        sendMessage={sendMessage}
        customWidgets={{ 'signal-heatmap': SignalHeatmap }}
      />,
    );
    expect(screen.getByText('Heatmap: A')).toBeDefined();
  });

  it('falls back to JSON display for unknown widget type', () => {
    render(
      <WidgetRenderer
        widgetType="unknown-widget"
        data={{ foo: 'bar' }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('unknown-widget')).toBeDefined();
    expect(screen.getByText(/"foo": "bar"/)).toBeDefined();
  });

  it('passes sendMessage to platform widgets', () => {
    render(
      <WidgetRenderer
        widgetType="entity-card"
        data={{
          mac: 'AA:BB:CC:DD:EE:01',
          manufacturer: 'Espressif',
          protocols: ['wifi_2.4'],
          zone: 'C',
          suspicion_score: 50,
          tag_status: 'untagged',
        }}
        sendMessage={sendMessage}
      />,
    );
    const investigateBtn = screen.getByText('Investigate');
    fireEvent.click(investigateBtn);
    expect(sendMessage).toHaveBeenCalledWith('Investigate device AA:BB:CC:DD:EE:01 in Zone C');
  });

  it('renders comparison widget with multiple devices', () => {
    render(
      <WidgetRenderer
        widgetType="comparison"
        data={{
          items: [
            { mac: 'AA:00', manufacturer: 'Apple', protocols: ['wifi_5'], zone: 'A', suspicion_score: 10, tag_status: 'benign' },
            { mac: 'BB:00', manufacturer: 'Samsung', protocols: ['ble'], zone: 'A', suspicion_score: 20, tag_status: 'untagged' },
          ],
          title: 'Co-traveling devices',
        }}
        sendMessage={sendMessage}
      />,
    );
    expect(screen.getByText('Co-traveling devices')).toBeDefined();
  });
});
