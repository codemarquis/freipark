import type { SpotRow } from '../../lib/types';

export type ReportStatus = 'free' | 'full';

/** Errors the UI distinguishes. Anything else from the RPC is 'unknown'. */
export type ReportErrorCode =
  | 'not_authenticated'
  | 'too_far'
  | 'rate_limited_spot'
  | 'rate_limited_hourly'
  | 'location_unavailable'
  | 'unknown';

/** Mirrors the 30-minute window in supabase/migrations/007_spot_reports.sql. */
export const REPORT_TTL_MS = 30 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/** Parses a timestamptz from PostgREST. Trims microseconds to milliseconds
 *  first: Hermes's Date.parse isn't guaranteed to accept 6 fractional digits. */
function parseTimestamp(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
}

export function isActive(reportAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!reportAt) return false;
  const at = parseTimestamp(reportAt);
  return !Number.isNaN(at) && now - at < REPORT_TTL_MS;
}

export function ageMinutes(reportAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - parseTimestamp(reportAt)) / MINUTE_MS));
}

/** The spot's report if it's still active, for display. Accepts missing
 *  fields: MapLibre can drop null-valued properties from tapped features. */
export function activeReport(
  spot: Partial<Pick<SpotRow, 'report_status' | 'report_at'>>,
  now: number = Date.now(),
): { status: ReportStatus; minutesAgo: number } | null {
  const { report_status: status, report_at: at } = spot;
  if (!status || !at || !isActive(at, now)) return null;
  return { status, minutesAgo: ageMinutes(at, now) };
}

/** Maps the RPC error message (report_spot raises bare codes) to a code the
 *  UI handles. invalid_status / spot_not_found are programming errors, so
 *  they get the generic message. */
export function errorCode(message: string | undefined): ReportErrorCode {
  switch (message) {
    case 'not_authenticated':
    case 'too_far':
    case 'rate_limited_spot':
    case 'rate_limited_hourly':
      return message;
    default:
      return 'unknown';
  }
}

/** Mirrors report_spot's distance check: street spots are points; lots,
 *  garages and zones are areas whose centroid can be far from the driver. */
export function maxRadiusFor(spotType: SpotRow['spot_type']): 150 | 300 {
  return spotType === 'street' ? 150 : 300;
}
