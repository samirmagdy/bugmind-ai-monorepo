/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo } from 'react';
import { useBugMind } from './hooks/useBugMind';
import en from './locales/en.json';
import ar from './locales/ar.json';

type Locale = 'en' | 'ar';

const translations: Record<Locale, Record<string, string>> = { en, ar };

type I18nContextValue = {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, updateSession } = useBugMind();
  const locale = session.locale || 'en';

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    setLocale: (nextLocale) => updateSession({ locale: nextLocale }),
    t: (key, params = {}) => {
      const template = translations[locale][key] || translations.en[key] || key;
      return Object.entries(params).reduce(
        (text, [name, val]) => text.split(`{${name}}`).join(String(val)),
        template
      );
    },
  }), [locale, updateSession]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
