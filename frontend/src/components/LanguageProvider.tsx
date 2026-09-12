/** @jsxImportSource react */
import { useMemo, useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Globe2, Check, ArrowRight, Shield } from 'lucide-react';
import { LOCALES, isLocale, isRtl, localeInfo, type LocaleCode } from '../../../shared/locales.ts';
import { LocaleContext } from '../i18n/context.ts';
import { useLocale } from '../i18n/context.ts';
import { TranslationStore } from '../i18n/store.ts';
const STORAGE = 'safarai.language.v1';
function saved() {
  try {
    return localStorage.getItem(STORAGE);
  } catch {
    return null;
  }
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<LocaleCode>(() => {
    const s = saved();
    return isLocale(s) ? s : 'en';
  });
  const store = useMemo(() => new TranslationStore(language), [language]);
  const change = async (code: LocaleCode) => {
    try {
      localStorage.setItem(STORAGE, code);
    } catch {}
    setLanguage(code);
  };
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr';
    document.title = 'SafarAI';
  }, [language]);
  return (
    <LocaleContext.Provider value={{ language, store, choose: () => {}, change }}>
      <TranslationStatus store={store} />
      {children}
    </LocaleContext.Provider>
  );
}
export function LanguageSelect() {
  const { language, change, store } = useLocale();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return (
    <label className="field">
      <span>{store.lookup('Preferred language')}</span>
      <select
        aria-label={store.lookup('Preferred language')}
        value={language}
        disabled={busy}
        onChange={async (e) => {
          const code = e.target.value as LocaleCode;
          setBusy(true);
          setError(false);
          try {
            await change(code);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {LOCALES.map(([code, , name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {error && <small role="alert">{localeInfo(language)[6]}</small>}
    </label>
  );
}
function TranslationStatus({ store }: { store: TranslationStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const native = localeInfo(store.language);
  if (!store.error) return null;
  return (
    <div translate="no" className="translation-status error" role="alert">
      <span>{native[6]}</span>
      {store.error && <button onClick={store.retry}>{native[7]}</button>}
    </div>
  );
}
