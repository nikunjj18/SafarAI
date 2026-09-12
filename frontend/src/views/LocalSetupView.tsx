/** @jsxImportSource react */
import { useEffect, useState } from 'react';
type Setup = {
  token: string;
  provider: string;
  geminiModel: string;
  groqModel: string;
  configured: {
    gemini: boolean;
    groq: boolean;
    nokia: boolean;
    googlePlaces: boolean;
    googleMaps: boolean;
  };
};
export function LocalSetupView() {
  const [setup, setSetup] = useState<Setup | null>(null),
    [provider, setProvider] = useState('gemini'),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/local-setup')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Local setup is unavailable.');
        setSetup(d);
        setProvider(d.provider);
      })
      .catch((e) => setStatus(e.message));
  }, []);
  return (
    <main className="loading">
      <section style={{ width: 'min(100%,520px)', textAlign: 'left' }}>
        <h1>Local API setup</h1>
        <p>
          Save keys to this computer’s project .env. Blank key fields keep existing keys. Saved keys
          are never displayed.
        </p>
        {setup && (
          <form
            autoComplete="off"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              setBusy(true);
              setStatus('');
              try {
                const data = new FormData(form);
                const body = Object.fromEntries([...data.entries()].filter(([, v]) => v !== ''));
                const r = await fetch('/api/local-setup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Local-Setup-Token': setup.token,
                  },
                  body: JSON.stringify(body),
                });
                const result = await r.json();
                if (!r.ok) throw new Error(result.error || 'Could not save configuration.');
                form.reset();
                setStatus('Saved. Your keys are active now. Open SafarAI to test Copilot.');
              } catch (error) {
                setStatus((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              AI provider
              <select
                name="AI_PROVIDER"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="gemini">Gemini</option>
                <option value="groq">Groq</option>
              </select>
            </label>
            <label className="field">
              {provider === 'gemini' ? 'Gemini' : 'Groq'} API key ·{' '}
              {setup.configured[provider as 'gemini' | 'groq'] ? 'already saved' : 'not configured'}
              <input
                key={provider}
                type="password"
                name={provider === 'gemini' ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'}
                autoComplete="new-password"
                placeholder="Paste API key"
                spellCheck={false}
              />
            </label>
            <label className="field">
              Model enabled in your account
              <input
                key={provider + 'model'}
                name={provider === 'gemini' ? 'GEMINI_MODEL' : 'GROQ_MODEL'}
                defaultValue={provider === 'gemini' ? setup.geminiModel : setup.groqModel}
                required
                spellCheck={false}
              />
            </label>
            <label className="field">
              Nokia RapidAPI key ·{' '}
              {setup.configured.nokia ? 'already saved' : 'optional for AI-only testing'}
              <input
                type="password"
                name="NOKIA_RAPIDAPI_KEY"
                autoComplete="new-password"
                placeholder="Paste Nokia key"
                spellCheck={false}
              />
            </label>
            <label className="field">
              Google Places API key (server) ·{' '}
              {setup.configured.googlePlaces ? 'saved' : 'not configured'}
              <input
                type="password"
                name="GOOGLE_PLACES_API_KEY"
                autoComplete="new-password"
                placeholder="Paste Places API key"
              />
            </label>
            <label className="field">
              Google Maps JavaScript key (browser) ·{' '}
              {setup.configured.googleMaps ? 'saved' : 'not configured'}
              <input
                type="password"
                name="GOOGLE_MAPS_BROWSER_KEY"
                autoComplete="new-password"
                placeholder="Paste Maps JavaScript API key"
              />
            </label>
            <p>
              Enable Places API (New) for the server key and Maps JavaScript API for the browser
              key. Restrict the browser key to this website; it is used by the map in your browser.
              The Places key remains on the server.
            </p>
            <p>
              Your selected AI provider will also translate the interface. Nokia services
              additionally require enabled subscriptions and subscriber consent.
            </p>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save keys'}
            </button>
          </form>
        )}
        {status && <p role="status">{status}</p>}
        <p>
          <a href="/">Open SafarAI</a>
        </p>
      </section>
    </main>
  );
}
