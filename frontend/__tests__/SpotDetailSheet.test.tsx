import { Linking } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import '../src/i18n';
import { SpotDetailSheet } from '../src/features/map/SpotDetailSheet';
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
  };
});

jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);

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
};

// @testing-library/react-native v14 made render() async — callers must await.
function renderSheet(
  spot: SpotRow | null,
  opts: { route?: RouteState; locationDenied?: boolean } = {},
) {
  return render(
    <SpotDetailSheet
      spot={spot}
      onClose={jest.fn()}
      route={opts.route ?? IDLE}
      locationDenied={opts.locationDenied ?? false}
    />,
  );
}

// ─── no spot ─────────────────────────────────────────────────────────────────

describe('when spot is null', () => {
  it('renders no spot content', async () => {
    await renderSheet(null);
    expect(screen.queryByText('Street parking')).toBeNull();
    expect(screen.queryByText('Open EasyPark')).toBeNull();
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
