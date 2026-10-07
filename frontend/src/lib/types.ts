export interface SpotRow {
  id: string;
  spot_type: 'street' | 'garage' | 'lot' | 'zone';
  access: 'free' | 'paid' | 'permit' | 'private' | null;
  operator: string | null;
  capacity: number | null;
  lon: number;
  lat: number;
  /** Latest report from the last 30 minutes (spots_in_bbox, migration 007). */
  report_status: 'free' | 'full' | null;
  /** When that report was made (timestamptz from PostgREST); null if none. */
  report_at: string | null;
}
