import type { ReactNode } from 'react';
export const stamp = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString(document.documentElement.lang || 'en') : 'Not reported';
export const statusLabel = (s: string) =>
  ({
    unknown: 'Location unknown',
    stale: 'Location stale',
    attention: 'Needs attention',
    within_boundary: 'Within boundary',
    sos: 'Active SOS',
  })[s] || s;
export const nav = (lat: number, lng: number) =>
  'https://www.google.com/maps/dir/?api=1&destination=' +
  encodeURIComponent(lat + ',' + lng) +
  '&travelmode=walking';
export function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="card">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
export type Act = (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
