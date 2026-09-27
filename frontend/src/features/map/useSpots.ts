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
  // Guards against out-of-order responses: a fast pinch-zoom can fire
  // several fetches in quick succession, and network timing doesn't
  // guarantee the request for the newest bbox resolves last — without
  // this, a slower, now-stale response can overwrite fresher data with
  // the wrong (often much larger, since it's usually the earlier, more
  // zoomed-out bbox) result set.
  const requestId = useRef(0);

  const fetchBbox = useCallback(async (bbox: Bbox) => {
    const id = ++requestId.current;
    console.log('[useSpots] fetching bbox', bbox);
    const { data, error } = await supabase.rpc('spots_in_bbox', {
      ...bbox,
      lim: 2000,
    });
    if (id !== requestId.current) {
      // A newer request has already started (or finished) — this
      // response is stale, discard it rather than render it.
      return;
    }
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
      // 500ms (was 300ms): a fast continuous pinch-zoom can still outrun a
      // shorter debounce, firing several fetches back to back — each one
      // triggers a full native re-cluster of up to 2000 points, which on
      // a simulator especially can compound into a visible stall.
      timer.current = setTimeout(() => fetchBbox(boundsToParams(bounds)), 500);
    },
    [fetchBbox],
  );

  return { geojson, onRegionDidChange };
}
