import { api } from '../lib/api.ts';
import { UI_CATALOG } from '../../../shared/localization/catalog.ts';
import { localeInfo, type LocaleCode } from '../../../shared/locales.ts';
const catalog = new Set<string>(UI_CATALOG);
export const isIdentity = (text: string) =>
  !/[\p{L}]/u.test(text) ||
  /^(?:SAFAR|AI|SAFARAI|SafarAI|Nokia|OpenStreetMap|AlAdhan|Gemini|Groq)$/i.test(text);
export class TranslationStore {
  language: LocaleCode;
  cache = new Map<string, string>();
  pending = new Map<string, { text: string; source: 'en' | 'auto' }>();
  failed = new Set<string>();
  listeners = new Set<() => void>();
  revision = 0;
  working = false;
  error = false;
  scheduled = false;
  constructor(language: LocaleCode) {
    this.language = language;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.revision;
  emit = () => {
    this.revision++;
    this.listeners.forEach((fn) => fn());
  };
  lookup = (value: string, content = false): string => {
    const text = value.trim();
    if (isIdentity(text) || (!content && this.language === 'en')) return value;
    const source = !content && catalog.has(text) ? 'en' : 'auto';
    const key = source + ':' + text;
    const cached = this.cache.get(key);
    if (cached !== undefined) return value.replace(text, cached);
    if (!this.pending.has(key) && !this.failed.has(key)) {
      this.pending.set(key, { text, source });
      if (!this.scheduled && !this.working) {
        this.scheduled = true;
        setTimeout(() => {
          this.scheduled = false;
          void this.flush();
        }, 30);
      }
    }
    return value;
  };
  async flush() {
    if (this.working || !this.pending.size) return;
    this.working = true;
    this.emit();
    try {
      while (this.pending.size) {
        const source = this.pending.values().next().value!.source;
        const batch: [string, { text: string; source: 'en' | 'auto' }][] = [];
        let size = 0;
        for (const pair of this.pending) {
          if (pair[1].source !== source) continue;
          if (batch.length >= 40 || size + pair[1].text.length > 15000) break;
          batch.push(pair);
          size += pair[1].text.length;
        }
        if (!batch.length) {
          const key = this.pending.keys().next().value!;
          this.pending.delete(key);
          this.failed.add(key);
          this.error = true;
          continue;
        }
        batch.forEach(([key]) => this.pending.delete(key));
        try {
          const r = await api<{ translations: string[] }>('/localization/translate', 'POST', {
            language: this.language,
            source,
            texts: batch.map(([, v]) => v.text),
          });
          if (r.translations.length !== batch.length) throw new Error('Invalid translation count');
          batch.forEach(([key], i) => this.cache.set(key, decodeEntities(r.translations[i])));
        } catch {
          batch.forEach(([key]) => this.failed.add(key));
          this.error = true;
        }
        this.emit();
      }
    } finally {
      this.working = false;
      this.emit();
    }
  }
  retry = () => {
    this.failed.clear();
    this.error = false;
    this.emit();
  };
  async translate(text: string, content = false) {
    this.lookup(text, content);
    await this.flush();
    if (this.working)
      await new Promise<void>((resolve) => {
        const unsubscribe = this.subscribe(() => {
          if (!this.working) {
            unsubscribe();
            resolve();
          }
        });
      });
    const source = !content && catalog.has(text.trim()) ? 'en' : 'auto';
    if (this.failed.has(source + ':' + text.trim())) throw new Error(localeInfo(this.language)[6]);
    return this.lookup(text, content);
  }
  clearPrivate = () => {
    for (const key of this.cache.keys()) if (key.startsWith('auto:')) this.cache.delete(key);
    this.failed.clear();
    this.emit();
  };
}
function decodeEntities(value: string) {
  // Providers may escape punctuation. Decode entities only; never interpret or inject HTML.
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,
    (whole, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (named[entity]) return named[entity];
      const n = entity.toLowerCase().startsWith('#x')
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    },
  );
}
