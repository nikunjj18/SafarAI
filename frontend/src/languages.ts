import { LOCALES, isRtl } from '../../shared/locales.ts';
export const PROMINENT_LANGUAGES = LOCALES.map(([code, name, native]) => ({
  code,
  name,
  native,
  isRTL: isRtl(code),
}));
