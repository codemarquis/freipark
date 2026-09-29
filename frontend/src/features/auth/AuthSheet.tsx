import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { posthog } from '../../lib/posthog';
import { SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../../i18n';
import { useAuth } from './useAuth';

const LANGUAGE_LABEL: Record<SupportedLanguage, string> = {
  de: 'DE',
  en: 'EN',
  tr: 'TR',
};

const SNAP_POINTS = ['45%'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

type Mode = 'signin' | 'signup';
type Method = 'email' | 'phone';

interface AuthSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function AuthSheet({ visible, onClose }: AuthSheetProps) {
  const { t, i18n } = useTranslation();
  const sheetRef = useRef<BottomSheetMethods>(null);
  const { session, user, signUp, signIn, signOut, signInWithOtp, verifyOtp, deleteAccount } =
    useAuth();
  const [method, setMethod] = useState<Method>('email');
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  function resetForm() {
    setEmail('');
    setPassword('');
    setPhone('');
    setOtp('');
    setOtpSent(false);
    setError(null);
    setInfo(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  function switchMethod(next: Method) {
    setMethod(next);
    setPhone('');
    setOtp('');
    setOtpSent(false);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit() {
    setError(null);
    setInfo(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError(t('auth.errorInvalidEmail'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.errorPasswordTooShort'));
      return;
    }

    setSubmitting(true);
    const result =
      mode === 'signup' ? await signUp(email.trim(), password) : await signIn(email.trim(), password);
    setSubmitting(false);

    if (result.error) {
      // Sign-up must never reveal whether the email is already registered —
      // that's a user-enumeration vector. Show the same generic message a
      // genuine new signup gets instead of Supabase's "already registered".
      if (mode === 'signup' && (result.code === 'user_already_exists' || result.code === 'email_exists')) {
        setInfo(t('auth.infoCheckEmail'));
        return;
      }
      setError(result.error);
      return;
    }

    if (mode === 'signup' && !session) {
      // Email confirmation required — no session yet.
      setInfo(t('auth.infoCheckEmail'));
      return;
    }

    posthog?.capture('authentication_completed', {
      authentication_method: 'email',
      authentication_mode: mode,
    });
    resetForm();
    onClose();
  }

  async function handleSignOut() {
    setSubmitting(true);
    const result = await signOut();
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    resetForm();
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
            resetForm();
            onClose();
          },
        },
      ],
    );
  }

  async function handleSendCode() {
    setError(null);
    setInfo(null);

    if (!PHONE_RE.test(phone.trim())) {
      setError(t('auth.errorInvalidPhone'));
      return;
    }

    setSubmitting(true);
    // signInWithOtp both signs in an existing phone number and signs up a new
    // one — Supabase treats phone OTP as a single unified passwordless flow,
    // so there's no separate sign-in/sign-up distinction to make here (and
    // no "already registered" leak to guard against, unlike email sign-up).
    const result = await signInWithOtp(phone.trim());
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    posthog?.capture('phone_otp_requested');
    setOtpSent(true);
    setInfo(t('auth.infoCodeSent', { phone: phone.trim() }));
  }

  async function handleVerifyCode() {
    setError(null);

    if (otp.trim().length < 4) {
      setError(t('auth.errorInvalidCode'));
      return;
    }

    setSubmitting(true);
    const result = await verifyOtp(phone.trim(), otp.trim());
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    posthog?.capture('authentication_completed', {
      authentication_method: 'phone_otp',
    });
    resetForm();
    onClose();
  }

  function handleChangeNumber() {
    setOtpSent(false);
    setOtp('');
    setError(null);
    setInfo(null);
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
        <View style={styles.languageRow}>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <Pressable
              key={lang}
              onPress={() => setLanguage(lang)}
              style={[styles.languagePill, i18n.language === lang && styles.languagePillActive]}
            >
              <Text
                style={[
                  styles.languagePillText,
                  i18n.language === lang && styles.languagePillTextActive,
                ]}
              >
                {LANGUAGE_LABEL[lang]}
              </Text>
            </Pressable>
          ))}
        </View>

        {user ? (
          <>
            <Text style={styles.title}>{t('account.signedIn')}</Text>
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
          <>
            <View style={styles.tabs}>
              <Pressable
                style={[styles.tab, method === 'email' && styles.tabActive]}
                onPress={() => switchMethod('email')}
              >
                <Text style={[styles.tabText, method === 'email' && styles.tabTextActive]}>
                  {t('auth.tabEmail')}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, method === 'phone' && styles.tabActive]}
                onPress={() => switchMethod('phone')}
              >
                <Text style={[styles.tabText, method === 'phone' && styles.tabTextActive]}>
                  {t('auth.tabPhone')}
                </Text>
              </Pressable>
            </View>

            {method === 'email' ? (
              <>
                <View style={styles.tabs}>
                  <Pressable
                    style={[styles.tab, mode === 'signin' && styles.tabActive]}
                    onPress={() => switchMode('signin')}
                  >
                    <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>
                      {t('auth.tabSignIn')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.tab, mode === 'signup' && styles.tabActive]}
                    onPress={() => switchMode('signup')}
                  >
                    <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>
                      {t('auth.tabSignUp')}
                    </Text>
                  </Pressable>
                </View>

                <TextInput
                  style={styles.input}
                  placeholder={t('auth.emailPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.passwordPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                />

                {error && <Text style={styles.error}>{error}</Text>}
                {info && <Text style={styles.info}>{info}</Text>}

                <Pressable style={styles.button} onPress={handleSubmit} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>{t('auth.continue')}</Text>
                  )}
                </Pressable>
              </>
            ) : !otpSent ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.phonePlaceholder')}
                  placeholderTextColor="#94a3b8"
                  value={phone}
                  onChangeText={setPhone}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                />

                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable style={styles.button} onPress={handleSendCode} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>{t('auth.sendCode')}</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                {info && <Text style={styles.info}>{info}</Text>}

                <TextInput
                  style={styles.input}
                  placeholder={t('auth.verificationCodePlaceholder')}
                  placeholderTextColor="#94a3b8"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                />

                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable style={styles.button} onPress={handleVerifyCode} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>{t('auth.verify')}</Text>
                  )}
                </Pressable>
                <Pressable onPress={handleChangeNumber} disabled={submitting}>
                  <Text style={styles.link}>{t('auth.useDifferentNumber')}</Text>
                </Pressable>
                <Pressable onPress={handleSendCode} disabled={submitting}>
                  <Text style={styles.link}>{t('auth.resendCode')}</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
    marginBottom: 14,
  },
  languagePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  languagePillActive: {
    backgroundColor: '#6366f1',
  },
  languagePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  languagePillTextActive: {
    color: '#fff',
  },
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
    marginBottom: 4,
  },
  email: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 16,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#1e293b',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 10,
  },
  error: {
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 10,
  },
  info: {
    fontSize: 13,
    color: '#0369a1',
    marginBottom: 10,
  },
  link: {
    fontSize: 13,
    color: '#6366f1',
    textAlign: 'center',
    marginTop: 10,
  },
  dangerLink: {
    fontSize: 13,
    color: '#dc2626',
    textAlign: 'center',
    marginTop: 14,
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
});
