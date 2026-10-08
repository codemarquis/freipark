import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../../i18n';
import { useAuth } from '../auth/useAuth';
import { loadConsent, saveConsent, type ConsentChoice } from '../consent/consent';

// SPEC-analytics-consent.md: both off until the user turns them on.
const CONSENT_ROWS: { key: keyof ConsentChoice; label: string }[] = [
  { key: 'crashReports', label: 'settings.crashReports' },
  { key: 'analytics', label: 'settings.analytics' },
];
const NO_CONSENT: ConsentChoice = { crashReports: false, analytics: false };

const LANGUAGE_LABEL: Record<SupportedLanguage, string> = {
  de: 'DE',
  en: 'EN',
  tr: 'TR',
};

const SNAP_POINTS = ['62%'];

interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Settings doesn't host the sign-in form: the parent closes this sheet
   *  and opens the shared sign-in sheet (SPEC-settings.md). */
  onSignInRequested: () => void;
}

export function SettingsSheet({ visible, onClose, onSignInRequested }: SettingsSheetProps) {
  const { t, i18n } = useTranslation();
  const sheetRef = useRef<BottomSheetMethods>(null);
  const { user, signOut, deleteAccount } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice>(NO_CONSENT);

  useEffect(() => {
    if (visible) {
      setError(null);
      sheetRef.current?.snapToIndex(0);
      loadConsent().then((consent) =>
        setChoice(consent ? { crashReports: consent.crashReports, analytics: consent.analytics } : NO_CONSENT),
      );
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  async function handleConsentChange(key: keyof ConsentChoice, value: boolean) {
    const next = { ...choice, [key]: value };
    setChoice(next);
    await saveConsent(next);
  }

  // Moved verbatim from AuthSheet: same calls, same error handling.
  async function handleSignOut() {
    setSubmitting(true);
    const result = await signOut();
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  async function handleDeleteAccount() {
    Alert.alert(
      t('account.deleteAccountConfirmTitle'),
      t('account.deleteAccountConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setError(null);
            setSubmitting(true);
            const result = await deleteAccount();
            setSubmitting(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            onClose();
          },
        },
      ],
    );
  }

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
        <Text style={styles.title}>{t('settings.title')}</Text>

        <Text style={styles.sectionLabel}>{t('settings.account')}</Text>
        {user ? (
          <>
            <Text style={styles.email}>{user.email}</Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable style={styles.button} onPress={handleSignOut} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('account.signOut')}</Text>
              )}
            </Pressable>
            <Pressable onPress={handleDeleteAccount} disabled={submitting}>
              <Text style={styles.dangerLink}>{t('account.deleteAccount')}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.button} onPress={onSignInRequested} accessibilityRole="button">
            <Text style={styles.buttonText}>{t('settings.signInOrCreate')}</Text>
          </Pressable>
        )}

        <Text style={[styles.sectionLabel, styles.sectionSpacing]}>{t('settings.language')}</Text>
        <View style={styles.languageRow}>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = i18n.language === lang;
            return (
              <Pressable
                key={lang}
                onPress={() => setLanguage(lang)}
                style={[styles.languagePill, active && styles.languagePillActive]}
                accessibilityRole="button"
                accessibilityLabel={LANGUAGE_LABEL[lang]}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.languagePillText, active && styles.languagePillTextActive]}>
                  {LANGUAGE_LABEL[lang]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, styles.sectionSpacing]}>{t('settings.privacy')}</Text>
        {CONSENT_ROWS.map(({ key, label }) => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t(label)}</Text>
            <Switch
              value={choice[key]}
              onValueChange={(value) => handleConsentChange(key, value)}
              accessibilityLabel={t(label)}
            />
          </View>
        ))}
      </BottomSheetView>
    </BottomSheet>
  );
}

// Same look as AuthSheet, so the two sheets read as one app.
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
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionSpacing: {
    marginTop: 22,
  },
  email: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 10,
  },
  button: {
    height: 46,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  dangerLink: {
    fontSize: 13,
    color: '#dc2626',
    textAlign: 'center',
    marginTop: 14,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  switchLabel: {
    fontSize: 15,
    color: '#1e293b',
  },
  languageRow: {
    flexDirection: 'row',
    gap: 8,
  },
  languagePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  languagePillActive: {
    backgroundColor: '#6366f1',
  },
  languagePillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  languagePillTextActive: {
    color: '#fff',
  },
});
