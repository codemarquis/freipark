import { renderHook, waitFor, act } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/features/auth/useAuth';

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
    },
  },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockSignInWithPassword = supabase.auth.signInWithPassword as jest.Mock;
const mockSignOut = supabase.auth.signOut as jest.Mock;
const mockSignInWithOtp = supabase.auth.signInWithOtp as jest.Mock;
const mockVerifyOtp = supabase.auth.verifyOtp as jest.Mock;

const SESSION = {
  user: { id: '1', email: 'a@b.com' },
  access_token: 'test-access-token',
} as unknown as Session;
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
});

describe('useAuth', () => {
  it('starts with loading=true and no session', async () => {
    mockGetSession.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = await renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('resolves loading=false with no session when signed out', async () => {
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('resolves with the session and user when already signed in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION } });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBe(SESSION);
    expect(result.current.user).toBe(SESSION.user);
  });

  it('updates state when onAuthStateChange fires', async () => {
    let callback: (event: string, session: Session | null) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb) => {
      callback = cb;
      return { data: { subscription: { unsubscribe } } };
    });

    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      callback('SIGNED_IN', SESSION);
    });

    await waitFor(() => expect(result.current.session).toBe(SESSION));
    expect(result.current.user).toBe(SESSION.user);
  });

  it('unsubscribes from onAuthStateChange on unmount', async () => {
    const { result, unmount } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('signUp calls supabase.auth.signUp and returns no error on success', async () => {
    mockSignUp.mockResolvedValue({ data: {}, error: null });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signUp('a@b.com', 'password123');

    expect(mockSignUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'password123' });
    expect(outcome).toEqual({ error: null, code: null });
  });

  it('signUp surfaces the Supabase error message on failure', async () => {
    mockSignUp.mockResolvedValue({ data: {}, error: { message: 'User already registered' } });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signUp('a@b.com', 'password123');

    expect(outcome).toEqual({ error: 'User already registered', code: null });
  });

  it('signUp surfaces the error code so callers can distinguish duplicate-account signups', async () => {
    mockSignUp.mockResolvedValue({
      data: {},
      error: { message: 'User already registered', code: 'user_already_exists' },
    });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signUp('a@b.com', 'password123');

    expect(outcome).toEqual({ error: 'User already registered', code: 'user_already_exists' });
  });

  it('signIn calls supabase.auth.signInWithPassword and returns no error on success', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signIn('a@b.com', 'password123');

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'password123',
    });
    expect(outcome).toEqual({ error: null, code: null });
  });

  it('signIn surfaces the Supabase error message on failure', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signIn('a@b.com', 'wrong');

    expect(outcome).toEqual({ error: 'Invalid login credentials', code: null });
  });

  it('signOut calls supabase.auth.signOut and returns no error on success', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signOut();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ error: null, code: null });
  });

  it('signInWithOtp calls supabase.auth.signInWithOtp and returns no error on success', async () => {
    mockSignInWithOtp.mockResolvedValue({ data: {}, error: null });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signInWithOtp('+491701234567');

    expect(mockSignInWithOtp).toHaveBeenCalledWith({ phone: '+491701234567' });
    expect(outcome).toEqual({ error: null, code: null });
  });

  it('signInWithOtp surfaces the Supabase error message on failure', async () => {
    mockSignInWithOtp.mockResolvedValue({
      data: {},
      error: { message: 'Invalid phone number', code: 'validation_failed' },
    });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.signInWithOtp('not-a-phone');

    expect(outcome).toEqual({ error: 'Invalid phone number', code: 'validation_failed' });
  });

  it('verifyOtp calls supabase.auth.verifyOtp with type sms and returns no error on success', async () => {
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.verifyOtp('+491701234567', '123456');

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      phone: '+491701234567',
      token: '123456',
      type: 'sms',
    });
    expect(outcome).toEqual({ error: null, code: null });
  });

  it('verifyOtp surfaces the Supabase error message on failure', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {},
      error: { message: 'Token has expired or is invalid', code: 'otp_expired' },
    });
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.verifyOtp('+491701234567', '000000');

    expect(outcome).toEqual({ error: 'Token has expired or is invalid', code: 'otp_expired' });
  });

  describe('deleteAccount', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns an error without calling fetch when not signed in', async () => {
      globalThis.fetch = jest.fn();
      const { result } = await renderHook(() => useAuth());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.deleteAccount();

      expect(outcome).toEqual({ error: 'Not signed in', code: null });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('calls DELETE /account with the access token and signs out locally on success', async () => {
      mockGetSession.mockResolvedValue({ data: { session: SESSION } });
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
      mockSignOut.mockResolvedValue({ error: null });

      const { result } = await renderHook(() => useAuth());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.deleteAccount();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/account'),
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer test-access-token' },
        }),
      );
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ error: null, code: null });
    });

    it('surfaces an error and does not sign out locally when the backend request fails', async () => {
      mockGetSession.mockResolvedValue({ data: { session: SESSION } });
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

      const { result } = await renderHook(() => useAuth());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.deleteAccount();

      expect(outcome).toEqual({ error: 'Failed to delete account', code: null });
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('surfaces an error when the network request itself throws', async () => {
      mockGetSession.mockResolvedValue({ data: { session: SESSION } });
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      const { result } = await renderHook(() => useAuth());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.deleteAccount();

      expect(outcome).toEqual({ error: 'Failed to delete account', code: null });
    });
  });
});
