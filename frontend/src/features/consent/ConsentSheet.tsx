import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { loadConsent, saveConsent } from './consent';

export const PRIVACY_POLICY_URL = 'https://freipark.com/privacy';

const SNAP_POINTS = ['42%'];

/**
 * First-launch question: may we send crash reports and usage statistics?
 * Shown only while no choice is stored (SPEC-analytics-consent.md). Closing
 * it without choosing stores nothing, so it asks again next launch.
 */
export function ConsentSheet() {
  const { t } = useTranslation();
  const sheetRef = useRef<BottomSheetMethods>(null);
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadConsent().then((consent) => {
      if (!cancelled && consent === null) setNeeded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(allow: boolean) {
    await saveConsent({ crashReports: allow, analytics: allow });
    setNeeded(false);
  }

  if (!needed) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onClose={() => setNeeded(false)}
      style={styles.sheet}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{t('consent.title')}</Text>
        <Text style={styles.body}>{t('consent.body')}</Text>
        <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} accessibilityRole="link">
          <Text style={styles.link}>{t('consent.privacyLink')}</Text>
        </Pressable>
        <View style={styles.buttons}>
          <Pressable style={styles.button} onPress={() => choose(false)} accessibilityRole="button">
            <Text style={styles.buttonText}>{t('consent.deny')}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => choose(true)} accessibilityRole="button">
            <Text style={styles.buttonText}>{t('consent.allow')}</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

// Same look as SettingsSheet; both buttons identical on purpose (no nudging).
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    color: '#475569',
  },
  link: {
    fontSize: 14,
    color: '#6366f1',
    marginTop: 8,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
