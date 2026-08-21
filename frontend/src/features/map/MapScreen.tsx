import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef, StyleSpecification } from '@maplibre/maplibre-react-native';
import protomapsLayers from 'protomaps-themes-base';
import { useSpots } from './useSpots';
import { SpotLayer } from './SpotLayer';
import { SpotDetailSheet } from './SpotDetailSheet';
import type { SpotRow } from '../../lib/types';

const BERLIN: [number, number] = [13.405, 52.52];
const PMTILES_URL = process.env.EXPO_PUBLIC_PMTILES_URL ?? '';

// MapLibre Native 6.26+ resolves pmtiles:// URLs natively via HTTP range requests.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs:
    'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sprite:
    'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
  sources: {
    protomaps: {
      type: 'vector',
      url: `pmtiles://${PMTILES_URL}`,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: protomapsLayers('protomaps', 'light', 'de'),
};

export function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);
  const [selectedSpot, setSelectedSpot] = useState<SpotRow | null>(null);
  const { geojson, onRegionDidChange } = useSpots();

  const handleSpotPress = useCallback((spot: SpotRow) => {
    setSelectedSpot(spot);
  }, []);

  const handleSheetClose = useCallback(() => {
    setSelectedSpot(null);
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
      <SpotDetailSheet spot={selectedSpot} onClose={handleSheetClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
