import { useEffect, useState } from 'react';
import type { SpotRow } from '../../lib/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export interface RouteData {
  geometry: GeoJSON.LineString;
  distance_m: number;
  duration_s: number;
}

export interface RouteState {
  data: RouteData | null;
  loading: boolean;
  error: string | null;
}

const IDLE: RouteState = { data: null, loading: false, error: null };

export function useRoute(
  userLocation: { lon: number; lat: number } | null,
  spot: SpotRow | null,
): RouteState {
  const [state, setState] = useState<RouteState>(IDLE);

  const fromLon = userLocation?.lon ?? null;
  const fromLat = userLocation?.lat ?? null;
  const toLon = spot?.lon ?? null;
  const toLat = spot?.lat ?? null;

  useEffect(() => {
    if (fromLon == null || fromLat == null || toLon == null || toLat == null) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    setState({ data: null, loading: true, error: null });

    const url = new URL(`${API_URL}/route`);
    url.searchParams.set('from_lon', String(fromLon));
    url.searchParams.set('from_lat', String(fromLat));
    url.searchParams.set('to_lon', String(toLon));
    url.searchParams.set('to_lat', String(toLat));

    fetch(url.toString())
      .then((res) => {
        if (!res.ok) throw new Error(`Route API error: ${res.status}`);
        return res.json() as Promise<{
          geometry: GeoJSON.LineString;
          distance_m: number;
          duration_s: number;
        }>;
      })
      .then((json) => {
        if (!cancelled) {
          setState({
            data: {
              geometry: json.geometry,
              distance_m: json.distance_m,
              duration_s: json.duration_s,
            },
            loading: false,
            error: null,
          });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ data: null, loading: false, error: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fromLon, fromLat, toLon, toLat]);

  return state;
}
