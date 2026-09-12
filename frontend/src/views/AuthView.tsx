import { useState } from 'react';
import { Shield, ArrowRight } from 'lucide-react';
import { api, setCsrf } from '../lib/api.ts';
import { Input } from '../components/ui.tsx';
import { LanguageSelect } from '../components/LanguageProvider.tsx';
import { useLocale } from '../i18n/context.ts';
import type { User } from '../../../shared/types.ts';
import hero from '../assets/hero.jpg';
export function AuthView({ onLogin }: { onLogin: (user: User) => void }) {
  const { language } = useLocale();
  const invite = new URLSearchParams(location.search).get('join') || '';
  const [mode, setMode] = useState<'login' | 'register'>(invite ? 'register' : 'login');
  const [role, setRole] = useState<'pilgrim' | 'leader'>('pilgrim');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { email: f.get('email'), password: f.get('password') };
    if (mode === 'register')
      Object.assign(body, {
        name: f.get('name'),
        phone: f.get('phone'),
        role,
        language,
        simulator: f.get('simulator') === 'on',
        ...(role === 'leader'
          ? { groupName: f.get('groupName') }
          : { groupCode: f.get('groupCode') }),
      });
    try {
      const r = await api<{ user: User; csrf: string }>('/auth/' + mode, 'POST', body);
      setCsrf(r.csrf);
      await api('/profile/language', 'PATCH', { language });
      onLogin({ ...r.user, profile: { ...r.user.profile, language } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div
        className="auth-visual"
        style={{ backgroundImage: 'linear-gradient(180deg,transparent,#0c1110),url(' + hero + ')' }}
      >
        <div className="brand">
          <Shield /> SAFAR<span>AI</span>
        </div>
        <div>
          <p className="eyebrow">YOUR JOURNEY. TOGETHER.</p>
          <h1>
            A little closer.
            <br />
            Every step.
          </h1>
          <p>
            Stay connected to your pilgrimage group with shared locations, clear meeting points, and
            a direct way to ask for help.
          </p>
        </div>
      </div>
      <section className="auth-form">
        <div className="brand mobile-brand">
          <Shield /> SAFAR<span>AI</span>
        </div>
        <p className="eyebrow">PILGRIM GUARDIAN</p>
        <h1>{mode === 'login' ? 'Welcome back' : 'Begin your journey'}</h1>
        <p className="muted">
          {mode === 'login'
            ? 'Sign in to your group.'
            : 'Leaders create a group. Pilgrims join with an invitation code.'}
        </p>
        <div className="segmented">
          <button
            type="button"
            className={mode === 'login' ? 'selected' : ''}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'selected' : ''}
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>
        <LanguageSelect />
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {mode === 'register' && (
              <>
                <label className="field">
                  <span>Your role</span>
                  <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="pilgrim">Pilgrim · join a group</option>
                    <option value="leader">Leader · create a group</option>
                  </select>
                </label>
                <Input label="Full name" name="name" required maxLength={100} autoComplete="name" />
                <Input
                  label="Phone with country code"
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                />
                <label className="check">
                  <input type="checkbox" name="simulator" />
                  Test with Nokia simulator
                </label>
                <p className="fine">
                  Enter the simulator phone number supplied by Nokia above, including country code.
                  This authorizes location requests for that test number using the saved Nokia key.
                  Simulator mode uses Nokia test positions instead of this device GPS.
                </p>
                {role === 'leader' ? (
                  <Input label="Group name" name="groupName" required maxLength={100} />
                ) : (
                  <Input
                    label="Group invitation code"
                    name="groupCode"
                    defaultValue={invite}
                    required
                    maxLength={30}
                  />
                )}
              </>
            )}
            <Input label="Email" name="email" type="email" required autoComplete="email" />
            <Input
              label={mode === 'register' ? 'Password · at least 12 characters' : 'Password'}
              name="password"
              type="password"
              required
              minLength={mode === 'register' ? 12 : 1}
              maxLength={128}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <button className="primary wide" type="submit">
              {busy ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'}
              <ArrowRight size={18} />
            </button>
          </fieldset>
        </form>
        <a className="text-link" href="/?safety=1">
          Using a borrowed phone? Send a Safety PIN check-in
        </a>
        <p className="fine">
          Group members can see your name, phone number, and any location you choose to share.
          Shared messages and journey text are sent to the configured translation service when
          needed. Passwords and private medical notes are excluded.
        </p>
      </section>
    </main>
  );
}
