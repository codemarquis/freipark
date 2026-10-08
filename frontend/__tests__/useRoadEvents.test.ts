import { act, renderHook } from '@testing-library/react-native';
import { supabase } from '../src/lib/supabase';
import { useRoadEvents } from '../src/features/map/useRoadEvents';

jest.mock('../src/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const mockRpc = supabase.rpc as jest.Mock;

const ROW = {
  id: 'e1',
  kind: 'closure',
  road: 'A100',
  title: 'A100 | Beusselstraße - Schmargendorf',
  subtitle: 'Wedding -> Neukölln',
  description: ['Beginn: 08.10.26', 'Ende: 09.10.26'],
  starts_at: '2026-10-08T10:00:00+00:00',
  ends_at: '2026-10-09T21:59:00+00:00',
  geometry: '{"type":"LineString","coordinates":[[13.29,52.53],[13.28,52.53]]}',
};

function regionChange(zoom: number, bounds: [number, number, number, number] = [13.2, 52.4, 13.6, 52.6]) {
  return { nativeEvent: { zoom, bounds } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [ROW], error: null });
});

describe('useRoadEvents', () => {
  it('fetches the Berlin starting area on mount and builds GeoJSON', async () => {
    const { result } = await renderHook(() => useRoadEvents());
    await act(async () => {});
    expect(mockRpc).toHaveBeenCalledWith('road_events_in_bbox', expect.objectContaining({ lim: 2000 }));
    expect(result.current.geojson.features).toHaveLength(1);
    const feature = result.current.geojson.features[0];
    expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[13.29, 52.53], [13.28, 52.53]] });
    expect(feature.properties).toEqual({
      id: 'e1', kind: 'closure', road: 'A100', title: 'A100 | Beusselstraße - Schmargendorf',
      subtitle: 'Wedding -> Neukölln', description: ['Beginn: 08.10.26', 'Ende: 09.10.26'],
      starts_at: '2026-10-08T10:00:00+00:00', ends_at: '2026-10-09T21:59:00+00:00',
    });
  });

  it('looks up the full event by id (map taps can flatten list properties)', async () => {
    const { result } = await renderHook(() => useRoadEvents());
    await act(async () => {});
    expect(result.current.eventById('e1')?.description).toEqual(['Beginn: 08.10.26', 'Ende: 09.10.26']);
    expect(result.current.eventById('nope')).toBeNull();
  });

  it('skips rows with unreadable geometry or an unknown kind', async () => {
    mockRpc.mockResolvedValue({
      data: [ROW, { ...ROW, id: 'bad-geom', geometry: 'not json' }, { ...ROW, id: 'bad-kind', kind: 'traffic_jam' }],
      error: null,
    });
    const { result } = await renderHook(() => useRoadEvents());
    await act(async () => {});
    expect(result.current.geojson.features.map((f) => f.properties.id)).toEqual(['e1']);
  });

  it('keeps the map empty on an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = await renderHook(() => useRoadEvents());
    await act(async () => {});
    expect(result.current.geojson.features).toEqual([]);
  });

  describe('when the map moves', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('fetches the new area after the debounce when zoomed in', async () => {
      const { result } = await renderHook(() => useRoadEvents());
      await act(async () => {});
      mockRpc.mockClear();
      await act(async () => {
        result.current.onRegionDidChange(regionChange(12, [10, 48, 11, 49]));
        await jest.advanceTimersByTimeAsync(600);
      });
      expect(mockRpc).toHaveBeenCalledWith('road_events_in_bbox', {
        min_lon: 10, min_lat: 48, max_lon: 11, max_lat: 49, lim: 2000,
      });
    });

    it('does not fetch below zoom 9, and clears the lines', async () => {
      const { result } = await renderHook(() => useRoadEvents());
      await act(async () => {});
      mockRpc.mockClear();
      await act(async () => {
        result.current.onRegionDidChange(regionChange(8));
        await jest.advanceTimersByTimeAsync(600);
      });
      expect(mockRpc).not.toHaveBeenCalled();
      expect(result.current.geojson.features).toEqual([]);
    });

    it('ignores a late answer for an older area', async () => {
      const { result } = await renderHook(() => useRoadEvents());
      await act(async () => {});
      let resolveOld: (v: { data: unknown; error: null }) => void = () => {};
      mockRpc
        .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
        .mockResolvedValueOnce({ data: [{ ...ROW, id: 'new' }], error: null });
      await act(async () => {
        result.current.onRegionDidChange(regionChange(12, [0, 0, 1, 1]));
        await jest.advanceTimersByTimeAsync(600);
      });
      await act(async () => {
        result.current.onRegionDidChange(regionChange(12, [13, 52, 14, 53]));
        await jest.advanceTimersByTimeAsync(600);
      });
      await act(async () => {
        resolveOld({ data: [{ ...ROW, id: 'old' }], error: null });
      });
      expect(result.current.geojson.features.map((f) => f.properties.id)).toEqual(['new']);
    });
  });
});
