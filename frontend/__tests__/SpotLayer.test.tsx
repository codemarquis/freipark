import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { SpotLayer } from '../src/features/map/SpotLayer';

interface LayerProps {
  id: string;
  paint?: Record<string, unknown>;
}

// Record every Layer's props instead of rendering native map views.
const mockLayers: LayerProps[] = [];

jest.mock('@maplibre/maplibre-react-native', () => ({
  GeoJSONSource: ({ children }: { children: ReactNode }) => children,
  Layer: (props: LayerProps) => {
    mockLayers.push(props);
    return null;
  },
}));

function unclusteredPaint(): Record<string, unknown> {
  const layer = mockLayers.find((l) => l.id === 'spots-unclustered');
  if (!layer?.paint) throw new Error('spots-unclustered layer not rendered');
  return layer.paint;
}

beforeEach(async () => {
  mockLayers.length = 0;
  await render(
    <SpotLayer
      geojson={{ type: 'FeatureCollection', features: [] }}
      onSpotPress={jest.fn()}
      cameraRef={{ current: null }}
    />,
  );
});

describe('SpotLayer — unclustered spots', () => {
  it('keeps the fill colour for access type', () => {
    expect(unclusteredPaint()['circle-color']).toEqual([
      'match',
      ['get', 'access'],
      'free', '#22c55e',
      'paid', '#3b82f6',
      'permit', '#f59e0b',
      'private', '#ef4444',
      '#94a3b8',
    ]);
  });

  // Reports are shown on the ring only, so they never collide with the fill.
  it('colours the ring by report status, white when there is none', () => {
    expect(unclusteredPaint()['circle-stroke-color']).toEqual([
      'match',
      ['get', 'report_status'],
      'free', '#14b8a6',
      'full', '#111827',
      '#ffffff',
    ]);
  });

  it('thickens the ring only for spots with a report', () => {
    expect(unclusteredPaint()['circle-stroke-width']).toEqual([
      'match',
      ['get', 'report_status'],
      ['free', 'full'], 3,
      1,
    ]);
  });
});
