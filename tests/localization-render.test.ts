import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalizedHost } from '../frontend/src/i18n/host.ts';
import { LocaleContext } from '../frontend/src/i18n/context.ts';
import { TranslationStore } from '../frontend/src/i18n/store.ts';
let nextKey = 0;
const host = (tag: string, elementProps: Record<string, unknown>) =>
  createElement(LocalizedHost, { key: String(nextKey++), tag, elementProps });

test('React localization renders Arabic labels and accessibility text, preserving sensitive input values and identifiers', () => {
  const store = new TranslationStore('ar');
  store.cache.set('en:Sign in', 'تسجيل الدخول');
  store.cache.set('en:Password', 'كلمة المرور');
  store.cache.set('en:Welcome back', 'مرحبًا بعودتك');
  const body = host('section', {
    children: [
      host('h1', { children: 'Welcome back' }),
      host('button', { 'aria-label': 'Sign in', children: 'Sign in' }),
      host('input', {
        type: 'password',
        value: 'private-password-123',
        'aria-label': 'Password',
        readOnly: true,
      }),
      host('span', { translate: 'no', children: 'ABC123' }),
      host('pre', { children: '{"providerId":"original-id"}' }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { language: 'ar', store, choose() {}, async change() {} } },
      body,
    ),
  );
  assert.match(html, /تسجيل الدخول/);
  assert.match(html, /aria-label="كلمة المرور"/);
  assert.match(html, /مرحبًا بعودتك/);
  assert.match(html, /private-password-123/);
  assert.match(html, /ABC123/);
  assert.match(html, /original-id/);
  assert.equal(store.pending.size, 0);
  assert.doesNotMatch(html, />Sign in</);
});

test('dynamic translated content is rendered as escaped text, never executable markup', () => {
  const store = new TranslationStore('en');
  store.cache.set('auto:Shared message', '<img src=x onerror=alert(1)>');
  const body = host('p', { 'data-localize-content': 'true', children: 'Shared message' });
  const html = renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { language: 'en', store, choose() {}, async change() {} } },
      body,
    ),
  );
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});
