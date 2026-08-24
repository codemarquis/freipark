import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

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
    } = supabase.auth.onAuthStateChange((_event, session) => {
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

  return { ...state, signUp, signIn, signOut, signInWithOtp, verifyOtp };
}
