import i18n from '../src/i18n';
import de from '../src/i18n/locales/de.json';
import en from '../src/i18n/locales/en.json';
import tr from '../src/i18n/locales/tr.json';
import { formatAddress, formatCoords } from '../src/features/map/spotAddress';
import type { SpotDetails } from '../src/features/map/spotAddress';

const t = i18n.getFixedT('en');

const FULL: SpotDetails = {
  address_street: 'Oranienstraße',
  address_housenumber: '12',
  address_postcode: '10997',
  address_source: 'own_tags',
  city_name: 'Berlin',
  rule_tags: {},
};

describe('formatAddress', () => {
  it('shows a full own address as "Street No, Postcode City"', () => {
    expect(formatAddress(FULL, t)).toBe('Oranienstraße 12, 10997 Berlin');
  });

  it('leaves out a missing number or postcode', () => {
    expect(formatAddress({ ...FULL, address_postcode: null }, t)).toBe('Oranienstraße 12, Berlin');
    expect(formatAddress({ ...FULL, address_housenumber: null, address_postcode: null }, t)).toBe(
      'Oranienstraße, Berlin',
    );
  });

  it('shows a street-parking street as "Street, City"', () => {
    expect(
      formatAddress(
        { ...FULL, address_housenumber: null, address_postcode: null, address_source: 'street_name' },
        t,
      ),
    ).toBe('Oranienstraße, Berlin');
  });

  it('prefixes "near" for the nearest address and nearest street rules', () => {
    expect(formatAddress({ ...FULL, address_source: 'nearest_address' }, t)).toBe(
      'near Oranienstraße 12, 10997 Berlin',
    );
    expect(
      formatAddress(
        { ...FULL, address_housenumber: null, address_postcode: null, address_source: 'nearest_street' },
        t,
      ),
    ).toBe('near Oranienstraße, Berlin');
  });

  it('returns null when there is no street', () => {
    expect(
      formatAddress(
        { address_street: null, address_housenumber: null, address_postcode: null, address_source: null, city_name: 'Berlin', rule_tags: {} },
        t,
      ),
    ).toBeNull();
  });

  it('uses "bei" in German and "yakınında" after the address in Turkish', () => {
    const near = { ...FULL, address_source: 'nearest_address' as const };
    expect(formatAddress(near, i18n.getFixedT('de'))).toBe('bei Oranienstraße 12, 10997 Berlin');
    expect(formatAddress(near, i18n.getFixedT('tr'))).toBe('Oranienstraße 12, 10997 Berlin yakınında');
  });
});

describe('formatCoords', () => {
  it('formats lat, lon to 5 decimals', () => {
    expect(formatCoords(52.5056164419491, 13.3969318899245)).toBe('52.50562, 13.39693');
  });

  it('keeps negative values and pads trailing zeros', () => {
    expect(formatCoords(-33.8688, -151.2)).toBe('-33.86880, -151.20000');
  });
});

describe('address translations', () => {
  it('has the near-address string in every language, with the placeholder', () => {
    for (const locale of [de, en, tr]) {
      expect(locale.spot.addressNear).toContain('{{address}}');
    }
  });
});

describe('special characters', () => {
  it('does not HTML-escape addresses', () => {
    expect(
      formatAddress(
        { ...FULL, address_street: "Rue d'Alsace & Co", address_source: 'nearest_address' },
        t,
      ),
    ).toBe("near Rue d'Alsace & Co 12, 10997 Berlin");
  });
});
