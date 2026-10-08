import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '../src/i18n';
import { SettingsSheet } from '../src/features/settings/SettingsSheet';
import { useAuth } from '../src/features/auth/useAuth';

// Use require() inside the factory — jest.mock cannot reference out-of-scope imports.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(({ children }: { children: unknown }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ snapToIndex: jest.fn(), close: jest.fn() }));
      return React.createElement(View, null, children);
    }),
    BottomSheetView: ({ children }: { children: unknown }) => React.createElement(View, null, children),
  };
});

jest.mock('../src/features/auth/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/consent/consent', () => ({
  loadConsent: jest.fn(() => Promise.resolve(null)),
  saveConsent: jest.fn(() => Promise.resolve()),
}));

const mockUseAuth = useAuth as jest.Mock;
const signOut = jest.fn();
const deleteAccount = jest.fn();
const onClose = jest.fn();
const onSignInRequested = jest.fn();

function mockSignedOut() {
  mockUseAuth.mockReturnValue({ session: null, user: null, loading: false, signOut, deleteAccount });
}

function mockSignedIn(email = 'me@example.com') {
  mockUseAuth.mockReturnValue({
    session: { user: { email } },
    user: { email },
    loading: false,
    signOut,
    deleteAccount,
  });
}

function renderSheet() {
  return render(<SettingsSheet visible={true} onClose={onClose} onSignInRequested={onSignInRequested} />);
}

/** Presses the named button in the most recent Alert.alert dialog. */
async function pressAlertButton(text: string) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const button = buttons?.find((b) => b.text === text);
  if (!button) throw new Error(`no "${text}" button in the dialog`);
  await button.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSignedOut();
});

describe('sections', () => {
  it('shows the Settings title and the Account and Language sections', async () => {
    await renderSheet();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
  });
});

describe('account — signed out', () => {
  it('offers to sign in and asks the parent to open the sign-in sheet', async () => {
    await renderSheet();
    await fireEvent.press(screen.getByText('Sign in or create account'));
    expect(onSignInRequested).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sign Out')).toBeNull();
  });
});

describe('account — signed in', () => {
  it('shows the email, Sign Out and Delete Account', async () => {
    mockSignedIn('me@example.com');
    await renderSheet();
    expect(screen.getByText('me@example.com')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.getByText('Delete Account')).toBeTruthy();
    expect(screen.queryByText('Sign in or create account')).toBeNull();
  });

  it('signs out and closes the sheet', async () => {
    mockSignedIn();
    signOut.mockResolvedValue({ error: null });
    await renderSheet();
    await fireEvent.press(screen.getByText('Sign Out'));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a sign-out error and stays open', async () => {
    mockSignedIn();
    signOut.mockResolvedValue({ error: 'Network request failed' });
    await renderSheet();
    await fireEvent.press(screen.getByText('Sign Out'));
    await waitFor(() => expect(screen.getByText('Network request failed')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting, and does nothing on Cancel', async () => {
    mockSignedIn();
    await renderSheet();
    await fireEvent.press(screen.getByText('Delete Account'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete account?',
      'This permanently deletes your account and cannot be undone.',
      expect.any(Array),
    );
    await pressAlertButton('Cancel');
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes the account after confirmation and closes the sheet', async () => {
    mockSignedIn();
    deleteAccount.mockResolvedValue({ error: null });
    await renderSheet();
    await fireEvent.press(screen.getByText('Delete Account'));
    await pressAlertButton('Delete');
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a delete error and stays open', async () => {
    mockSignedIn();
    deleteAccount.mockResolvedValue({ error: 'Failed to delete account' });
    await renderSheet();
    await fireEvent.press(screen.getByText('Delete Account'));
    await pressAlertButton('Delete');
    await waitFor(() => expect(screen.getByText('Failed to delete account')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('language', () => {
  it('shows a button for each supported language, English selected', async () => {
    await renderSheet();
    for (const label of ['DE', 'EN', 'TR']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'EN' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it('switches every translated string when a language is tapped', async () => {
    await renderSheet();
    await fireEvent.press(screen.getByRole('button', { name: 'DE' }));
    await waitFor(() => expect(screen.getByText('Einstellungen')).toBeTruthy());
    expect(screen.getByText('Sprache')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DE' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    // i18next is a shared singleton: switch back so later suites stay English.
    await fireEvent.press(screen.getByRole('button', { name: 'EN' }));
    await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy());
  });
});

describe('SettingsSheet — privacy', () => {
  const { loadConsent, saveConsent } = jest.requireMock<{ loadConsent: jest.Mock; saveConsent: jest.Mock }>(
    '../src/features/consent/consent',
  );

  it('shows both switches off when nothing was chosen', async () => {
    await renderSheet();
    await waitFor(() => expect(loadConsent).toHaveBeenCalled());
    expect(screen.getByLabelText('Crash reports').props.value).toBe(false);
    expect(screen.getByLabelText('Usage statistics').props.value).toBe(false);
  });

  it('shows the stored choice', async () => {
    loadConsent.mockResolvedValueOnce({ crashReports: true, analytics: false, decidedAt: '2026-10-08T18:00:00.000Z' });
    await renderSheet();
    await waitFor(() => expect(screen.getByLabelText('Crash reports').props.value).toBe(true));
    expect(screen.getByLabelText('Usage statistics').props.value).toBe(false);
  });

  it('saves a change straight away, keeping the other choice', async () => {
    loadConsent.mockResolvedValueOnce({ crashReports: true, analytics: false, decidedAt: '2026-10-08T18:00:00.000Z' });
    await renderSheet();
    await waitFor(() => expect(screen.getByLabelText('Crash reports').props.value).toBe(true));
    fireEvent(screen.getByLabelText('Usage statistics'), 'valueChange', true);
    await waitFor(() => expect(saveConsent).toHaveBeenCalledWith({ crashReports: true, analytics: true }));
  });
});
