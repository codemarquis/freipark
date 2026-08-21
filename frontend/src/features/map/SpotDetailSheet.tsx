import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { PaymentLinks } from './PaymentLinks';
import type { SpotRow } from '../../lib/types';

const SNAP_POINTS = ['35%', '55%'];

const ACCESS_LABEL: Record<NonNullable<SpotRow['access']>, string> = {
  free: 'Free parking',
  paid: 'Paid parking',
  permit: 'Permit required',
  private: 'Private',
};

const TYPE_LABEL: Record<SpotRow['spot_type'], string> = {
  street: 'Street parking',
  garage: 'Parking garage',
  lot: 'Parking lot',
  zone: 'Parking zone',
};

interface SpotDetailSheetProps {
  spot: SpotRow | null;
  onClose: () => void;
}

export function SpotDetailSheet({ spot, onClose }: SpotDetailSheetProps) {
  const sheetRef = useRef<BottomSheetMethods>(null);

  useEffect(() => {
    if (spot) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [spot]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onClose={onClose}
      style={styles.sheet}
    >
      <BottomSheetView style={styles.content}>
        {spot && (
          <>
            <Text style={styles.type}>{TYPE_LABEL[spot.spot_type]}</Text>
            <Text style={styles.access}>
              {spot.access ? ACCESS_LABEL[spot.access] : 'Access unknown'}
            </Text>
            {spot.operator && (
              <Text style={styles.meta}>Operator: {spot.operator}</Text>
            )}
            {spot.capacity != null && (
              <Text style={styles.meta}>Capacity: {spot.capacity}</Text>
            )}
            {spot.access === 'permit' && (
              <Text style={styles.permit}>
                A valid parking permit is required for this spot.
              </Text>
            )}
            {spot.access === 'paid' && <PaymentLinks />}
          </>
        )}
      </BottomSheetView>
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
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
});
