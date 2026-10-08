import { Linking, Share } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import '../src/i18n';
import { SNAP_POINTS, SpotDetailSheet } from '../src/features/map/SpotDetailSheet';
import type { SpotRow } from '../src/lib/types';
import type { RouteState } from '../src/features/map/useRoute';

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
    BottomSheetScrollView: ({ children }: { children: unknown }) =>
      React.createElement(View, { testID: 'spot-sheet-scroll' }, children),
  };
});

jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
const mockShare = jest.spyOn(Share, 'share');
jest.mock('../src/lib/posthog', () => ({ posthog: { capture: jest.fn() } }));
jest.mock('../src/features/map/useSpotDetails', () => ({ useSpotDetails: jest.fn(() => null) }));
const { useSpotDetails: mockUseSpotDetails } = jest.requireMock('../src/features/map/useSpotDetails') as {
  useSpotDetails: jest.Mock;
};
const DETAILS = {
  address_street: 'Oranienstraße',
  address_housenumber: '12',
  address_postcode: '10997',
  address_source: 'nearest_address',
  city_name: 'Berlin',
  rule_tags: {},
};
const { posthog: mockPosthog } = jest.requireMock('../src/lib/posthog') as {
  posthog: { capture: jest.Mock };
};

// ReportButtons has its own tests; here it only needs to hand back its
// callbacks so the sheet's wiring can be exercised.
const MOCK_REPORT = { spotId: '1', status: 'free', reportedAt: '' };
jest.mock('../src/features/reports/ReportButtons', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    ReportButtons: ({ spot, locationDenied, onReported, onSignInRequired }: any) =>
      React.createElement(
        View,
        { testID: `report-buttons-${spot.id}-${locationDenied ? 'denied' : 'ok'}` },
        React.createElement(
          Pressable,
          { onPress: () => onReported({ ...MOCK_REPORT, spotId: spot.id, reportedAt: new Date().toISOString() }) },
          React.createElement(Text, null, 'mock report free'),
        ),
        React.createElement(
          Pressable,
          { onPress: onSignInRequired },
          React.createElement(Text, null, 'mock sign in'),
        ),
      ),
  };
});


// ─── helpers ─────────────────────────────────────────────────────────────────

const IDLE: RouteState = { data: null, loading: false, error: null };

const BASE: SpotRow = {
  id: '1',
  spot_type: 'street',
  access: 'free',
  operator: null,
  capacity: null,
  lon: 13.405,
  lat: 52.52,
  report_status: null,
  report_at: null,
};

// @testing-library/react-native v14 made render() async — callers must await.
const onReported = jest.fn();
const onSignInRequired = jest.fn();

function sheet(spot: SpotRow | null, opts: { route?: RouteState; locationDenied?: boolean } = {}) {
  return (
    <SpotDetailSheet
      spot={spot}
      onClose={jest.fn()}
      route={opts.route ?? IDLE}
      locationDenied={opts.locationDenied ?? false}
      onReported={onReported}
      onSignInRequired={onSignInRequired}
    />
  );
}

function renderSheet(
  spot: SpotRow | null,
  opts: { route?: RouteState; locationDenied?: boolean } = {},
) {
  return render(sheet(spot, opts));
}

// ─── no spot ─────────────────────────────────────────────────────────────────

describe('when spot is null', () => {
  it('renders no spot content', async () => {
    await renderSheet(null);
    expect(screen.queryByText('Street parking')).toBeNull();
    expect(screen.queryByText('Open EasyPark')).toBeNull();
  });
});

describe('sheet height', () => {
  it('opens at 55% and scrolls, so no action is out of reach', async () => {
    expect(SNAP_POINTS).toEqual(['55%', '90%']);
    await renderSheet(BASE);
    const scroll = screen.getByTestId('spot-sheet-scroll');
    expect(within(scroll).getByText('Share')).toBeTruthy();
  });
});

// ─── spot type labels ─────────────────────────────────────────────────────────

describe('spot type labels', () => {
  it.each<[SpotRow['spot_type'], string]>([
    ['street', 'Street parking'],
    ['garage', 'Parking garage'],
    ['lot', 'Parking lot'],
    ['zone', 'Parking zone'],
  ])('%s → "%s"', async (spot_type, label) => {
    await renderSheet({ ...BASE, spot_type });
    expect(screen.getByText(label)).toBeTruthy();
  });
});

// ─── access labels ────────────────────────────────────────────────────────────

describe('access labels', () => {
  it.each<[SpotRow['access'], string]>([
    ['free', 'Free parking'],
    ['paid', 'Paid parking'],
    ['permit', 'Permit required'],
    ['private', 'Private'],
    [null, 'Access unknown'],
  ])('%s → "%s"', async (access, label) => {
    await renderSheet({ ...BASE, access });
    expect(screen.getByText(label)).toBeTruthy();
  });
});

// ─── payment links ────────────────────────────────────────────────────────────

