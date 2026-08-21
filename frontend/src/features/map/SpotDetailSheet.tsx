import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { PaymentLinks } from './PaymentLinks';
import type { RouteState } from './useRoute';
import type { SpotRow } from '../../lib/types';

const SNAP_POINTS = ['35%', '55%'];

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(s: number): string {
  if (s < 60) return '<1 min';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h ${m}m`;
}

const ACCESS_LABEL: Record<NonNullable<SpotRow['access']>, string> = {
  free: 'Free parking',
  paid: 'Paid parking',
  permit: 'Permit required',
  private: 'Private',
};

const TYPE_LABEL: Record<SpotRow['spot_type'], string> = {
  street: 'Street parking',
  garage: 'Parking garage',
  lot: 'Parking lot',
  zone: 'Parking zone',
};

interface SpotDetailSheetProps {
  spot: SpotRow | null;
  onClose: () => void;
  route: RouteState;
  locationDenied: boolean;
}

export function SpotDetailSheet({ spot, onClose, route, locationDenied }: SpotDetailSheetProps) {
  const sheetRef = useRef<BottomSheetMethods>(null);
  const [appleMapsAvailable, setAppleMapsAvailable] = useState(false);
  const [googleMapsAvailable, setGoogleMapsAvailable] = useState(false);

  useEffect(() => {
    if (!spot) {
      setAppleMapsAvailable(false);
      setGoogleMapsAvailable(false);
      return;
    }
    if (Platform.OS === 'ios') {
      Linking.canOpenURL('maps://').then(setAppleMapsAvailable);
      Linking.canOpenURL('comgooglemaps://').then(setGoogleMapsAvailable);
    } else {
      Linking.canOpenURL('geo:0,0').then(setAppleMapsAvailable);
    }
  }, [spot]);

  useEffect(() => {
    if (spot) {
      sheetRef.current?.snapToIndex(0);
    }
  }, [spot]);

  function openInAppleMaps() {
    if (!spot) return;
    const url =
      Platform.OS === 'ios'
        ? `maps://?daddr=${spot.lat},${spot.lon}`
        : `geo:${spot.lat},${spot.lon}?q=${spot.lat},${spot.lon}`;
    Linking.openURL(url).catch(() => {});
  }

  function openInGoogleMaps() {
    if (!spot) return;
    Linking.openURL(
      `comgooglemaps://?daddr=${spot.lat},${spot.lon}&directionsmode=driving`
    ).catch(() => {});
  }

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onClose={onClose}
      style={styles.sheet}
    >
      <BottomSheetView style={styles.content}>
        {spot && (
          <>
            <Text style={styles.type}>{TYPE_LABEL[spot.spot_type]}</Text>
            <Text style={styles.access}>
              {spot.access ? ACCESS_LABEL[spot.access] : 'Access unknown'}
            </Text>

            {locationDenied ? (
              <Text style={styles.routeHint}>Enable location to see directions.</Text>
            ) : route.loading ? (
              <Text style={styles.routeHint}>Getting directions…</Text>
            ) : route.data ? (
              <Text style={styles.routeInfo}>
                {formatDistance(route.data.distance_m)} · {formatDuration(route.data.duration_s)}
              </Text>
            ) : route.error ? (
              <Text style={styles.routeHint}>Directions unavailable.</Text>
            ) : null}

            {spot.operator && (
              <Text style={styles.meta}>Operator: {spot.operator}</Text>
            )}
            {spot.capacity != null && (
              <Text style={styles.meta}>Capacity: {spot.capacity}</Text>
            )}
            {spot.access === 'permit' && (
              <Text style={styles.permit}>
                A valid parking permit is required for this spot.
              </Text>
            )}
            {spot.access === 'paid' && <PaymentLinks />}

            {appleMapsAvailable && (
              <Pressable style={styles.mapsButton} onPress={openInAppleMaps}>
                <Text style={styles.mapsButtonText}>
                  {Platform.OS === 'ios' ? 'Open in Apple Maps' : 'Open in Maps'}
                </Text>
              </Pressable>
            )}
            {googleMapsAvailable && (
              <Pressable style={styles.mapsButton} onPress={openInGoogleMaps}>
                <Text style={styles.mapsButtonText}>Open in Google Maps</Text>
              </Pressable>
            )}
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  type: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  access: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 12,
  },
  meta: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 4,
  },
  permit: {
    marginTop: 12,
    fontSize: 14,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 8,
  },
  routeInfo: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6366f1',
    marginBottom: 10,
  },
  routeHint: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 8,
  },
  mapsButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#94a3b8',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  mapsButtonText: {
    color: '#475569',
    fontWeight: '500',
    fontSize: 15,
  },
});
