import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef, StyleSpecification } from '@maplibre/maplibre-react-native';
import { useSpots } from './useSpots';
import { SpotLayer } from './SpotLayer';
import type { SpotRow } from '../../lib/types';

const BERLIN: [number, number] = [13.405, 52.52];
const PMTILES_URL = process.env.EXPO_PUBLIC_PMTILES_URL ?? '';

// MapLibre Native 6.26+ resolves pmtiles:// URLs natively via HTTP range requests.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs:
    'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sources: {
    protomaps: {
      type: 'vector',
      url: `pmtiles://${PMTILES_URL}`,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f2efe9' },
    },
    {
      id: 'earth',
      type: 'fill',
      source: 'protomaps',
      'source-layer': 'earth',
      paint: { 'fill-color': '#e8e0d4' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'protomaps',
      'source-layer': 'water',
      paint: { 'fill-color': '#a8c8d8' },
    },
    {
      id: 'natural_park',
      type: 'fill',
      source: 'protomaps',
      'source-layer': 'natural',
      filter: ['in', 'pmap:kind', 'park', 'wood', 'nature_reserve', 'grass'],
      paint: { 'fill-color': '#c8d8a8', 'fill-opacity': 0.7 },
    },
    {
      id: 'buildings',
      type: 'fill',
      source: 'protomaps',
      'source-layer': 'buildings',
      paint: { 'fill-color': '#d4cfc8', 'fill-opacity': 0.8 },
    },
    {
      id: 'roads_minor',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      filter: ['!in', 'pmap:kind', 'highway', 'major_road'],
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 2],
      },
    },
    {
      id: 'roads_major',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      filter: ['in', 'pmap:kind', 'major_road', 'highway'],
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 4, 18, 8],
      },
    },
  ],
};

export function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);
  const [selectedSpot, setSelectedSpot] = useState<SpotRow | null>(null);
  const { geojson, onRegionDidChange } = useSpots();

  const handleSpotPress = useCallback((spot: SpotRow) => {
    setSelectedSpot(spot);
  }, []);

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={MAP_STYLE}
        onRegionDidChange={onRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: BERLIN, zoom: 13 }}
        />
        <SpotLayer
          geojson={geojson}
          onSpotPress={handleSpotPress}
          cameraRef={cameraRef}
        />
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
