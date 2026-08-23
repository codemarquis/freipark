import { boundsToParams, spotsToGeoJSON } from '../src/lib/geo';
import type { SpotRow } from '../src/lib/types';

const SPOT: SpotRow = {
  id: 'abc',
  spot_type: 'street',
  access: 'free',
  operator: null,
  capacity: null,
  lon: 13.405,
  lat: 52.52,
};

// ─── boundsToParams ───────────────────────────────────────────────────────────

describe('boundsToParams', () => {
  it('maps [west, south, east, north] tuple to a Bbox object', () => {
    expect(boundsToParams([13.3, 52.4, 13.6, 52.6] as any)).toEqual({
      min_lon: 13.3,
      min_lat: 52.4,
      max_lon: 13.6,
      max_lat: 52.6,
    });
  });

  it('handles negative longitudes', () => {
    const result = boundsToParams([-10.5, 47.0, 15.0, 55.0] as any);
    expect(result.min_lon).toBe(-10.5);
    expect(result.max_lon).toBe(15.0);
  });

  it('maps the Germany tile bounds without loss', () => {
    const result = boundsToParams([4.5, 46.5, 15.1, 55.1] as any);
    expect(result).toEqual({ min_lon: 4.5, min_lat: 46.5, max_lon: 15.1, max_lat: 55.1 });
  });

  it('preserves floating-point values', () => {
    const result = boundsToParams([13.387748, 52.497171, 13.422251, 52.542817] as any);
    expect(result.min_lon).toBeCloseTo(13.387748, 6);
    expect(result.max_lat).toBeCloseTo(52.542817, 6);
  });
});

// ─── spotsToGeoJSON ───────────────────────────────────────────────────────────

describe('spotsToGeoJSON', () => {
  it('returns a FeatureCollection for an empty array', () => {
    expect(spotsToGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('produces one Feature per spot', () => {
    const result = spotsToGeoJSON([SPOT, { ...SPOT, id: 'def' }]);
    expect(result.features).toHaveLength(2);
  });

  it('wraps each spot as a GeoJSON Point Feature', () => {
    const result = spotsToGeoJSON([SPOT]);
    expect(result.features[0]).toMatchObject({
      type: 'Feature',
      geometry: { type: 'Point' },
    });
  });

  it('uses [lon, lat] coordinate order (GeoJSON standard)', () => {
    const result = spotsToGeoJSON([SPOT]);
    expect(result.features[0].geometry.coordinates).toEqual([13.405, 52.52]);
  });

  it('stores the full SpotRow in properties', () => {
    const result = spotsToGeoJSON([SPOT]);
    expect(result.features[0].properties).toEqual(SPOT);
  });

  it('preserves property values for all access types', () => {
    const spots: SpotRow[] = [
      { ...SPOT, id: '1', access: 'paid' },
      { ...SPOT, id: '2', access: 'permit' },
      { ...SPOT, id: '3', access: null },
    ];
    const result = spotsToGeoJSON(spots);
    expect(result.features.map((f) => f.properties.access)).toEqual(['paid', 'permit', null]);
  });

  it('maps capacity and operator into properties', () => {
    const spot: SpotRow = { ...SPOT, operator: 'APCOA', capacity: 200 };
    const result = spotsToGeoJSON([spot]);
    expect(result.features[0].properties.operator).toBe('APCOA');
    expect(result.features[0].properties.capacity).toBe(200);
  });
});
