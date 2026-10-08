// Address and coordinates for the spot sheet and share message
// (SPEC-spot-address.md). Pure: callers pass the translator.
import type { TFunction } from 'i18next';

export type AddressSource = 'own_tags' | 'street_name' | 'nearest_address' | 'nearest_street';

/** One row of the spot_details RPC (migration 010). */
export interface SpotDetails {
  address_street: string | null;
  address_housenumber: string | null;
  address_postcode: string | null;
  address_source: AddressSource | null;
  city_name: string;
}

/** "Oranienstraße 12, 10997 Berlin" — missing parts left out. Rules 3–4
 *  (nearest address / street) are prefixed with a localised "near". */
export function formatAddress(details: SpotDetails, t: TFunction): string | null {
  const { address_street: street, address_housenumber: number, address_postcode: postcode } = details;
  if (!street) return null;
  const line = number ? `${street} ${number}` : street;
  const place = postcode ? `${postcode} ${details.city_name}` : details.city_name;
  const address = `${line}, ${place}`;
  const near =
    details.address_source === 'nearest_address' || details.address_source === 'nearest_street';
  return near ? t('spot.addressNear', { address }) : address;
}

/** "52.50562, 13.39693": lat, lon at 5 decimals (~1 m), as people paste them into map apps. */
export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
