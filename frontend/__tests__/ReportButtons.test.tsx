import { act, fireEvent, render, screen } from '@testing-library/react-native';
import '../src/i18n';
import de from '../src/i18n/locales/de.json';
import en from '../src/i18n/locales/en.json';
import tr from '../src/i18n/locales/tr.json';
import { ReportButtons } from '../src/features/reports/ReportButtons';
import { useReportSpot } from '../src/features/reports/useReportSpot';
import type { SubmitOutcome } from '../src/features/reports/useReportSpot';
import type { ReportErrorCode } from '../src/features/reports/reportStatus';
import type { SpotRow } from '../src/lib/types';

jest.mock('../src/features/reports/useReportSpot', () => ({
  useReportSpot: jest.fn(),
}));

const mockUseReportSpot = useReportSpot as jest.Mock;
const submit = jest.fn<Promise<SubmitOutcome>, [SpotRow, 'free' | 'full']>();
const onReported = jest.fn();
const onSignInRequired = jest.fn();

const SPOT: SpotRow = {
  id: 'spot-1',
  spot_type: 'street',
  access: 'free',
  operator: null,
  capacity: null,
  lon: 13.405,
  lat: 52.52,
  report_status: null,
  report_at: null,
};
const REPORT = { spotId: 'spot-1', status: 'free' as const, reportedAt: '2026-10-07T12:00:00+00:00' };

function hookState(overrides: { submitting?: boolean; error?: ReportErrorCode | null } = {}) {
  mockUseReportSpot.mockReturnValue({
    submit,
    submitting: false,
    error: null,
    lastReport: null,
    ...overrides,
  });
}

async function renderButtons(locationDenied = false) {
  await render(
    <ReportButtons
      spot={SPOT}
      locationDenied={locationDenied}
      onReported={onReported}
      onSignInRequired={onSignInRequired}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  hookState();
  submit.mockResolvedValue({ ok: true, report: REPORT });
});

describe('ReportButtons', () => {
  it('shows both report buttons with accessible labels', async () => {
    await renderButtons();
    expect(screen.getByRole('button', { name: 'Report: space free' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report: full' })).toBeTruthy();
    expect(screen.getByText('Space free')).toBeTruthy();
    expect(screen.getByText('Full')).toBeTruthy();
  });

  it.each([
    ['Space free', 'free'],
    ['Full', 'full'],
  ] as const)('tapping %s submits %s and reports success', async (label, status) => {
    await renderButtons();
    await act(async () => {
      fireEvent.press(screen.getByText(label));
    });
    expect(submit).toHaveBeenCalledWith(SPOT, status);
    expect(onReported).toHaveBeenCalledWith(REPORT);
    expect(onSignInRequired).not.toHaveBeenCalled();
  });

  it('asks the user to sign in when signed out', async () => {
    submit.mockResolvedValue({ ok: false, error: 'not_authenticated' });
    await renderButtons();
    await act(async () => {
      fireEvent.press(screen.getByText('Space free'));
    });
    expect(onSignInRequired).toHaveBeenCalledTimes(1);
    expect(onReported).not.toHaveBeenCalled();
  });

  it('does nothing extra when a tap is ignored as busy', async () => {
    submit.mockResolvedValue({ ok: false, error: 'busy' });
    await renderButtons();
    await act(async () => {
      fireEvent.press(screen.getByText('Full'));
    });
    expect(onReported).not.toHaveBeenCalled();
    expect(onSignInRequired).not.toHaveBeenCalled();
  });

  it('disables the buttons and explains why when location is denied', async () => {
    await renderButtons(true);
    expect(screen.getByText('Turn on location access to report this spot.')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Space free'));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Report: space free' })).toBeDisabled();
  });

  it('shows a spinner and disables the buttons while submitting', async () => {
    hookState({ submitting: true });
    await renderButtons();
    expect(screen.getByTestId('report-submitting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report: full' })).toBeDisabled();
  });

  it.each([
    ['too_far', 'You need to be at the spot to report it.'],
    ['rate_limited_spot', 'You reported this spot a moment ago.'],
    ['rate_limited_hourly', 'Too many reports. Please try again later.'],
    ['location_unavailable', "Couldn't get your location."],
    ['unknown', "Couldn't send the report. Please try again."],
  ] as const)('shows the message for %s', async (code, message) => {
    hookState({ error: code });
    await renderButtons();
    expect(screen.getByText(message)).toBeTruthy();
  });

  it('shows no error text for not_authenticated (the sign-in sheet handles it)', async () => {
    hookState({ error: 'not_authenticated' });
    await renderButtons();
    expect(screen.queryByTestId('report-error')).toBeNull();
  });
});

describe('report translations', () => {
  const keys = (locale: { report?: Record<string, string> }) => Object.keys(locale.report ?? {}).sort();

  it('has the same report.* keys in de, en and tr', () => {
    expect(keys(en).length).toBeGreaterThan(0);
    expect(keys(de)).toEqual(keys(en));
    expect(keys(tr)).toEqual(keys(en));
  });

  it('has no empty report strings', () => {
    for (const locale of [de, en, tr]) {
      for (const value of Object.values(locale.report ?? {})) {
        expect(value.trim()).not.toBe('');
      }
    }
  });
});
