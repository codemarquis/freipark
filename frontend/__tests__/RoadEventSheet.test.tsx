import { render, screen } from '@testing-library/react-native';
import '../src/i18n';
import { RoadEventSheet } from '../src/features/map/RoadEventSheet';
import type { RoadEventProperties } from '../src/features/map/RoadEventsLayer';

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

const CLOSURE: RoadEventProperties = {
  id: 'e1',
  kind: 'closure',
  road: 'A100',
  title: 'A100 | Beusselstraße - Schmargendorf',
  subtitle: 'Wedding -> Neukölln',
  description: ['Beginn: 08.10.26', 'Ende: 09.10.26'],
  starts_at: '2026-10-08T10:00:00+00:00',
  ends_at: '2026-10-09T21:59:00+00:00',
};

const renderSheet = (event: RoadEventProperties | null) =>
  render(<RoadEventSheet event={event} onClose={jest.fn()} />);

describe('RoadEventSheet', () => {
  it('shows nothing without an event', async () => {
    await renderSheet(null);
    expect(screen.queryByText('Road closed')).toBeNull();
  });

  it('shows the type, title, direction, description and Autobahn credit', async () => {
    await renderSheet(CLOSURE);
    expect(screen.getByText('Road closed')).toBeTruthy();
    expect(screen.getByText('A100 | Beusselstraße - Schmargendorf')).toBeTruthy();
    expect(screen.getByText('Wedding -> Neukölln')).toBeTruthy();
    expect(screen.getByText('Beginn: 08.10.26')).toBeTruthy();
    expect(screen.getByText('Source: Autobahn GmbH des Bundes')).toBeTruthy();
  });

  it('shows when it ends', async () => {
    await renderSheet(CLOSURE);
    expect(screen.getByText(/^until /)).toBeTruthy();
  });

  it('shows no end line when the end is unknown', async () => {
    await renderSheet({ ...CLOSURE, ends_at: null });
    expect(screen.queryByText(/^until /)).toBeNull();
  });

  it.each([
    ['entry_exit_closure', 'Junction closed'],
    ['roadworks', 'Roadworks'],
    ['short_term_roadworks', 'Short-term roadworks'],
  ] as const)('labels %s as "%s"', async (kind, label) => {
    await renderSheet({ ...CLOSURE, kind });
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('credits OpenStreetMap for roads under construction, and skips an empty title', async () => {
    await renderSheet({ ...CLOSURE, kind: 'construction', title: '', subtitle: null, description: [] });
    expect(screen.getByText('Under construction')).toBeTruthy();
    expect(screen.getByText('Source: OpenStreetMap')).toBeTruthy();
    expect(screen.queryByText('Wedding -> Neukölln')).toBeNull();
  });
});
