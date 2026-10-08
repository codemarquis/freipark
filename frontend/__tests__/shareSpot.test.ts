import { buildShareMessage, mapsUrl } from '../src/features/map/shareSpot';

const BASE = {
  typeLabel: 'Parking lot',
  accessLabel: 'Free parking',
  statusLine: null,
  addressLine: null,
  lat: 52.5056164419491,
  lon: 13.3969318899245,
};

describe('mapsUrl', () => {
  it("uses Google Maps' cross-platform search URL with lat,lon at 5 decimals", () => {
    expect(mapsUrl(52.5056164419491, 13.3969318899245)).toBe(
      'https://www.google.com/maps/search/?api=1&query=52.50562,13.39693',
    );
  });
});

describe('buildShareMessage', () => {
  it('lists type and access, coordinates (lat, lon) and the maps link, one per line', () => {
    expect(buildShareMessage(BASE).split('\n')).toEqual([
      'Parking lot · Free parking',
      '52.50562, 13.39693',
      'https://www.google.com/maps/search/?api=1&query=52.50562,13.39693',
    ]);
  });

  it('adds the report status line when a report is active', () => {
    expect(buildShareMessage({ ...BASE, statusLine: 'Reported free · 4 min ago' }).split('\n')).toEqual([
      'Parking lot · Free parking',
      'Reported free · 4 min ago',
      '52.50562, 13.39693',
      'https://www.google.com/maps/search/?api=1&query=52.50562,13.39693',
    ]);
  });

  it('puts the address above the coordinates', () => {
    expect(
      buildShareMessage({
        ...BASE,
        statusLine: 'Reported free · 4 min ago',
        addressLine: 'near Oranienstraße 12, 10997 Berlin',
      }).split('\n'),
    ).toEqual([
      'Parking lot · Free parking',
      'Reported free · 4 min ago',
      'near Oranienstraße 12, 10997 Berlin',
      '52.50562, 13.39693',
      'https://www.google.com/maps/search/?api=1&query=52.50562,13.39693',
    ]);
  });

  it('keeps negative coordinates intact', () => {
    expect(buildShareMessage({ ...BASE, lat: -33.86882, lon: -151.20929 })).toContain('-33.86882, -151.20929');
  });
});
