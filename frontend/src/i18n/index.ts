import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './locales/de.json';
import en from './locales/en.json';
import tr from './locales/tr.json';

export const SUPPORTED_LANGUAGES = ['de', 'en', 'tr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_STORAGE_KEY = 'freipark.language';

// German is the product default (primary market), not just a fallback for
// missing translations — an unrecognized/unsupported device locale should
// land on German, not English.
const DEFAULT_LANGUAGE: SupportedLanguage = 'de';

function isSupportedLanguage(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

function detectDeviceLanguage(): SupportedLanguage {
  // Jest has no real device locale, and expo-localization's mocked return
  // value there isn't something to depend on — existing component tests
  // assert on English UI text, so give them a deterministic language
  // instead of whatever the mock happens to report.
  if (process.env.JEST_WORKER_ID !== undefined) {
    return 'en';
  }
  const deviceCode = Localization.getLocales()[0]?.languageCode ?? '';
  return isSupportedLanguage(deviceCode) ? deviceCode : DEFAULT_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    tr: { translation: tr },
  },
  lng: detectDeviceLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

// A user's explicit in-app language choice should persist across restarts
// and override device-locale detection — applied asynchronously after the
// synchronous init above so app startup isn't blocked on storage I/O.
AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((saved) => {
  if (saved && isSupportedLanguage(saved) && saved !== i18n.language) {
    i18n.changeLanguage(saved);
  }
});

export async function setLanguage(language: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export default i18n;
