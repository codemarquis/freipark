import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostHogProvider } from 'posthog-react-native';
import { MapScreen } from './src/features/map/MapScreen';
import { posthog } from './src/lib/posthog';
import * as Sentry from '@sentry/react-native';
import './src/i18n';
import { applyConsent, loadConsent } from './src/features/consent/consent';

// Sentry and PostHog stay off until the user has allowed them
// (SPEC-analytics-consent.md); the consent sheet asks on first launch.
loadConsent().then((consent) => {
  if (consent) applyConsent(consent);
});

export default Sentry.wrap(function App() {
  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MapScreen />
    </GestureHandlerRootView>
  );

  return posthog ? (
    <PostHogProvider client={posthog}>{content}</PostHogProvider>
  ) : (
    content
  );
});
