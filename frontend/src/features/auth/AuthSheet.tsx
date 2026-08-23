import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import { useAuth } from './useAuth';

const SNAP_POINTS = ['45%'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'signin' | 'signup';

interface AuthSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function AuthSheet({ visible, onClose }: AuthSheetProps) {
  const sheetRef = useRef<BottomSheetMethods>(null);
  const { session, user, signUp, signIn, signOut } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    setError(null);
    setInfo(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit() {
    setError(null);
    setInfo(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
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
        setInfo('Check your email to confirm your account.');
        return;
      }
      setError(result.error);
      return;
    }

    if (mode === 'signup' && !session) {
      // Email confirmation required — no session yet.
      setInfo('Check your email to confirm your account.');
      return;
    }

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
        {user ? (
          <>
            <Text style={styles.title}>Signed in</Text>
            <Text style={styles.email}>{user.email}</Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable style={styles.button} onPress={handleSignOut} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign Out</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.tabs}>
              <Pressable
                style={[styles.tab, mode === 'signin' && styles.tabActive]}
                onPress={() => switchMode('signin')}
              >
                <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>
                  Sign In
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, mode === 'signup' && styles.tabActive]}
                onPress={() => switchMode('signup')}
              >
                <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>
                  Sign Up
                </Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Email"
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
              placeholder="Password"
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
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </Pressable>
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
