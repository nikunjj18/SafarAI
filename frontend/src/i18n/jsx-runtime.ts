import { jsx as reactJsx, jsxs as reactJsxs, Fragment } from 'react/jsx-runtime';
import { LocalizedHost } from './host.ts';
export { Fragment };
export type { JSX } from 'react';
export const jsx: typeof reactJsx = (type, props, key) =>
  typeof type === 'string'
    ? reactJsx(LocalizedHost, { tag: type, elementProps: props }, key)
    : reactJsx(type, props, key);
export const jsxs: typeof reactJsxs = (type, props, key) =>
  typeof type === 'string'
    ? reactJsxs(LocalizedHost, { tag: type, elementProps: props }, key)
    : reactJsxs(type, props, key);
