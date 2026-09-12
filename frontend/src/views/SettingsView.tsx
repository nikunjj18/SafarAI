import { LanguageSelect } from '../components/LanguageProvider.tsx';
import { useState, useEffect } from 'react';
import { api } from '../lib/api.ts';
import { Card, Input, type Act } from '../components/ui.tsx';
import { useLocale } from '../i18n/context.ts';

import type { Snapshot, Profile } from '../../../shared/types.ts';
export function SettingsView({ data, busy, act }: { data: Snapshot; busy: boolean; act: Act }) {
  const { language } = useLocale();
  const [helpdesk, setHelpdesk] = useState(data.group.helpdeskPhone || '');
  const [safety, setSafety] = useState<{ pin: string; groupCode: string; url: string } | null>(
    null,
  );
  const [profile, setProfile] = useState<Profile>(data.user.profile),
    [name, setName] = useState(data.user.name);
  useEffect(() => setProfile((p) => ({ ...p, language })), [language]);
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));
  async function enableNotifications() {
    if (!('Notification' in window))
      throw new Error('Browser notifications are unavailable. In-app alerts still work.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted')
      throw new Error(
        'Notification permission was not granted. Enable it in browser settings to receive browser alerts.',
      );
    set('notifications', true);
  }
  return (
    <>
      <div className="grid two">
        <Card title="Your profile">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api('/profile', 'PATCH', { name, profile }), 'Profile saved.');
            }}
          >
            <fieldset disabled={busy}>
              <Input
                label="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
              <p className="fine" translate="no" dir="ltr">
                {data.user.email} · {data.user.phone}
              </p>
              <LanguageSelect />
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.networkConsent}
                  onChange={(e) => set('networkConsent', e.target.checked)}
                />
                I consent to requesting carrier data for my registered phone. My operator may
                require additional consent.
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.notifications}
                  onChange={(e) => set('notifications', e.target.checked)}
                />
                Show browser notifications while this app is open
              </label>
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    void act(
                      enableNotifications,
                      'Browser permission granted. Save your profile to enable alerts.',
                    )
                  }
                >
                  Enable browser permission
                </button>
                <button className="primary">Save profile</button>
              </div>
            </fieldset>
          </form>
          {/^[+\d\s()-]{3,30}$/.test(data.user.profile.emergencyContact) && (
            <a
              className="button"
              href={'tel:' + data.user.profile.emergencyContact.replace(/[^+\d]/g, '')}
            >
              Call my emergency contact
            </a>
          )}
        </Card>
        {data.user.role === 'leader' && (
          <Card title="Group helpdesk">
            <p>Set the number your group leader should call when further assistance is needed.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  () => api('/group/helpdesk', 'PATCH', { phone: helpdesk }),
                  'Helpdesk number saved.',
                );
              }}
            >
              <Input
                label="Helpdesk phone with country code"
                type="tel"
                value={helpdesk}
                onChange={(e) => setHelpdesk(e.target.value)}
                placeholder="+ country code and phone number"
                pattern="\+[1-9][0-9]{6,14}"
                maxLength={16}
              />
              <p className="fine">
                Leave blank and save to remove the number. Calls open your device dialer.
              </p>
              <button disabled={busy} className="primary">
                Save helpdesk number
              </button>
            </form>
          </Card>
        )}
        <Card title="Your 5-digit Safety PIN">
          <p>
            Use this PIN and your group code to send a safety check-in from another phone. Creating
            a new PIN replaces your previous PIN.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                setSafety(await api('/safety/pin', 'POST', {}));
              }, 'Safety PIN created.')
            }
          >
            Create or replace Safety PIN
          </button>
          {safety && (
            <div className="notice">
              <strong translate="no" dir="ltr" style={{ fontSize: 30, letterSpacing: 8 }}>
                {safety.pin}
              </strong>
              <p>
                Group code: <span translate="no">{safety.groupCode}</span>
              </p>
              <a href={safety.url} target="_blank" rel="noreferrer">
                Open safety check-in
              </a>
              <p className="fine">
                Keep this PIN private. It is shown here only until you leave this page.
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
