import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { RoadEventsLayer } from '../src/features/map/RoadEventsLayer';
import type { RoadEventsGeoJSON } from '../src/features/map/RoadEventsLayer';
import de from '../src/i18n/locales/de.json';
import en from '../src/i18n/locales/en.json';
import tr from '../src/i18n/locales/tr.json';

interface LayerProps {
  id: string;
  type: string;
  filter?: unknown;
  minzoom?: number;
  paint?: Record<string, unknown>;
}

// Record props instead of rendering native map views.
const mockLayers: LayerProps[] = [];
const mockSources: { id: string; onPress?: (e: unknown) => void }[] = [];

jest.mock('@maplibre/maplibre-react-native', () => ({
  GeoJSONSource: (props: { id: string; children: ReactNode; onPress?: (e: unknown) => void }) => {
    mockSources.push(props);
    return props.children;
  },
  Layer: (props: LayerProps) => {
    mockLayers.push(props);
    return null;
  },
}));

const EMPTY: RoadEventsGeoJSON = { type: 'FeatureCollection', features: [] };
const onEventPress = jest.fn();

beforeEach(async () => {
  mockLayers.length = 0;
  mockSources.length = 0;
  onEventPress.mockClear();
  await render(<RoadEventsLayer geojson={EMPTY} onEventPress={onEventPress} />);
});

const layer = (id: string) => {
  const found = mockLayers.find((l) => l.id === id);
  if (!found) throw new Error(`layer ${id} not rendered`);
  return found;
};

describe('RoadEventsLayer', () => {
  it('draws three line layers, one per dash style, all hidden below zoom 9', () => {
    expect(mockLayers.map((l) => l.id)).toEqual(['road-events-solid', 'road-events-dashed', 'road-events-dotted']);
    for (const l of mockLayers) {
      expect(l.type).toBe('line');
      expect(l.minzoom).toBe(9);
    }
  });

  it('puts each kind in the right dash style', () => {
    expect(layer('road-events-solid').filter).toEqual(['in', ['get', 'kind'], ['literal', ['closure', 'roadworks']]]);
    expect(layer('road-events-dashed').filter).toEqual([
      'in', ['get', 'kind'], ['literal', ['entry_exit_closure', 'short_term_roadworks']],
    ]);
    expect(layer('road-events-dotted').filter).toEqual(['==', ['get', 'kind'], 'construction']);
    expect(layer('road-events-solid').paint?.['line-dasharray']).toBeUndefined();
    expect(layer('road-events-dashed').paint?.['line-dasharray']).toEqual([2, 1.5]);
    expect(layer('road-events-dotted').paint?.['line-dasharray']).toEqual([0.5, 1.5]);
  });

  it('colours and sizes lines by kind', () => {
    const colour = ['match', ['get', 'kind'],
      'closure', '#dc2626', 'entry_exit_closure', '#dc2626',
      'roadworks', '#f97316', 'short_term_roadworks', '#f59e0b',
      'construction', '#64748b', '#64748b'];
    const width = ['match', ['get', 'kind'],
      'closure', 5, 'entry_exit_closure', 4, 'roadworks', 4, 'short_term_roadworks', 3, 3];
    for (const l of mockLayers) {
      expect(l.paint?.['line-color']).toEqual(colour);
      expect(l.paint?.['line-width']).toEqual(width);
    }
  });

  it('passes the tapped event up', () => {
    const properties = { id: 'e1', kind: 'closure', title: 'A100 | Test' };
    mockSources[0].onPress?.({ nativeEvent: { features: [{ properties }] } });
    expect(onEventPress).toHaveBeenCalledWith(properties);
  });

  it('ignores a tap that hits nothing', () => {
    mockSources[0].onPress?.({ nativeEvent: { features: [] } });
    expect(onEventPress).not.toHaveBeenCalled();
  });
});

describe('road event translations', () => {
  const KEYS = ['closure', 'entry_exit_closure', 'roadworks', 'short_term_roadworks', 'construction',
    'until', 'source', 'sourceAutobahn', 'sourceOsm'];
  it.each([['de', de], ['en', en], ['tr', tr]] as [string, { roadEvents?: Record<string, string> }][])(
    '%s has every roadEvents key, none empty',
    (_lang, locale) => {
      const keys = locale.roadEvents ?? {};
      expect(Object.keys(keys).sort()).toEqual([...KEYS].sort());
      for (const value of Object.values(keys)) expect(value.trim()).not.toBe('');
      expect(keys.until).toContain('{{date}}');
      expect(keys.source).toContain('{{name}}');
    },
  );
});