describe('payment links', () => {
  it('shows EasyPark button for paid spots', async () => {
    await renderSheet({ ...BASE, access: 'paid' });
    expect(screen.getByText('Open EasyPark')).toBeTruthy();
  });

  it.each<SpotRow['access']>(['free', 'permit', 'private', null])(
    'hides EasyPark button for access=%s',
    async (access) => {
      await renderSheet({ ...BASE, access });
      expect(screen.queryByText('Open EasyPark')).toBeNull();
    },
  );
});

// ─── permit warning ───────────────────────────────────────────────────────────

describe('permit warning', () => {
  it('shows notice for permit spots', async () => {
    await renderSheet({ ...BASE, access: 'permit' });
    expect(screen.getByText(/valid parking permit/i)).toBeTruthy();
  });

  it('hides notice for non-permit spots', async () => {
    await renderSheet({ ...BASE, access: 'free' });
    expect(screen.queryByText(/valid parking permit/i)).toBeNull();
  });
});

// ─── operator and capacity ────────────────────────────────────────────────────

describe('operator and capacity', () => {
  it('shows operator when present', async () => {
    await renderSheet({ ...BASE, operator: 'APCOA' });
    expect(screen.getByText('Operator: APCOA')).toBeTruthy();
  });

  it('omits operator row when null', async () => {
    await renderSheet({ ...BASE, operator: null });
    expect(screen.queryByText(/Operator:/)).toBeNull();
  });

  it('shows capacity when present', async () => {
    await renderSheet({ ...BASE, capacity: 150 });
    expect(screen.getByText('Capacity: 150')).toBeTruthy();
  });

  it('omits capacity row when null', async () => {
    await renderSheet({ ...BASE, capacity: null });
    expect(screen.queryByText(/Capacity:/)).toBeNull();
  });
});

// ─── route information ────────────────────────────────────────────────────────

describe('route information', () => {
  it('shows distance and duration when route data is available', async () => {
    await renderSheet(BASE, {
      route: {
        data: {
          geometry: { type: 'LineString', coordinates: [] },
          distance_m: 850,
          duration_s: 180,
        },
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText('850 m · 3 min')).toBeTruthy();
  });

  it('formats distances over 1 km in km', async () => {
    await renderSheet(BASE, {
      route: {
        data: {
          geometry: { type: 'LineString', coordinates: [] },
          distance_m: 2500,
          duration_s: 600,
        },
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText('2.5 km · 10 min')).toBeTruthy();
  });

  it('shows loading hint while route is fetching', async () => {
    await renderSheet(BASE, { route: { data: null, loading: true, error: null } });
    expect(screen.getByText('Getting directions…')).toBeTruthy();
  });

  it('shows unavailable hint on route error', async () => {
    await renderSheet(BASE, { route: { data: null, loading: false, error: 'timeout' } });
    expect(screen.getByText('Directions unavailable.')).toBeTruthy();
  });
});

// ─── location denied ──────────────────────────────────────────────────────────

describe('location denied', () => {
  it('shows enable-location hint instead of route info', async () => {
    await renderSheet(BASE, { locationDenied: true });
    expect(screen.getByText('Enable location to see directions.')).toBeTruthy();
  });

  it('hides route info when location is denied', async () => {
    await renderSheet(BASE, {
      locationDenied: true,
      route: {
        data: {
          geometry: { type: 'LineString', coordinates: [] },
          distance_m: 500,
          duration_s: 90,
        },
        loading: false,
        error: null,
      },
    });
    expect(screen.queryByText(/500 m/)).toBeNull();
  });
});

// ─── crowdsourced reports ───────────────────────────────────────────────────

describe('spot reports', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  beforeEach(() => {
    onReported.mockClear();
    onSignInRequired.mockClear();
  });

  it('shows the latest active report with its age', async () => {
    await renderSheet({ ...BASE, report_status: 'full', report_at: minutesAgo(4) });
    expect(screen.getByText('Reported occupied · 4 min ago')).toBeTruthy();
  });

  it('says "just now" for a report under a minute old', async () => {
    await renderSheet({ ...BASE, report_status: 'free', report_at: minutesAgo(0.2) });
    expect(screen.getByText('Reported free · just now')).toBeTruthy();
  });

  it('hides an expired report', async () => {
    await renderSheet({ ...BASE, report_status: 'free', report_at: minutesAgo(31) });
    expect(screen.queryByText(/^Reported /)).toBeNull();
  });

  it('shows no status line without a report', async () => {
    await renderSheet(BASE);
    expect(screen.queryByText(/^Reported /)).toBeNull();
  });

  it('renders the report buttons for the spot, passing locationDenied through', async () => {
    await renderSheet(BASE, { locationDenied: true });
    expect(screen.getByTestId('report-buttons-1-denied')).toBeTruthy();
  });

  it('shows a new report immediately and tells the parent', async () => {
    await renderSheet({ ...BASE, report_status: 'full', report_at: minutesAgo(12) });
    await act(async () => {
      fireEvent.press(screen.getByText('mock report free'));
    });
    expect(screen.getByText('Reported free · just now')).toBeTruthy();
    expect(screen.queryByText('Reported occupied · 12 min ago')).toBeNull();
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  it('does not carry a just-made report over to a different spot', async () => {
    const { rerender } = await renderSheet(BASE);
    await act(async () => {
      fireEvent.press(screen.getByText('mock report free'));
    });
    expect(screen.getByText('Reported free · just now')).toBeTruthy();

    await rerender(sheet({ ...BASE, id: '2' }));
    expect(screen.queryByText(/^Reported /)).toBeNull();
  });

  it('passes sign-in requests up', async () => {
    await renderSheet(BASE);
    await act(async () => {
      fireEvent.press(screen.getByText('mock sign in'));
    });
    expect(onSignInRequired).toHaveBeenCalledTimes(1);
  });

  it('keeps the age current while the sheet stays open', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-07T12:00:00Z') });
    try {
      await renderSheet({ ...BASE, report_status: 'free', report_at: '2026-10-07T11:58:00Z' });
      expect(screen.getByText('Reported free · 2 min ago')).toBeTruthy();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByText('Reported free · 3 min ago')).toBeTruthy();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(28 * 60_000);
      });
      expect(screen.queryByText(/^Reported /)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── share ───────────────────────────────────────────────────────────────────

function sharedMessage(): string {
  const content = mockShare.mock.calls[0]?.[0];
  if (!content || !('message' in content) || typeof content.message !== 'string') {
    throw new Error('Share.share was not called with a message');
  }
  return content.message;
}

describe('share', () => {
  beforeEach(() => {
    mockShare.mockReset();
    mockPosthog.capture.mockClear();
  });

  it('has an accessible Share button', async () => {
    await renderSheet(BASE);
    expect(screen.getByRole('button', { name: 'Share this parking spot' })).toBeTruthy();
  });

  it("opens the phone's share sheet with type, access, coordinates and a maps link", async () => {
    mockShare.mockResolvedValue({ action: Share.sharedAction });
    await renderSheet(BASE);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share this parking spot' }));
    });
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(sharedMessage().split('\n')).toEqual([
      'Street parking · Free parking',
      '52.52000, 13.40500',
      'https://www.google.com/maps/search/?api=1&query=52.52000,13.40500',
    ]);
  });

  it('includes an active report in the message', async () => {
    mockShare.mockResolvedValue({ action: Share.sharedAction });
    const reportAt = new Date(Date.now() - 4 * 60_000).toISOString();
    await renderSheet({ ...BASE, report_status: 'full', report_at: reportAt });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share this parking spot' }));
    });
    expect(sharedMessage()).toContain('Reported occupied · 4 min ago');
  });

  it('records whether the share completed, without coordinates', async () => {
    mockShare.mockResolvedValue({ action: Share.dismissedAction });
    await renderSheet(BASE);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share this parking spot' }));
    });
    expect(mockPosthog.capture).toHaveBeenCalledWith('spot_shared', {
      parking_spot_type: 'street',
      parking_access: 'free',
      completed: false,
    });
  });

  it('does not crash if the share sheet fails', async () => {
    mockShare.mockRejectedValue(new Error('no share targets'));
    await renderSheet(BASE);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share this parking spot' }));
    });
    expect(screen.getByText('Street parking')).toBeTruthy();
  });
});

