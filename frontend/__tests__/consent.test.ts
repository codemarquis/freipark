import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import {
  CONSENT_STORAGE_KEY,
  applyConsent,
  loadConsent,
  resetConsentStateForTests,
  saveConsent,
} from '../src/features/consent/consent';

jest.mock('@sentry/react-native', () => ({ init: jest.fn(), close: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/lib/posthog', () => ({
  posthog: { optIn: jest.fn(() => Promise.resolve()), optOut: jest.fn(() => Promise.resolve()) },
}));

const mockPosthog = jest.requireMock<{ posthog: { optIn: jest.Mock; optOut: jest.Mock } }>(
  '../src/lib/posthog',
).posthog;

beforeEach(async () => {
  jest.clearAllMocks();
  resetConsentStateForTests();
  await AsyncStorage.clear();
});

describe('loadConsent', () => {
  it('is null before the user has chosen', async () => {
    expect(await loadConsent()).toBeNull();
  });

  it('is null for an unreadable value', async () => {
    await AsyncStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(await loadConsent()).toBeNull();
    await AsyncStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ crashReports: 'yes', analytics: true }));
    expect(await loadConsent()).toBeNull();
  });

  it('returns what saveConsent stored', async () => {
    const saved = await saveConsent({ crashReports: true, analytics: false });
    expect(await loadConsent()).toEqual(saved);
    expect(saved.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('applyConsent', () => {
  it('sends nothing when both are off', async () => {
    await applyConsent({ crashReports: false, analytics: false });
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(mockPosthog.optOut).toHaveBeenCalled();
    expect(mockPosthog.optIn).not.toHaveBeenCalled();
  });

  it('starts Sentry once, without personal data or replay', async () => {
    await applyConsent({ crashReports: true, analytics: false });
    await applyConsent({ crashReports: true, analytics: false });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(options.sendDefaultPii).toBe(false);
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
    expect(options.integrations).toBeUndefined();
  });

  it('stops Sentry when crash reports are turned off', async () => {
    await applyConsent({ crashReports: true, analytics: false });
    await applyConsent({ crashReports: false, analytics: false });
    expect(Sentry.close).toHaveBeenCalledTimes(1);
  });

  it('opts PostHog in only for usage statistics', async () => {
    await applyConsent({ crashReports: false, analytics: true });
    expect(mockPosthog.optIn).toHaveBeenCalled();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('drops console breadcrumbs', async () => {
    await applyConsent({ crashReports: true, analytics: false });
    const { beforeBreadcrumb } = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(beforeBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
    expect(beforeBreadcrumb({ category: 'navigation' })).toEqual({ category: 'navigation' });
  });
});
