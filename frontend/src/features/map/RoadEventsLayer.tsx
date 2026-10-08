import { useCallback } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type {
  FilterSpecification,
  LineLayerSpecification,
  PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';

// Roadworks and closures on the map (SPEC-road-closures.md).

export type RoadEventKind =
  | 'closure'
  | 'entry_exit_closure'
  | 'roadworks'
  | 'short_term_roadworks'
  | 'construction';

/** One road_events_in_bbox row, minus the geometry (that's the feature's). */
export interface RoadEventProperties {
  id: string;
  kind: RoadEventKind;
  road: string | null;
  title: string;
  subtitle: string | null;
  description: string[];
  starts_at: string | null;
  ends_at: string | null;
}

export type RoadEventsGeoJSON = GeoJSON.FeatureCollection<GeoJSON.Geometry, RoadEventProperties>;

// Below this zoom the whole country's lines would be noise.
const MIN_ZOOM = 9;

type LinePaint = NonNullable<LineLayerSpecification['paint']>;

const COLOUR: LinePaint['line-color'] = [
  'match', ['get', 'kind'],
  'closure', '#dc2626',
  'entry_exit_closure', '#dc2626',
  'roadworks', '#f97316',
  'short_term_roadworks', '#f59e0b',
  'construction', '#64748b',
  '#64748b',
];

const WIDTH: LinePaint['line-width'] = [
  'match', ['get', 'kind'],
  'closure', 5,
  'entry_exit_closure', 4,
  'roadworks', 4,
  'short_term_roadworks', 3,
  3,
];

// MapLibre can't vary line-dasharray per feature, so one layer per dash style.
const LAYERS: { id: string; filter: FilterSpecification; dash?: number[] }[] = [
  { id: 'road-events-solid', filter: ['in', ['get', 'kind'], ['literal', ['closure', 'roadworks']]] },
  {
    id: 'road-events-dashed',
    filter: ['in', ['get', 'kind'], ['literal', ['entry_exit_closure', 'short_term_roadworks']]],
    dash: [2, 1.5],
  },
  { id: 'road-events-dotted', filter: ['==', ['get', 'kind'], 'construction'], dash: [0.5, 1.5] },
];

interface RoadEventsLayerProps {
  geojson: RoadEventsGeoJSON;
  onEventPress: (event: RoadEventProperties) => void;
}

export function RoadEventsLayer({ geojson, onEventPress }: RoadEventsLayerProps) {
  const handlePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = event.nativeEvent.features?.[0];
      if (feature?.properties) onEventPress(feature.properties as RoadEventProperties);
    },
    [onEventPress],
  );

  return (
    <GeoJSONSource id="road-events" data={geojson} onPress={handlePress}>
      {LAYERS.map((l) => (
        <Layer
          key={l.id}
          id={l.id}
          type="line"
          source="road-events"
          minzoom={MIN_ZOOM}
          filter={l.filter}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': COLOUR,
            'line-width': WIDTH,
            'line-opacity': 0.9,
            ...(l.dash ? { 'line-dasharray': l.dash } : {}),
          }}
        />
      ))}
    </GeoJSONSource>
  );
}
