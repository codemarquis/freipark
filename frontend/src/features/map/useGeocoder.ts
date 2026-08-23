import { useEffect, useState } from 'react';

export type GeoResult = {
  id: string;
  label: string;
  lon: number;
  lat: number;
};

export function useGeocoder(query: string) {
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=de`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'FreiPark/1.0 (geraldezeani@pm.me)' },
        });
        const data: Array<{ place_id: number; display_name: string; lon: string; lat: string }> =
          await res.json();
        setResults(
          data.map((r) => ({
            id: String(r.place_id),
            label: r.display_name,
            lon: parseFloat(r.lon),
            lat: parseFloat(r.lat),
          }))
        );
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [query]);

  return { results, loading };
}
