import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { posthog } from '../../lib/posthog';
import { supabase } from '../../lib/supabase';
import type { SpotRow } from '../../lib/types';
import { errorCode } from './reportStatus';
import type { ReportErrorCode, ReportStatus } from './reportStatus';

/** How long to wait for a location fix before giving up. */
export const LOCATION_TIMEOUT_MS = 10_000;

export interface SubmittedReport {
  spotId: string;
  status: ReportStatus;
  reportedAt: string;
}

export type SubmitOutcome =
  | { ok: true; report: SubmittedReport }
  // 'busy': a report is already in flight; the tap is ignored, not an error.
  | { ok: false; error: ReportErrorCode | 'busy' };

/** One row of report_spot's RETURNS TABLE (migration 007). */
interface ReportSpotRow {
  status: ReportStatus;
  reported_at: string;
}

function isReportSpotRow(value: unknown): value is ReportSpotRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (row.status === 'free' || row.status === 'full') && typeof row.reported_at === 'string';
}

class LocationUnavailable extends Error {}

/** A fresh fix at submit time: MapScreen's userLocation is captured once at
 *  mount, and the driver has usually moved since. */
async function currentPosition(): Promise<{ lon: number; lat: number }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LocationUnavailable('timeout')), LOCATION_TIMEOUT_MS);
  });
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
    return { lon: position.coords.longitude, lat: position.coords.latitude };
  } catch {
    throw new LocationUnavailable('no fix');
  } finally {
    clearTimeout(timer);
  }
}

export function useReportSpot() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReportErrorCode | null>(null);
  const [lastReport, setLastReport] = useState<SubmittedReport | null>(null);
  // A ref, not state: two taps in the same render must see each other.
  const inFlight = useRef(false);

  const fail = useCallback((code: ReportErrorCode): SubmitOutcome => {
    setError(code);
    // Never coordinates, distance or user ids (SPEC-spot-reports.md).
    posthog?.capture('spot_report_failed', { reason: code });
    return { ok: false, error: code };
  }, []);

  const submit = useCallback(
    async (spot: SpotRow, status: ReportStatus): Promise<SubmitOutcome> => {
      if (inFlight.current) return { ok: false, error: 'busy' };
      inFlight.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return fail('not_authenticated');

        let position: { lon: number; lat: number };
        try {
          position = await currentPosition();
        } catch {
          return fail('location_unavailable');
        }

        const { data, error: rpcError } = await supabase.rpc('report_spot', {
          p_spot_id: spot.id,
          p_status: status,
          p_lon: position.lon,
          p_lat: position.lat,
        });
        if (rpcError) return fail(errorCode(rpcError.message));

        const row: unknown = Array.isArray(data) ? data[0] : undefined;
        if (!isReportSpotRow(row)) return fail('unknown');

        const report: SubmittedReport = {
          spotId: spot.id,
          status: row.status,
          reportedAt: row.reported_at,
        };
        setLastReport(report);
        posthog?.capture('spot_report_submitted', {
          report_status: row.status,
          parking_spot_type: spot.spot_type,
          parking_access: spot.access ?? 'unknown',
        });
        return { ok: true, report };
      } catch {
        return fail('unknown');
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [fail],
  );

  return { submit, submitting, error, lastReport };
}
