import de from '../src/i18n/locales/de.json';
import en from '../src/i18n/locales/en.json';
import tr from '../src/i18n/locales/tr.json';

type Locale = { settings?: Record<string, string>; consent?: Record<string, string> };
const REQUIRED = [
  'title', 'account', 'language', 'signInOrCreate', 'a11y', 'privacy', 'crashReports', 'analytics',
];
const CONSENT_REQUIRED = ['title', 'body', 'allow', 'deny', 'privacyLink'];

describe('settings translations', () => {
  it.each([
    ['de', de],
    ['en', en],
    ['tr', tr],
  ] as [string, Locale][])('%s has every settings key, none empty', (_lang, locale) => {
    const settings = locale.settings ?? {};
    expect(Object.keys(settings).sort()).toEqual([...REQUIRED].sort());
    for (const value of Object.values(settings)) {
      expect(value.trim()).not.toBe('');
    }
  });

  it.each([
    ['de', de],
    ['en', en],
    ['tr', tr],
  ] as [string, Locale][])('%s has every consent key, none empty', (_lang, locale) => {
    const consent = locale.consent ?? {};
    expect(Object.keys(consent).sort()).toEqual([...CONSENT_REQUIRED].sort());
    for (const value of Object.values(consent)) {
      expect(value.trim()).not.toBe('');
    }
  });
});
