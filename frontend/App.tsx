import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MapScreen } from './src/features/map/MapScreen';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MapScreen />
    </GestureHandlerRootView>
  );
}
