import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef, StyleSpecification } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import protomapsLayers from 'protomaps-themes-base';
import { useSpots } from './useSpots';
import { useRoute } from './useRoute';
import { SpotLayer } from './SpotLayer';
import { RouteLayer } from './RouteLayer';
import { SearchBar } from './SearchBar';
import { SpotDetailSheet } from './SpotDetailSheet';
import type { GeoResult } from './useGeocoder';
import type { SpotRow } from '../../lib/types';

const BERLIN: [number, number] = [13.405, 52.52];
const PMTILES_URL = process.env.EXPO_PUBLIC_PMTILES_URL ?? '';

// germany.pmtiles coverage — reject GPS fixes outside this box (e.g. simulator default = Cupertino)
const GERMANY = { west: 4.5, south: 46.5, east: 15.1, north: 55.1 };
function inGermany(lon: number, lat: number) {
  return lon >= GERMANY.west && lon <= GERMANY.east && lat >= GERMANY.south && lat <= GERMANY.north;
}

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
  const hasCenteredRef = useRef(false);
  const [selectedSpot, setSelectedSpot] = useState<SpotRow | null>(null);
  const [userLocation, setUserLocation] = useState<{ lon: number; lat: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { geojson, onRegionDidChange } = useSpots();
  const route = useRoute(userLocation, selectedSpot);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        setLocationLoading(false);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({ lon: loc.coords.longitude, lat: loc.coords.latitude });
      } catch {
        // Simulator / no GPS fix — camera stays on Berlin fallback
      } finally {
        setLocationLoading(false);
      }
    })();
  }, []);

  // Fly to user location once when it first becomes available, but only if it's in Germany.
  // The iOS simulator returns Cupertino (37.785, -122.406) by default — outside tile coverage.
  useEffect(() => {
    if (userLocation && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      if (inGermany(userLocation.lon, userLocation.lat)) {
        setTimeout(() => {
          cameraRef.current?.flyTo({
            center: [userLocation.lon, userLocation.lat],
            zoom: 15,
            duration: 1200,
          });
        }, 0);
      }
      // Outside Germany: stay on Berlin fallback — map already centred there.
    }
  }, [userLocation]);

  const handleGeoSelect = useCallback((result: GeoResult) => {
    hasCenteredRef.current = true;
    setTimeout(() => {
      cameraRef.current?.flyTo({ center: [result.lon, result.lat], zoom: 14, duration: 1000 });
    }, 0);
  }, []);

  const handleSpotPress = useCallback((spot: SpotRow) => {
    setSelectedSpot(spot);
  }, []);

  const handleSheetClose = useCallback(() => {
    setSelectedSpot(null);
  }, []);

  function openLocationSettings() {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => {});
    } else {
      Linking.openSettings().catch(() => {});
    }
  }

  const showBanner = locationDenied && !bannerDismissed;

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={MAP_STYLE}
        onRegionDidChange={onRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: BERLIN, zoom: 12 }}
          minZoom={5.5}
          maxBounds={[4.5, 46.5, 15.1, 55.1]}
        />
        {!locationDenied && <UserLocation />}
        <RouteLayer geometry={route.data?.geometry ?? null} />
        <SpotLayer
          geojson={geojson}
          onSpotPress={handleSpotPress}
          cameraRef={cameraRef}
        />
      </Map>

      <SearchBar onSelect={handleGeoSelect} />

      {locationLoading && !locationDenied && (
        <View style={styles.locatingChip} pointerEvents="none">
          <Text style={styles.locatingText}>Locating…</Text>
        </View>
      )}

      {showBanner && (
        <View style={styles.locationBanner}>
          <Text style={styles.locationBannerText} numberOfLines={2}>
            Enable location to find spots near you
          </Text>
          <Pressable
            onPress={openLocationSettings}
            style={styles.settingsButton}
            accessibilityRole="button"
            accessibilityLabel="Open location settings"
          >
            <Text style={styles.settingsButtonText}>Settings</Text>
          </Pressable>
          <Pressable
            onPress={() => setBannerDismissed(true)}
            style={styles.dismissButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
          >
            <Text style={styles.dismissText}>✕</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
      </View>
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
  locatingChip: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  locatingText: {
    fontSize: 12,
    color: '#64748b',
  },
  locationBanner: {
    position: 'absolute',
    bottom: 30,
    left: 12,
    right: 12,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  locationBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 18,
  },
  settingsButton: {
    backgroundColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  settingsButtonText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
  },
  dismissText: {
    fontSize: 14,
    color: '#94a3b8',
  },
  attribution: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  attributionText: {
    fontSize: 10,
    color: '#1e293b',
  },
});
