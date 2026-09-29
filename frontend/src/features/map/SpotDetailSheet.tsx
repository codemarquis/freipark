import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { posthog } from '../../lib/posthog';
import { PaymentLinks } from './PaymentLinks';
import type { RouteState } from './useRoute';
import type { SpotRow } from '../../lib/types';

const SNAP_POINTS = ['35%', '55%'];

// Distances stay in m/km — identical abbreviations across de/en/tr, no
// translation needed. Durations do need it ("min"/"Min"/"dk" etc.).
function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(s: number, t: TFunction): string {
  if (s < 60) return t('spot.lessThanOneMin');
  if (s < 3600) return `${Math.round(s / 60)} ${t('spot.minutesShort')}`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return t('spot.hoursMinutes', { h, m });
}

const ACCESS_LABEL_KEY: Record<NonNullable<SpotRow['access']>, string> = {
  free: 'spot.accessFree',
  paid: 'spot.accessPaid',
  permit: 'spot.accessPermit',
  private: 'spot.accessPrivate',
};

const TYPE_LABEL_KEY: Record<SpotRow['spot_type'], string> = {
  street: 'spot.typeStreet',
  garage: 'spot.typeGarage',
  lot: 'spot.typeLot',
  zone: 'spot.typeZone',
};

interface SpotDetailSheetProps {
  spot: SpotRow | null;
  onClose: () => void;
  route: RouteState;
  locationDenied: boolean;
}

export function SpotDetailSheet({ spot, onClose, route, locationDenied }: SpotDetailSheetProps) {
  const { t } = useTranslation();
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
    posthog?.capture('navigation_opened', {
      map_provider: Platform.OS === 'ios' ? 'apple_maps' : 'system_maps',
      parking_access: spot.access ?? 'unknown',
      parking_spot_type: spot.spot_type,
    });
    const url =
      Platform.OS === 'ios'
        ? `maps://?daddr=${spot.lat},${spot.lon}`
        : `geo:${spot.lat},${spot.lon}?q=${spot.lat},${spot.lon}`;
    Linking.openURL(url).catch(() => {});
  }

  function openInGoogleMaps() {
    if (!spot) return;
    posthog?.capture('navigation_opened', {
      map_provider: 'google_maps',
      parking_access: spot.access ?? 'unknown',
      parking_spot_type: spot.spot_type,
    });
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
            <Text style={styles.type}>{t(TYPE_LABEL_KEY[spot.spot_type])}</Text>
            <Text style={styles.access}>
              {spot.access ? t(ACCESS_LABEL_KEY[spot.access]) : t('spot.accessUnknown')}
            </Text>

            {locationDenied ? (
              <Text style={styles.routeHint}>{t('spot.enableLocationForDirections')}</Text>
            ) : route.loading ? (
              <Text style={styles.routeHint}>{t('spot.gettingDirections')}</Text>
            ) : route.data ? (
              <Text style={styles.routeInfo}>
                {formatDistance(route.data.distance_m)} · {formatDuration(route.data.duration_s, t)}
              </Text>
            ) : route.error ? (
              <Text style={styles.routeHint}>{t('spot.directionsUnavailable')}</Text>
            ) : null}

            {spot.operator && (
              <Text style={styles.meta}>{t('spot.operator', { name: spot.operator })}</Text>
            )}
            {spot.capacity != null && (
              <Text style={styles.meta}>{t('spot.capacity', { count: spot.capacity })}</Text>
            )}
            {spot.access === 'permit' && (
              <Text style={styles.permit}>{t('spot.permitRequired')}</Text>
            )}
            {spot.access === 'paid' && <PaymentLinks />}

            {appleMapsAvailable && (
              <Pressable style={styles.mapsButton} onPress={openInAppleMaps}>
                <Text style={styles.mapsButtonText}>
                  {Platform.OS === 'ios' ? t('spot.openInAppleMaps') : t('spot.openInMaps')}
                </Text>
              </Pressable>
            )}
            {googleMapsAvailable && (
              <Pressable style={styles.mapsButton} onPress={openInGoogleMaps}>
                <Text style={styles.mapsButtonText}>{t('spot.openInGoogleMaps')}</Text>
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
