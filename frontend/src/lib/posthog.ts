import PostHog from 'posthog-react-native';

// jest-expo runs with __DEV__ true but has no real native storage modules
// available for PostHog's client to initialize against — constructing a
// real client (or hitting the config-missing throw below) crashes every
// test that transitively imports this file. Tests don't need real
// analytics; every call site already uses posthog?. optional chaining.
const isTestEnv = process.env.JEST_WORKER_ID !== undefined;

const projectToken = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;

if (__DEV__ && !isTestEnv && !projectToken) {
  throw new Error(
    'EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN is configured',
  );
}

if (__DEV__ && !isTestEnv && !host) {
  throw new Error(
    'EXPO_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once EXPO_PUBLIC_POSTHOG_HOST is configured',
  );
}

export const posthog =
  !isTestEnv && projectToken && host
    ? new PostHog(projectToken, {
        host,
        // Opted out until the user allows usage statistics
        // (features/consent, SPEC-analytics-consent.md); no request before then.
        defaultOptIn: false,
        preloadFeatureFlags: false,
        logs: {
          serviceName: 'freipark-mobile',
          environment: __DEV__ ? 'development' : 'production',
        },
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
          },
        },
      })
    : undefined;
