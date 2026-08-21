import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import type { SpotRow } from './types';

export interface Bbox {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export type SpotsGeoJSON = GeoJSON.FeatureCollection<GeoJSON.Point, SpotRow>;

export function boundsToParams(bounds: LngLatBounds): Bbox {
  const [west, south, east, north] = bounds;
  return { min_lon: west, min_lat: south, max_lon: east, max_lat: north };
}

export function spotsToGeoJSON(spots: SpotRow[]): SpotsGeoJSON {
  return {
    type: 'FeatureCollection',
    features: spots.map((spot) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [spot.lon, spot.lat] },
      properties: spot,
    })),
  };
}
