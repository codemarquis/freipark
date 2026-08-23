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
    },
  },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockSignInWithPassword = supabase.auth.signInWithPassword as jest.Mock;
const mockSignOut = supabase.auth.signOut as jest.Mock;

const SESSION = { user: { id: '1', email: 'a@b.com' } } as unknown as Session;
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
});
