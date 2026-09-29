import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostHogProvider } from 'posthog-react-native';
import { MapScreen } from './src/features/map/MapScreen';
import { posthog } from './src/lib/posthog';
import * as Sentry from '@sentry/react-native';
import './src/i18n';

Sentry.init({
  dsn: 'https://999e2b6768ad5b3be729a761db326b43@o4512169783656448.ingest.de.sentry.io/4512169821732944',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
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
