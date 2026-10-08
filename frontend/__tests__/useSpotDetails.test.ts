import { act, renderHook } from '@testing-library/react-native';
import { supabase } from '../src/lib/supabase';
import { useSpotDetails } from '../src/features/map/useSpotDetails';

jest.mock('../src/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const mockRpc = supabase.rpc as jest.Mock;

const ROW = {
  address_street: 'Oranienstraße',
  address_housenumber: '12',
  address_postcode: '10997',
  address_source: 'nearest_address',
  city_name: 'Berlin',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [ROW], error: null });
});

describe('useSpotDetails', () => {
  it('passes rule tags through, keeping only string values', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ ...ROW, rule_tags: { fee: 'yes', zone: '23', capacity: 4, weird: null } }],
      error: null,
    });
    const { result } = await renderHook(() => useSpotDetails('spot-1'));
    await act(async () => {});
    expect(result.current?.rule_tags).toEqual({ fee: 'yes', zone: '23' });
  });

  it('treats missing or malformed rule tags as none, keeping the address (server before 012)', async () => {
    for (const rule_tags of [undefined, null, 'fee=yes', ['fee']]) {
      mockRpc.mockResolvedValueOnce({ data: [{ ...ROW, rule_tags }], error: null });
      const { result } = await renderHook(() => useSpotDetails(`spot-${String(rule_tags)}`));
      await act(async () => {});
      expect(result.current).toEqual({ ...ROW, rule_tags: {} });
    }
  });

  it('fetches spot_details for the spot and returns the row', async () => {
    const { result } = await renderHook(() => useSpotDetails('spot-1'));
    await act(async () => {});
    expect(mockRpc).toHaveBeenCalledWith('spot_details', { p_spot_id: 'spot-1' });
    expect(result.current).toEqual({ ...ROW, rule_tags: {} });
  });

  it('does nothing without a spot', async () => {
    const { result } = await renderHook(() => useSpotDetails(null));
    await act(async () => {});
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('ignores a late answer for a spot that is no longer selected', async () => {
    let resolveFirst: (v: { data: unknown; error: null }) => void = () => {};
    mockRpc
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ data: [{ ...ROW, address_street: 'Zweite Straße' }], error: null });
    const { result, rerender } = await renderHook(({ id }: { id: string }) => useSpotDetails(id), {
      initialProps: { id: 'spot-1' },
    });
    await rerender({ id: 'spot-2' });
    await act(async () => {});
    await act(async () => {
      resolveFirst({ data: [ROW], error: null });
    });
    expect(result.current?.address_street).toBe('Zweite Straße');
  });

  it('clears the previous spot’s details while the next one loads', async () => {
    const { result, rerender } = await renderHook(({ id }: { id: string }) => useSpotDetails(id), {
      initialProps: { id: 'spot-1' },
    });
    await act(async () => {});
    expect(result.current).toEqual({ ...ROW, rule_tags: {} });
    mockRpc.mockReturnValueOnce(new Promise(() => {}));
    await rerender({ id: 'spot-2' });
    expect(result.current).toBeNull();
  });

  it.each([
    ['an error', { data: null, error: { message: 'boom' } }],
    ['no row', { data: [], error: null }],
    ['a malformed row', { data: [{ address_street: 5, city_name: null }], error: null }],
    ['an unknown source', { data: [{ ...ROW, address_source: 'guessed' }], error: null }],
  ])('returns null for %s', async (_label, response) => {
    mockRpc.mockResolvedValue(response);
    const { result } = await renderHook(() => useSpotDetails('spot-1'));
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it('returns null when the request throws', async () => {
    mockRpc.mockRejectedValue(new Error('Network request failed'));
    const { result } = await renderHook(() => useSpotDetails('spot-1'));
    await act(async () => {});
    expect(result.current).toBeNull();
  });
});
