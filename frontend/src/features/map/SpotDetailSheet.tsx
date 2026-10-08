import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { posthog } from '../../lib/posthog';
import { PaymentLinks } from './PaymentLinks';
import { buildShareMessage } from './shareSpot';
import { formatAddress, formatCoords } from './spotAddress';
import { useSpotDetails } from './useSpotDetails';
import { ReportButtons } from '../reports/ReportButtons';
import { RuleLine } from '../rules/RuleLine';
import { activeReport } from '../reports/reportStatus';
import type { SubmittedReport } from '../reports/useReportSpot';
import type { RouteState } from './useRoute';
import type { SpotRow } from '../../lib/types';

// 55% shows the type, status, address, route and report buttons with the
// map still visible; drag up (or scroll) for share and the maps buttons.
export const SNAP_POINTS = ['55%', '90%'];

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
  onReported: (report: SubmittedReport) => void;
  onSignInRequired: () => void;
}

const MINUTE_MS = 60_000;

export function SpotDetailSheet({
  spot,
  onClose,
  route,
  locationDenied,
  onReported,
  onSignInRequired,
}: SpotDetailSheetProps) {
  const { t } = useTranslation();
  const sheetRef = useRef<BottomSheetMethods>(null);
  const [appleMapsAvailable, setAppleMapsAvailable] = useState(false);
  const [googleMapsAvailable, setGoogleMapsAvailable] = useState(false);
  // The user's own report, shown straight away. `spot` is the row captured
  // when the marker was tapped, so it won't reflect a report made since.
  const [justReported, setJustReported] = useState<SubmittedReport | null>(null);
  // Ticks once a minute so "N min ago" stays current and expired reports
  // disappear while the sheet is open.
  const [now, setNow] = useState(() => Date.now());
  const details = useSpotDetails(spot?.id ?? null);
  const addressText = details ? formatAddress(details, t) : null;

  useEffect(() => {
    if (!spot) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, [spot]);

  const report = activeReport(
    justReported && justReported.spotId === spot?.id
      ? { report_status: justReported.status, report_at: justReported.reportedAt }
      : (spot ?? {}),
    now,
  );

  const statusText = report
    ? report.minutesAgo < 1
      ? t(report.status === 'free' ? 'report.statusFreeNow' : 'report.statusFullNow')
      : t(report.status === 'free' ? 'report.statusFree' : 'report.statusFull', {
          minutes: report.minutesAgo,
        })
    : null;

  async function shareSpot() {
    if (!spot) return;
    try {
      const result = await Share.share({
        message: buildShareMessage({
          typeLabel: t(TYPE_LABEL_KEY[spot.spot_type]),
          accessLabel: spot.access ? t(ACCESS_LABEL_KEY[spot.access]) : t('spot.accessUnknown'),
          statusLine: statusText,
          addressLine: addressText,
          lat: spot.lat,
          lon: spot.lon,
        }),
      });
      posthog?.capture('spot_shared', {
        parking_spot_type: spot.spot_type,
        parking_access: spot.access ?? 'unknown',
        completed: result.action === Share.sharedAction,
      });
    } catch {
      // No share targets / sheet failed to open: nothing useful to show.
    }
  }

  function handleReported(submitted: SubmittedReport) {
    setJustReported(submitted);
    setNow(Date.now());
    onReported(submitted);
  }

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
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClose}
      style={styles.sheet}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {spot && (
          <>
            <Text style={styles.type}>{t(TYPE_LABEL_KEY[spot.spot_type])}</Text>
            <Text style={styles.access}>
              {spot.access ? t(ACCESS_LABEL_KEY[spot.access]) : t('spot.accessUnknown')}
            </Text>
            <RuleLine ruleTags={details?.rule_tags ?? null} />
            {report && (
              <Text
                style={[styles.report, report.status === 'free' ? styles.reportFree : styles.reportFull]}
              >
                {statusText}
              </Text>
            )}
            {addressText && <Text style={styles.address}>{addressText}</Text>}
            <Text style={styles.coords} selectable>
              {formatCoords(spot.lat, spot.lon)}
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

            <ReportButtons
              spot={spot}
              locationDenied={locationDenied}
              onReported={handleReported}
              onSignInRequired={onSignInRequired}
            />

            <Pressable
              style={styles.mapsButton}
              onPress={shareSpot}
              accessibilityRole="button"
              accessibilityLabel={t('spot.shareA11y')}
            >
              <Text style={styles.mapsButtonText}>{t('spot.share')}</Text>
            </Pressable>
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
      </BottomSheetScrollView>
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
  // No flex: 1 — the scroll view's content must be free to grow past the sheet.
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40, // clear of the home indicator
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
  address: {
    fontSize: 14,
    color: '#334155',
    marginTop: -6,
    marginBottom: 2,
  },
  coords: {
    fontSize: 12,
    color: '#94a3b8',
    fontVariant: ['tabular-nums'],
    marginBottom: 10,
  },
  // Same teal / near-black as the marker ring and the report buttons.
  report: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: -6,
    marginBottom: 12,
  },
  reportFree: {
    color: '#0f766e',
  },
  reportFull: {
    color: '#111827',
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
