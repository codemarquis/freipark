import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { supabase } from '../src/lib/supabase';
import { posthog } from '../src/lib/posthog';
import { LOCATION_TIMEOUT_MS, useReportSpot } from '../src/features/reports/useReportSpot';
import type { SpotRow } from '../src/lib/types';

jest.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() },
}));
jest.mock('../src/lib/posthog', () => ({ posthog: { capture: jest.fn() } }));
jest.mock('expo-location', () => ({
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockCapture = (posthog as unknown as { capture: jest.Mock }).capture;
const mockGetPosition = Location.getCurrentPositionAsync as jest.Mock;

const SPOT: SpotRow = {
  id: 'spot-1',
  spot_type: 'lot',
  access: 'paid',
  operator: null,
  capacity: 120,
  lon: 13.405,
  lat: 52.52,
  report_status: null,
  report_at: null,
};
const REPORTED_AT = '2026-10-07T12:00:00.123456+00:00';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
  mockGetPosition.mockResolvedValue({ coords: { longitude: 13.4051, latitude: 52.5201 } });
  mockRpc.mockResolvedValue({
    data: [{ status: 'free', reported_at: REPORTED_AT, expires_at: '2026-10-07T12:30:00.123456+00:00' }],
    error: null,
  });
});

async function submit(status: 'free' | 'full' = 'free') {
  const hook = await renderHook(() => useReportSpot());
  let outcome: Awaited<ReturnType<typeof hook.result.current.submit>> | undefined;
  await act(async () => {
    outcome = await hook.result.current.submit(SPOT, status);
  });
  return { ...hook, outcome };
}

describe('useReportSpot', () => {
  it('sends a fresh location fix with the report', async () => {
    const { outcome, result } = await submit('free');

    expect(mockGetPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
    expect(mockRpc).toHaveBeenCalledWith('report_spot', {
      p_spot_id: 'spot-1',
      p_status: 'free',
      p_lon: 13.4051,
      p_lat: 52.5201,
    });
    expect(outcome).toEqual({ ok: true, report: { spotId: 'spot-1', status: 'free', reportedAt: REPORTED_AT } });
    expect(result.current.lastReport).toEqual({ spotId: 'spot-1', status: 'free', reportedAt: REPORTED_AT });
    expect(result.current.error).toBeNull();
    expect(result.current.submitting).toBe(false);
  });

  it('records only non-identifying analytics on success', async () => {
    await submit('free');
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith('spot_report_submitted', {
      report_status: 'free',
      parking_spot_type: 'lot',
      parking_access: 'paid',
    });
  });

  it('does nothing but report not_authenticated when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { outcome, result } = await submit();

    expect(outcome).toEqual({ ok: false, error: 'not_authenticated' });
    expect(result.current.error).toBe('not_authenticated');
    expect(mockGetPosition).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['too_far', 'too_far'],
    ['rate_limited_spot', 'rate_limited_spot'],
    ['rate_limited_hourly', 'rate_limited_hourly'],
    ['not_authenticated', 'not_authenticated'],
    ['spot_not_found', 'unknown'],
    ['JWT expired', 'unknown'],
  ])('maps RPC error %p to %p', async (message, code) => {
    mockRpc.mockResolvedValue({ data: null, error: { message } });
    const { outcome, result } = await submit();

    expect(outcome).toEqual({ ok: false, error: code });
    expect(result.current.error).toBe(code);
    expect(result.current.lastReport).toBeNull();
    expect(mockCapture).toHaveBeenCalledWith('spot_report_failed', { reason: code });
  });

  it('treats an empty RPC response as unknown', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { outcome } = await submit();
    expect(outcome).toEqual({ ok: false, error: 'unknown' });
  });

  it('treats a thrown network error as unknown', async () => {
    mockRpc.mockRejectedValue(new Error('Network request failed'));
    const { outcome, result } = await submit();
    expect(outcome).toEqual({ ok: false, error: 'unknown' });
    expect(result.current.submitting).toBe(false);
  });

  it('maps a failed location fix to location_unavailable without calling the RPC', async () => {
    mockGetPosition.mockRejectedValue(new Error('Location services are disabled'));
    const { outcome } = await submit();

    expect(outcome).toEqual({ ok: false, error: 'location_unavailable' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('gives up on the location fix after the timeout', async () => {
    jest.useFakeTimers();
    try {
      mockGetPosition.mockReturnValue(new Promise(() => {})); // never resolves
      const { result } = await renderHook(() => useReportSpot());

      let pending: ReturnType<typeof result.current.submit> | undefined;
      await act(async () => {
        pending = result.current.submit(SPOT, 'full');
        await jest.advanceTimersByTimeAsync(LOCATION_TIMEOUT_MS + 1);
      });

      await expect(pending).resolves.toEqual({ ok: false, error: 'location_unavailable' });
      expect(mockRpc).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('is submitting while the request is in flight', async () => {
    let resolveRpc: (value: { data: unknown; error: null }) => void = () => {};
    mockRpc.mockReturnValue(new Promise((resolve) => (resolveRpc = resolve)));
    const { result } = await renderHook(() => useReportSpot());

    let pending: ReturnType<typeof result.current.submit> | undefined;
    await act(async () => {
      pending = result.current.submit(SPOT, 'free');
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolveRpc({ data: [{ status: 'free', reported_at: REPORTED_AT }], error: null });
      await pending;
    });
    expect(result.current.submitting).toBe(false);
  });

  it('ignores a second tap while a report is in flight', async () => {
    let resolveRpc: (value: { data: unknown; error: null }) => void = () => {};
    mockRpc.mockReturnValue(new Promise((resolve) => (resolveRpc = resolve)));
    const { result } = await renderHook(() => useReportSpot());

    let first: ReturnType<typeof result.current.submit> | undefined;
    let second: ReturnType<typeof result.current.submit> | undefined;
    await act(async () => {
      first = result.current.submit(SPOT, 'free');
      second = result.current.submit(SPOT, 'full');
    });

    await expect(second).resolves.toEqual({ ok: false, error: 'busy' });
    await act(async () => {
      resolveRpc({ data: [{ status: 'free', reported_at: REPORTED_AT }], error: null });
      await first;
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('clears the previous error on the next attempt', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'too_far' } });
    const { result } = await renderHook(() => useReportSpot());

    await act(async () => {
      await result.current.submit(SPOT, 'free');
    });
    expect(result.current.error).toBe('too_far');

    await act(async () => {
      await result.current.submit(SPOT, 'free');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.lastReport?.status).toBe('free');
  });
});
