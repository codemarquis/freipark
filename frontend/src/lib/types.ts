export interface SpotRow {
  id: string;
  spot_type: 'street' | 'garage' | 'lot' | 'zone';
  access: 'free' | 'paid' | 'permit' | 'private' | null;
  operator: string | null;
  capacity: number | null;
  lon: number;
  lat: number;
}
