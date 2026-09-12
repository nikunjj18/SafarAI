import {
  Children,
  createElement,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { LocaleContext, TranslationDisabled } from './context.ts';

// A React render boundary, not a DOM mutation observer. Event handlers, keys, refs,
// controlled values and React-owned nodes are left intact when text changes.
export function LocalizedHost({
  tag,
  elementProps,
}: {
  tag: string;
  elementProps: Record<string, any>;
}) {
  const [validationError, setValidationError] = useState(false);
  const { store } = useContext(LocaleContext);
  const inherited = useContext(TranslationDisabled);
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const disabled =
    elementProps.translate === 'no' ||
    (inherited && elementProps.translate !== 'yes') ||
    ['pre', 'code', 'script', 'style'].includes(tag);
  const props = { ...elementProps };
  const content =
    props['data-localize-content'] === true || props['data-localize-content'] === 'true';
  delete props['data-localize-content'];
  const localize = (value: string) => (disabled ? value : store.lookup(value, content));
  for (const key of ['title', 'placeholder', 'aria-label', 'alt'])
    if (typeof props[key] === 'string') props[key] = localize(props[key]);
  if (!disabled && tag !== 'textarea') props.children = translateChildren(props.children, localize);
  if (tag === 'form') {
    props.noValidate = true;
    props.onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
      if (!event.currentTarget.checkValidity()) {
        event.preventDefault();
        setValidationError(true);
        event.currentTarget.querySelector<HTMLElement>(':invalid')?.focus();
        return;
      }
      setValidationError(false);
      elementProps.onSubmit?.(event);
    };
    if (validationError)
      props.children = [
        props.children,
        createElement(
          'p',
          { key: 'validation', role: 'alert', className: 'field-error' },
          store.lookup('Please complete all required fields with valid values.'),
        ),
      ];
  }
  const { children, ...attributes } = props;
  const native = Array.isArray(children)
    ? createElement(tag, attributes, ...children)
    : createElement(tag, props);
  return disabled !== inherited
    ? createElement(TranslationDisabled.Provider, { value: disabled }, native)
    : native;
}
function translateChildren(children: ReactNode, translate: (s: string) => string): ReactNode {
  if (typeof children === 'string') return translate(children);
  if (!Array.isArray(children)) return children;
  // Translate consecutive text together, preserving grammar around conditional fragments.
  const result: ReactNode[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      result.push(translate(text));
      text = '';
    }
  };
  for (const child of Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') text += String(child);
    else {
      flush();
      result.push(child);
    }
  }
  flush();
  return result;
}
