import { createContext, useContext } from 'react';
import { TranslationStore } from './store.ts';
import type { LocaleCode } from '../../../shared/locales.ts';
export const LocaleContext = createContext({
  language: 'en' as LocaleCode,
  store: new TranslationStore('en'),
  choose: () => {},
  change: async (_code: LocaleCode) => {},
});
export const TranslationDisabled = createContext(false);
export const useLocale = () => useContext(LocaleContext);
