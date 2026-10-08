import de from '../src/i18n/locales/de.json';
import en from '../src/i18n/locales/en.json';
import tr from '../src/i18n/locales/tr.json';

type Locale = { settings?: Record<string, string> };
const REQUIRED = ['title', 'account', 'language', 'signInOrCreate', 'a11y'];

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
});
