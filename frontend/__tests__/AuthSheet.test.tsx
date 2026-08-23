import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { AuthSheet } from '../src/features/auth/AuthSheet';
import { useAuth } from '../src/features/auth/useAuth';

// Use require() inside the factory — jest.mock cannot reference out-of-scope imports.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(({ children }: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        snapToIndex: jest.fn(),
        close: jest.fn(),
      }));
      return React.createElement(View, null, children);
    }),
    BottomSheetView: ({ children }: any) =>
      React.createElement(View, null, children),
  };
});

jest.mock('../src/features/auth/useAuth', () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;

const signUp = jest.fn();
const signIn = jest.fn();
const signOut = jest.fn();
const onClose = jest.fn();

function mockSignedOut() {
  mockUseAuth.mockReturnValue({
    session: null,
    user: null,
    loading: false,
    signUp,
    signIn,
    signOut,
  });
}

function mockSignedIn(email = 'a@b.com') {
  mockUseAuth.mockReturnValue({
    session: { user: { email } },
    user: { email },
    loading: false,
    signUp,
    signIn,
    signOut,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignedOut();
});

async function fillAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
  await fireEvent.press(screen.getByText('Continue'));
}

describe('signed out', () => {
  it('defaults to the Sign In tab and calls signIn on submit', async () => {
    signIn.mockResolvedValue({ error: null });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fillAndSubmit('a@b.com', 'password123');

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.com', 'password123'));
    expect(signUp).not.toHaveBeenCalled();
  });

  it('switches to Sign Up and calls signUp on submit', async () => {
    signUp.mockResolvedValue({ error: null });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fireEvent.press(screen.getByText('Sign Up'));
    await fillAndSubmit('a@b.com', 'password123');

    await waitFor(() => expect(signUp).toHaveBeenCalledWith('a@b.com', 'password123'));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('rejects a malformed email without calling Supabase', async () => {
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fillAndSubmit('not-an-email', 'password123');

    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('rejects a too-short password without calling Supabase', async () => {
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fillAndSubmit('a@b.com', 'short');

    expect(screen.getByText('Password must be at least 6 characters.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows the server error inline on a failed sign-in', async () => {
    signIn.mockResolvedValue({ error: 'Invalid login credentials' });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fillAndSubmit('a@b.com', 'password123');

    await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the sheet on successful sign-in', async () => {
    signIn.mockResolvedValue({ error: null });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fillAndSubmit('a@b.com', 'password123');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a confirmation hint instead of closing when sign-up returns no session', async () => {
    signUp.mockResolvedValue({ error: null });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fireEvent.press(screen.getByText('Sign Up'));
    await fillAndSubmit('a@b.com', 'password123');

    await waitFor(() =>
      expect(screen.getByText('Check your email to confirm your account.')).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not reveal that an email is already registered (user enumeration)', async () => {
    signUp.mockResolvedValue({
      error: 'User already registered',
      code: 'user_already_exists',
    });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fireEvent.press(screen.getByText('Sign Up'));
    await fillAndSubmit('a@b.com', 'password123');

    await waitFor(() =>
      expect(screen.getByText('Check your email to confirm your account.')).toBeTruthy(),
    );
    expect(screen.queryByText('User already registered')).toBeNull();
    expect(screen.queryByText(/already registered/i)).toBeNull();
  });
});

describe('signed in', () => {
  it('shows the account email and a Sign Out button', async () => {
    mockSignedIn('me@example.com');
    await render(<AuthSheet visible={true} onClose={onClose} />);

    expect(screen.getByText('me@example.com')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
  });

  it('calls signOut and closes the sheet', async () => {
    mockSignedIn();
    signOut.mockResolvedValue({ error: null });
    await render(<AuthSheet visible={true} onClose={onClose} />);

    await fireEvent.press(screen.getByText('Sign Out'));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
