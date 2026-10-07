// Builds the text a driver sends via the phone's share sheet
// (SPEC-map.md § Share a spot). Pure: labels arrive already translated.

export interface ShareSpotInput {
  typeLabel: string;
  accessLabel: string;
  /** "Reported free · 4 min ago" while a report is active, otherwise null. */
  statusLine: string | null;
  lat: number;
  lon: number;
}

function coord(value: number): string {
  return value.toFixed(5); // ~1 m
}

/** Google Maps' documented cross-platform URL: opens the Maps app on iOS and
 *  Android, or the browser. A plain link — no API key, no per-use cost. */
export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord(lat)},${coord(lon)}`;
}

export function buildShareMessage({ typeLabel, accessLabel, statusLine, lat, lon }: ShareSpotInput): string {
  return [
    `${typeLabel} · ${accessLabel}`,
    ...(statusLine ? [statusLine] : []),
    `${coord(lat)}, ${coord(lon)}`,
    mapsUrl(lat, lon),
  ].join('\n');
}
