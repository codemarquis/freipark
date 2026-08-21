import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import type { ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { supabase } from '../../lib/supabase';
import { boundsToParams, spotsToGeoJSON } from '../../lib/geo';
import type { Bbox, SpotsGeoJSON } from '../../lib/geo';
import type { SpotRow } from '../../lib/types';

const EMPTY: SpotsGeoJSON = { type: 'FeatureCollection', features: [] };

// Initial fetch covers central Berlin so spots appear before the user pans.
const BERLIN_INITIAL: Bbox = {
  min_lon: 13.28,
  min_lat: 52.47,
  max_lon: 13.53,
  max_lat: 52.57,
};

export function useSpots() {
  const [geojson, setGeojson] = useState<SpotsGeoJSON>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBbox = useCallback(async (bbox: Bbox) => {
    console.log('[useSpots] fetching bbox', bbox);
    const { data, error } = await supabase.rpc('spots_in_bbox', {
      ...bbox,
      lim: 2000,
    });
    if (error) {
      console.error('[useSpots] RPC error', error);
      return;
    }
    console.log('[useSpots] got', (data as SpotRow[])?.length ?? 0, 'spots');
    setGeojson(spotsToGeoJSON(data as SpotRow[]));
  }, []);

  // Fetch immediately on mount so spots are visible without requiring a pan.
  useEffect(() => {
    fetchBbox(BERLIN_INITIAL);
  }, [fetchBbox]);

  const onRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { bounds } = event.nativeEvent;
      if (!bounds) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fetchBbox(boundsToParams(bounds)), 300);
    },
    [fetchBbox],
  );

  return { geojson, onRegionDidChange };
}
