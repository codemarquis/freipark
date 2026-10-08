import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import type { ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { supabase } from '../../lib/supabase';
import { boundsToParams, spotsToGeoJSON } from '../../lib/geo';
import type { Bbox, SpotsGeoJSON } from '../../lib/geo';
import type { SpotRow } from '../../lib/types';
import { posthogLogger } from '../../lib/posthogLogger';

const EMPTY: SpotsGeoJSON = { type: 'FeatureCollection', features: [] };

// Initial fetch covers central Berlin so spots appear before the user pans.
export const BERLIN_INITIAL: Bbox = {
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
  // The most recently requested bbox, so refetch() can reload what's on
  // screen (e.g. right after the user submits a spot report).
  const lastBbox = useRef<Bbox>(BERLIN_INITIAL);

  const fetchBbox = useCallback(async (bbox: Bbox) => {
    const id = ++requestId.current;
    lastBbox.current = bbox;
    posthogLogger.info('parking_spots_fetch_started');
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
      posthogLogger.error('parking_spots_fetch_failed', {
        operation: 'spots_in_bbox',
      });
      console.error('[useSpots] RPC error', error);
      return;
    }
    const spotCount = (data as SpotRow[])?.length ?? 0;
    posthogLogger.info('parking_spots_fetch_completed', {
      parking_spot_count: spotCount,
    });
    console.log('[useSpots] got', spotCount, 'spots');
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

  // Goes through fetchBbox, so the stale-response guard above applies: a
  // refetch supersedes any older request still in flight.
  const refetch = useCallback(() => fetchBbox(lastBbox.current), [fetchBbox]);

  return { geojson, onRegionDidChange, refetch };
}
