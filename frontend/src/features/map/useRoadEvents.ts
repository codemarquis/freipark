import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import type { ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { supabase } from '../../lib/supabase';
import { boundsToParams } from '../../lib/geo';
import type { Bbox } from '../../lib/geo';
import { BERLIN_INITIAL } from './useSpots';
import type { RoadEventKind, RoadEventProperties, RoadEventsGeoJSON } from './RoadEventsLayer';

// The layer is hidden below this zoom, so don't fetch there either.
const MIN_ZOOM = 9;
const DEBOUNCE_MS = 500;
const KINDS: readonly RoadEventKind[] = [
  'closure', 'entry_exit_closure', 'roadworks', 'short_term_roadworks', 'construction',
];
const EMPTY: RoadEventsGeoJSON = { type: 'FeatureCollection', features: [] };

const textOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** One road_events_in_bbox row → a GeoJSON feature, or null if unusable. */
function toFeature(row: unknown): RoadEventsGeoJSON['features'][number] | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.geometry !== 'string') return null;
  if (!KINDS.includes(r.kind as RoadEventKind)) return null;
  if (!textOrNull(r.road) || !textOrNull(r.subtitle) || !textOrNull(r.starts_at) || !textOrNull(r.ends_at)) return null;
  let geometry: GeoJSON.Geometry;
  try {
    geometry = JSON.parse(r.geometry) as GeoJSON.Geometry;
  } catch {
    return null;
  }
  const description = Array.isArray(r.description)
    ? r.description.filter((line): line is string => typeof line === 'string')
    : [];
  return {
    type: 'Feature',
    geometry,
    properties: {
      id: r.id, kind: r.kind as RoadEventKind, road: r.road, title: r.title, subtitle: r.subtitle,
      description, starts_at: r.starts_at, ends_at: r.ends_at,
    },
  };
}

/** Roadworks and closures for the visible area (SPEC-road-closures.md). */
export function useRoadEvents() {
  const [geojson, setGeojson] = useState<RoadEventsGeoJSON>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same stale-response guard as useSpots: only the newest request may land.
  const requestId = useRef(0);

  const fetchBbox = useCallback(async (bbox: Bbox) => {
    const id = ++requestId.current;
    const { data, error } = await supabase.rpc('road_events_in_bbox', { ...bbox, lim: 2000 });
    if (id !== requestId.current) return;
    if (error || !Array.isArray(data)) {
      setGeojson(EMPTY);
      return;
    }
    const features = data.map(toFeature).filter((f): f is NonNullable<typeof f> => f !== null);
    setGeojson({ type: 'FeatureCollection', features });
  }, []);

  useEffect(() => {
    fetchBbox(BERLIN_INITIAL);
  }, [fetchBbox]);

  const onRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { bounds, zoom } = event.nativeEvent;
      if (timer.current) clearTimeout(timer.current);
      if (zoom < MIN_ZOOM) {
        requestId.current++; // any request still in flight is now stale
        setGeojson(EMPTY);
        return;
      }
      if (!bounds) return;
      timer.current = setTimeout(() => fetchBbox(boundsToParams(bounds)), DEBOUNCE_MS);
    },
    [fetchBbox],
  );

  // Taps return the map's copy of a feature, where list properties such as
  // `description` can come back flattened; look the full event up by id.
  const byId = useMemo(() => new Map(geojson.features.map((f) => [f.properties.id, f.properties])), [geojson]);
  const eventById = useCallback((id: string): RoadEventProperties | null => byId.get(id) ?? null, [byId]);

  return { geojson, onRegionDidChange, eventById };
}
