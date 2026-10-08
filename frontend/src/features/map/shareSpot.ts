// Builds the text a driver sends via the phone's share sheet
// (SPEC-map.md § Share a spot). Pure: labels arrive already translated.
import { formatCoords } from './spotAddress';

export interface ShareSpotInput {
  typeLabel: string;
  accessLabel: string;
  /** "Reported free · 4 min ago" while a report is active, otherwise null. */
  statusLine: string | null;
  /** "near Oranienstraße 12, 10997 Berlin" when known (SPEC-spot-address.md). */
  addressLine: string | null;
  lat: number;
  lon: number;
}

/** Google Maps' documented cross-platform URL: opens the Maps app on iOS and
 *  Android, or the browser. A plain link — no API key, no per-use cost. */
export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export function buildShareMessage({
  typeLabel,
  accessLabel,
  statusLine,
  addressLine,
  lat,
  lon,
}: ShareSpotInput): string {
  return [
    `${typeLabel} · ${accessLabel}`,
    ...(statusLine ? [statusLine] : []),
    ...(addressLine ? [addressLine] : []),
    formatCoords(lat, lon),
    mapsUrl(lat, lon),
  ].join('\n');
}