// ─── address and coordinates ────────────────────────────────────────────────

describe('address and coordinates', () => {
  afterEach(() => {
    mockUseSpotDetails.mockReturnValue(null);
  });

  it('shows the coordinates straight away', async () => {
    await renderSheet(BASE);
    expect(screen.getByText('52.52000, 13.40500')).toBeTruthy();
  });

  it('asks for the details of the open spot', async () => {
    await renderSheet(BASE);
    expect(mockUseSpotDetails).toHaveBeenLastCalledWith('1');
  });

  it('shows the parking rule line with its disclaimer once details have loaded', async () => {
    mockUseSpotDetails.mockReturnValue({ ...DETAILS, rule_tags: { fee: 'no' } });
    await renderSheet(BASE);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('From OpenStreetMap — signs on site take precedence.')).toBeTruthy();
  });

  it('shows no rule line while details are loading', async () => {
    await renderSheet(BASE);
    expect(screen.queryByText('From OpenStreetMap — signs on site take precedence.')).toBeNull();
  });

  it('shows the address once it has loaded', async () => {
    mockUseSpotDetails.mockReturnValue(DETAILS);
    await renderSheet(BASE);
    expect(screen.getByText('near Oranienstraße 12, 10997 Berlin')).toBeTruthy();
  });

  it('shows no address line when the spot has none', async () => {
    mockUseSpotDetails.mockReturnValue({ ...DETAILS, address_street: null, address_source: null });
    await renderSheet(BASE);
    expect(screen.queryByText(/Oranienstraße/)).toBeNull();
    expect(screen.getByText('52.52000, 13.40500')).toBeTruthy();
  });

  it('includes the address in the share message', async () => {
    mockUseSpotDetails.mockReturnValue(DETAILS);
    mockShare.mockReset();
    mockShare.mockResolvedValue({ action: Share.sharedAction });
    await renderSheet(BASE);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Share this parking spot' }));
    });
    expect(sharedMessage()).toContain('near Oranienstraße 12, 10997 Berlin\n52.52000, 13.40500');
  });
});
