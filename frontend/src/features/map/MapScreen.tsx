import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef, StyleSpecification } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import protomapsLayers from 'protomaps-themes-base';
import { useSpots } from './useSpots';
import { useRoute } from './useRoute';
import { SpotLayer } from './SpotLayer';
import { RouteLayer } from './RouteLayer';
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
  const [userLocation, setUserLocation] = useState<{ lon: number; lat: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const { geojson, onRegionDidChange } = useSpots();
  const route = useRoute(userLocation, selectedSpot);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(async ({ status }) => {
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({ lon: loc.coords.longitude, lat: loc.coords.latitude });
      } catch {
        setLocationDenied(true);
      }
    });
  }, []);

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
        <RouteLayer geometry={route.data?.geometry ?? null} />
        <SpotLayer
          geojson={geojson}
          onSpotPress={handleSpotPress}
          cameraRef={cameraRef}
        />
      </Map>
      <SpotDetailSheet
        spot={selectedSpot}
        onClose={handleSheetClose}
        route={route}
        locationDenied={locationDenied}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
