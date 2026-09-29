import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MapScreen } from './src/features/map/MapScreen';
import * as Sentry from '@sentry/react-native';

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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MapScreen />
    </GestureHandlerRootView>
  );
});
