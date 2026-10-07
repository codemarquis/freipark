import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SpotRow } from '../../lib/types';
import type { ReportErrorCode, ReportStatus } from './reportStatus';
import { useReportSpot } from './useReportSpot';
import type { SubmittedReport } from './useReportSpot';

// not_authenticated has no message: it opens the sign-in sheet instead.
const ERROR_KEY: Record<Exclude<ReportErrorCode, 'not_authenticated'>, string> = {
  too_far: 'report.errorTooFar',
  rate_limited_spot: 'report.errorRateLimitedSpot',
  rate_limited_hourly: 'report.errorRateLimitedHourly',
  location_unavailable: 'report.errorLocationUnavailable',
  unknown: 'report.errorUnknown',
};

interface ReportButtonsProps {
  spot: SpotRow;
  locationDenied: boolean;
  onReported: (report: SubmittedReport) => void;
  /** The sign-in sheet lives at screen level (a bottom sheet nested inside
   *  SpotDetailSheet would be confined to it), so ask the parent to open it. */
  onSignInRequired: () => void;
}

export function ReportButtons({
  spot,
  locationDenied,
  onReported,
  onSignInRequired,
}: ReportButtonsProps) {
  const { t } = useTranslation();
  const { submit, submitting, error } = useReportSpot();
  const disabled = locationDenied || submitting;

  async function report(status: ReportStatus) {
    const outcome = await submit(spot, status);
    if (outcome.ok) {
      onReported(outcome.report);
    } else if (outcome.error === 'not_authenticated') {
      onSignInRequired();
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.prompt}>{t('report.prompt')}</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.button, styles.free, disabled && styles.disabled]}
          onPress={() => report('free')}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('report.freeA11y')}
        >
          <Text style={styles.buttonText}>{t('report.free')}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.full, disabled && styles.disabled]}
          onPress={() => report('full')}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('report.fullA11y')}
        >
          <Text style={styles.buttonText}>{t('report.full')}</Text>
        </Pressable>
        {submitting && (
          <ActivityIndicator testID="report-submitting" size="small" color="#64748b" />
        )}
      </View>
      {locationDenied ? (
        <Text style={styles.hint}>{t('report.locationNeeded')}</Text>
      ) : error && error !== 'not_authenticated' ? (
        <Text testID="report-error" style={styles.error}>
          {t(ERROR_KEY[error])}
        </Text>
      ) : null}
    </View>
  );
}

// Button colours echo the marker ring colours (SpotLayer).
const styles = StyleSheet.create({
  container: {
    marginTop: 12,
  },
  prompt: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  free: {
    backgroundColor: '#14b8a6',
  },
  full: {
    backgroundColor: '#111827',
  },
  disabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748b',
  },
  error: {
    marginTop: 6,
    fontSize: 12,
    color: '#b91c1c',
  },
});
