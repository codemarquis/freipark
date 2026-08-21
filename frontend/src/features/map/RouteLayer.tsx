import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

interface RouteLayerProps {
  geometry: GeoJSON.LineString | null;
}

export function RouteLayer({ geometry }: RouteLayerProps) {
  const geojson: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
    type: 'FeatureCollection',
    features: geometry
      ? [{ type: 'Feature', geometry, properties: {} }]
      : [],
  };

  return (
    <GeoJSONSource id="route" data={geojson}>
      <Layer
        id="route-line"
        type="line"
        paint={{
          'line-color': '#6366f1',
          'line-width': 5,
          'line-opacity': 0.9,
        }}
        layout={{
          'line-cap': 'round',
          'line-join': 'round',
        }}
      />
    </GeoJSONSource>
  );
}
