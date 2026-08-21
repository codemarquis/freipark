import { useCallback, useRef } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import {
  GeoJSONSource,
  Layer,
} from '@maplibre/maplibre-react-native';
import type {
  CameraRef,
  GeoJSONSourceRef,
  PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import type { SpotsGeoJSON } from '../../lib/geo';
import type { SpotRow } from '../../lib/types';

interface SpotLayerProps {
  geojson: SpotsGeoJSON;
  onSpotPress: (spot: SpotRow) => void;
  cameraRef: React.RefObject<CameraRef | null>;
}

export function SpotLayer({ geojson, onSpotPress, cameraRef }: SpotLayerProps) {
  const sourceRef = useRef<GeoJSONSourceRef>(null);

  const handlePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = event.nativeEvent.features?.[0];
      if (!feature) return;

      if (feature.properties?.cluster === true) {
        const clusterId = feature.properties.cluster_id as number;
        const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates;
        sourceRef.current
          ?.getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            cameraRef.current?.flyTo({ center: [lon, lat], zoom, duration: 300 });
          });
      } else {
        onSpotPress(feature.properties as SpotRow);
      }
    },
    [cameraRef, onSpotPress],
  );

  return (
    <GeoJSONSource
      id="spots"
      data={geojson}
      cluster
      clusterRadius={50}
      ref={sourceRef}
      onPress={handlePress}
    >
      <Layer
        id="spots-clusters"
        type="circle"
        filter={['has', 'point_count']}
        paint={{
          'circle-color': '#3b82f6',
          'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 50, 25],
          'circle-opacity': 0.85,
        }}
      />
      <Layer
        id="spots-cluster-count"
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        }}
        paint={{ 'text-color': '#ffffff' }}
      />
      <Layer
        id="spots-unclustered"
        type="circle"
        filter={['!', ['has', 'point_count']]}
        paint={{
          'circle-color': [
            'match',
            ['get', 'access'],
            'free', '#22c55e',
            'paid', '#3b82f6',
            'permit', '#f59e0b',
            'private', '#ef4444',
            '#94a3b8',
          ],
          'circle-radius': 6,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        }}
      />
    </GeoJSONSource>
  );
}
