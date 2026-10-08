import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { posthog } from '../../lib/posthog';

// The user's answer to "Help improve FreiPark" (SPEC-analytics-consent.md).
// Nothing is sent to Sentry or PostHog until this says so.
export interface Consent {
  crashReports: boolean;
  analytics: boolean;
  decidedAt: string; // ISO 8601
}

export type ConsentChoice = Pick<Consent, 'crashReports' | 'analytics'>;

export const CONSENT_STORAGE_KEY = 'freipark.consent.v1';

const SENTRY_DSN =
  'https://999e2b6768ad5b3be729a761db326b43@o4512169783656448.ingest.de.sentry.io/4512169821732944';

/** The stored choice, or null if the user hasn't chosen yet (or it's unreadable). */
export async function loadConsent(): Promise<Consent | null> {
  try {
    const raw = await AsyncStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.crashReports !== 'boolean' || typeof v.analytics !== 'boolean' || typeof v.decidedAt !== 'string') {
      return null;
    }
    return { crashReports: v.crashReports, analytics: v.analytics, decidedAt: v.decidedAt };
  } catch {
    return null;
  }
}

let sentryStarted = false;

/** Start or stop the SDKs to match the choice. Safe to call repeatedly. */
export async function applyConsent(choice: ConsentChoice): Promise<void> {
  if (choice.crashReports && !sentryStarted) {
    Sentry.init({
      dsn: SENTRY_DSN,
      // No IP address or user data, no session replay (it would record the
      // map with the user's location), no feedback widget.
      sendDefaultPii: false,
      beforeBreadcrumb: (breadcrumb) => (breadcrumb.category === 'console' ? null : breadcrumb),
    });
    sentryStarted = true;
  } else if (!choice.crashReports && sentryStarted) {
    await Sentry.close();
    sentryStarted = false;
  }

  if (choice.analytics) {
    await posthog?.optIn();
  } else {
    await posthog?.optOut();
  }
}

/** Store a new choice and apply it straight away. */
export async function saveConsent(choice: ConsentChoice): Promise<Consent> {
  const consent: Consent = { ...choice, decidedAt: new Date().toISOString() };
  await AsyncStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  await applyConsent(consent);
  return consent;
}

/** Test-only: forget whether Sentry was started. */
export function resetConsentStateForTests(): void {
  sentryStarted = false;
}
