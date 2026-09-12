import { useState } from 'react';
import { Shield } from 'lucide-react';
import { api } from '../lib/api.ts';
import { LanguageSelect } from '../components/LanguageProvider.tsx';
import { Card, Input } from '../components/ui.tsx';
export function SafetyView() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api('/safety/report', 'POST', {
        groupCode: f.get('groupCode'),
        pin: f.get('pin'),
        message: f.get('message'),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="safety-page">
      <div className="brand">
        <Shield /> SAFAR<span>AI</span>
      </div>
      <Card title="Tell your group you are safe">
        <LanguageSelect />
        <p>
          Use your group invitation code and personal Safety PIN. You do not need to sign in on this
          phone.
        </p>
        {done ? (
          <div className="notice" role="status">
            Your check-in reached the group feed. Ask the leader to confirm it. Existing SOS cases
            remain open.
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <Input label="Group invitation code" name="groupCode" required maxLength={30} />
              <Input
                label="Your 5-digit Safety PIN"
                name="pin"
                maxLength={5}
                inputMode="numeric"
                type="password"
                pattern="[0-9]{5}"
                required
                autoComplete="off"
              />
              <Input label="A message for your leader" name="message" maxLength={500} required />
              <button className="primary wide">Send my safety check-in</button>
            </fieldset>
          </form>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <a className="button" href="/">
          Back to sign in
        </a>
      </Card>
    </main>
  );
}
