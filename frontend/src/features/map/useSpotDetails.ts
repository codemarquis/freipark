import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AddressSource, SpotDetails } from './spotAddress';

const SOURCES: readonly AddressSource[] = ['own_tags', 'street_name', 'nearest_address', 'nearest_street'];

const textOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

/** Only string values survive; anything else (or a server without 012) → {}. */
function toRuleTags(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') tags[k] = v;
  return tags;
}

function toSpotDetails(value: unknown): SpotDetails | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const { address_street: street, address_housenumber: number, address_postcode: postcode } = row;
  if (
    !textOrNull(street) ||
    !textOrNull(number) ||
    !textOrNull(postcode) ||
    !(row.address_source === null || SOURCES.includes(row.address_source as AddressSource)) ||
    typeof row.city_name !== 'string'
  ) {
    return null;
  }
  return {
    address_street: street,
    address_housenumber: number,
    address_postcode: postcode,
    address_source: row.address_source as AddressSource | null,
    city_name: row.city_name,
    rule_tags: toRuleTags(row.rule_tags),
  };
}

/** Address and rule tags for the open spot (spot_details RPC, SPEC-spot-address.md,
 *  SPEC-parking-rules.md).
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
        setDetails(toSpotDetails(row));
      } catch {
        if (latest.current === spotId) setDetails(null);
      }
    })();
  }, [spotId]);

  return details;
}
