import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AddressSource, SpotDetails } from './spotAddress';

const SOURCES: readonly AddressSource[] = ['own_tags', 'street_name', 'nearest_address', 'nearest_street'];

const textOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isSpotDetails(value: unknown): value is SpotDetails {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    textOrNull(row.address_street) &&
    textOrNull(row.address_housenumber) &&
    textOrNull(row.address_postcode) &&
    (row.address_source === null || SOURCES.includes(row.address_source as AddressSource)) &&
    typeof row.city_name === 'string'
  );
}

/** Address details for the open spot (spot_details RPC, SPEC-spot-address.md).
 *  null while loading, when there's no spot, or on any failure — the sheet
 *  then simply shows no address line. */
export function useSpotDetails(spotId: string | null): SpotDetails | null {
  const [details, setDetails] = useState<SpotDetails | null>(null);
  // The latest spot asked about: a slower answer for a spot the user has
  // already moved away from must not overwrite the current one.
  const latest = useRef<string | null>(null);

  useEffect(() => {
    latest.current = spotId;
    setDetails(null);
    if (!spotId) return;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('spot_details', { p_spot_id: spotId });
        if (latest.current !== spotId) return;
        const row: unknown = !error && Array.isArray(data) ? data[0] : undefined;
        setDetails(isSpotDetails(row) ? row : null);
      } catch {
        if (latest.current === spotId) setDetails(null);
      }
    })();
  }, [spotId]);

  return details;
}
