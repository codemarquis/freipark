import { renderHook, waitFor, act } from '@testing-library/react-native';
import { supabase } from '../src/lib/supabase';
import { useSpots } from '../src/features/map/useSpots';
import type { SpotRow } from '../src/lib/types';

jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = supabase.rpc as jest.Mock;

const SPOT: SpotRow = {
  id: '1',
  spot_type: 'street',
  access: 'free',
  operator: null,
  capacity: null,
  lon: 13.405,
  lat: 52.52,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [SPOT], error: null });
});

describe('useSpots', () => {
  // ─── mount behaviour (real timers) ─────────────────────────────────────────

  it('fetches the Berlin initial bbox on mount', async () => {
    await renderHook(() => useSpots());
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith('spots_in_bbox', {
      min_lon: 13.28,
      min_lat: 52.47,
      max_lon: 13.53,
      max_lat: 52.57,
      lim: 2000,
    });
  });

  it('starts with an empty FeatureCollection before the fetch resolves', async () => {
    mockRpc.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = await renderHook(() => useSpots());
    expect(result.current.geojson).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('populates geojson with Point features after a successful fetch', async () => {
    const { result } = await renderHook(() => useSpots());
    await waitFor(() => expect(result.current.geojson.features).toHaveLength(1));
    expect(result.current.geojson.type).toBe('FeatureCollection');
    expect(result.current.geojson.features[0]).toMatchObject({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [13.405, 52.52] },
      properties: expect.objectContaining({ id: '1' }),
    });
  });

  it('leaves geojson empty when the RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network fail' } });
    const { result } = await renderHook(() => useSpots());
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(result.current.geojson.features).toHaveLength(0);
  });

  // ─── onRegionDidChange (fake timers — isolate debounce control) ────────────

  describe('onRegionDidChange', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Helper: mount the hook, flush the initial async fetch, and clear call
    // history so tests start with a clean mockRpc slate.
    async function mountAndFlush() {
      const hook = await renderHook(() => useSpots());
      // The initial useEffect calls fetchBbox, which resolves as a microtask
      // (not a timer).  await act(async () => {}) drains the microtask queue.
      await act(async () => {});
      mockRpc.mockClear();
      return hook;
    }

    it('fetches with correctly mapped bbox params', async () => {
      const { result } = await mountAndFlush();

      await act(async () => {
        result.current.onRegionDidChange({
          nativeEvent: { bounds: [10.0, 48.0, 11.0, 49.0] },
        } as any);
        await jest.advanceTimersByTimeAsync(600); // past the 500 ms debounce, flushing fetchBbox too
      });

      expect(mockRpc).toHaveBeenCalledWith('spots_in_bbox', {
        min_lon: 10.0,
        min_lat: 48.0,
        max_lon: 11.0,
        max_lat: 49.0,
        lim: 2000,
      });
    });

    it('ignores events with no bounds', async () => {
      const { result } = await mountAndFlush();

      await act(async () => {
        result.current.onRegionDidChange({ nativeEvent: { bounds: undefined } } as any);
        await jest.advanceTimersByTimeAsync(600);
      });

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('coalesces rapid region changes — only the last bounds is fetched', async () => {
      const { result } = await mountAndFlush();

      await act(async () => {
        result.current.onRegionDidChange({ nativeEvent: { bounds: [10, 48, 11, 49] } } as any);
        result.current.onRegionDidChange({ nativeEvent: { bounds: [11, 48, 12, 49] } } as any);
        result.current.onRegionDidChange({ nativeEvent: { bounds: [12, 48, 13, 49] } } as any);
        await jest.advanceTimersByTimeAsync(600);
      });

      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith('spots_in_bbox', {
        min_lon: 12,
        min_lat: 48,
        max_lon: 13,
        max_lat: 49,
        lim: 2000,
      });
    });

    it('discards a stale response that resolves after a newer request', async () => {
      const { result } = await mountAndFlush();

      // Two overlapping fetches, resolved out of order: the OLDER request
      // (fired first, for a huge zoomed-out bbox) resolves AFTER the NEWER
      // one (fired second, for a small zoomed-in bbox) — exactly what can
      // happen on a real network during a fast pinch-zoom. The final state
      // must reflect the newer request, not whichever happened to resolve
      // last on the wire.
      let resolveOld: (value: { data: SpotRow[]; error: null }) => void = () => {};
      let resolveNew: (value: { data: SpotRow[]; error: null }) => void = () => {};
      mockRpc
        .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
        .mockImplementationOnce(() => new Promise((resolve) => (resolveNew = resolve)));

      const OLD_SPOT: SpotRow = { ...SPOT, id: 'old' };
      const NEW_SPOT: SpotRow = { ...SPOT, id: 'new' };

      await act(async () => {
        result.current.onRegionDidChange({ nativeEvent: { bounds: [0, 0, 40, 40] } } as any);
        await jest.advanceTimersByTimeAsync(600);
      });
      await act(async () => {
        result.current.onRegionDidChange({ nativeEvent: { bounds: [13, 52, 14, 53] } } as any);
        await jest.advanceTimersByTimeAsync(600);
      });

      // Resolve out of order: newer request's response arrives first,
      // older request's response arrives second (i.e., late).
      await act(async () => {
        resolveNew({ data: [NEW_SPOT], error: null });
      });
      await act(async () => {
        resolveOld({ data: [OLD_SPOT], error: null });
      });

      expect(result.current.geojson.features).toHaveLength(1);
      expect(result.current.geojson.features[0].properties).toMatchObject({ id: 'new' });
    });
  });
});
