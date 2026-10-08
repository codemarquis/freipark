import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { posthog } from '../../lib/posthog';
import { supabase } from '../../lib/supabase';

// useAuth is used by more than one component, so authentication observers can
// receive the same transition more than once. Keep identity transitions global
// to ensure one identify/reset per actual authentication change.
let identifiedUserId: string | null = null;
let signedOut = false;

function identifyUser(user: User) {
  if (identifiedUserId === user.id) {
    return;
  }

  // Account ID only — never the email (SPEC-analytics-consent.md).
  posthog?.identify(user.id);
  identifiedUserId = user.id;
  signedOut = false;
}

function resetIdentity() {
  if (signedOut) {
    return;
  }

  posthog?.reset();
  identifiedUserId = null;
  signedOut = true;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

interface AuthResult {
  error: string | null;
  code: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ session, user: session?.user ?? null, loading: false });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        identifyUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        resetIdentity();
      }

      setState({ session, user: session?.user ?? null, loading: false });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function signUp(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null, code: error?.code ?? null };
  }

  async function signIn(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null, code: error?.code ?? null };
  }

  async function signOut(): Promise<AuthResult> {
    posthog?.capture('account_sign_out_requested');
    const { error } = await supabase.auth.signOut();
    return { error: error?.message ?? null, code: error?.code ?? null };
  }

  async function signInWithOtp(phone: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    return { error: error?.message ?? null, code: error?.code ?? null };
  }

  async function verifyOtp(phone: string, token: string): Promise<AuthResult> {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    return { error: error?.message ?? null, code: error?.code ?? null };
  }

  async function deleteAccount(): Promise<AuthResult> {
    const accessToken = state.session?.access_token;
    if (!accessToken) {
      return { error: 'Not signed in', code: null };
    }

    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
    try {
      const response = await fetch(`${apiUrl}/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        return { error: 'Failed to delete account', code: null };
      }
    } catch {
      return { error: 'Failed to delete account', code: null };
    }

    posthog?.capture('account_deleted');

    // The backend deleted the account server-side; clear the local session
    // too so the app doesn't keep treating this device as signed in.
    await supabase.auth.signOut();
    return { error: null, code: null };
  }

  return { ...state, signUp, signIn, signOut, signInWithOtp, verifyOtp, deleteAccount };
}
