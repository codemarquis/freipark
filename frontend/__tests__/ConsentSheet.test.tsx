import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '../src/i18n';
import { ConsentSheet, PRIVACY_POLICY_URL } from '../src/features/consent/ConsentSheet';
import { loadConsent, saveConsent } from '../src/features/consent/consent';

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

jest.mock('../src/features/consent/consent', () => ({
  loadConsent: jest.fn(),
  saveConsent: jest.fn(() => Promise.resolve()),
}));

const mockLoad = loadConsent as jest.Mock;
const mockSave = saveConsent as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(null);
});

it('asks when no choice is stored', async () => {
  await render(<ConsentSheet />);
  expect(await screen.findByText('Allow')).toBeTruthy();
  expect(screen.getByText("Don't allow")).toBeTruthy();
});

it('stays hidden once the user has chosen', async () => {
  mockLoad.mockResolvedValue({ crashReports: false, analytics: false, decidedAt: '2026-10-08T18:00:00.000Z' });
  await render(<ConsentSheet />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalled());
  expect(screen.queryByText('Allow')).toBeNull();
});

it('"Allow" turns both on and closes', async () => {
  await render(<ConsentSheet />);
  fireEvent.press(await screen.findByText('Allow'));
  await waitFor(() => expect(screen.queryByText('Allow')).toBeNull());
  expect(mockSave).toHaveBeenCalledWith({ crashReports: true, analytics: true });
});

it('"Don\'t allow" stores both off and closes', async () => {
  await render(<ConsentSheet />);
  fireEvent.press(await screen.findByText("Don't allow"));
  await waitFor(() => expect(screen.queryByText("Don't allow")).toBeNull());
  expect(mockSave).toHaveBeenCalledWith({ crashReports: false, analytics: false });
});

it('opens the privacy policy', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<ConsentSheet />);
  fireEvent.press(await screen.findByText('Privacy policy'));
  expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
});
