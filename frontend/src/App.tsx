import { useState, useEffect, useCallback, useRef } from 'react';
import './styles/maps.css';
import {
  Shield,
  Home,
  Users,
  Compass,
  Sparkles,
  Settings,
  Bell,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError, setCsrf } from './lib/api.ts';
import { SafetyView } from './views/SafetyView.tsx';
import { AuthView } from './views/AuthView.tsx';
import { LocalSetupView } from './views/LocalSetupView.tsx';
import { HomeView, GroupView } from './views/GroupViews.tsx';
import { JourneyView } from './views/JourneyView.tsx';
import { CopilotView } from './views/CopilotView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { Card, Empty, stamp, type Act } from './components/ui.tsx';
import { useLocale } from './i18n/context.ts';
import { useLocation } from './hooks/useLocation.ts';
import type { User, Snapshot } from '../../shared/types.ts';
export default function App() {
  const { language, store } = useLocale();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const boot = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api<{ user: User; csrf: string }>('/auth/me');
      setCsrf(r.csrf);
      if (r.user.profile.language !== language)
        await api('/profile/language', 'PATCH', { language });
      setUser({ ...r.user, profile: { ...r.user.profile, language } });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    if (user && user.profile.language !== language)
      void api('/profile/language', 'PATCH', { language })
        .then(() => setUser((u) => (u ? { ...u, profile: { ...u.profile, language } } : u)))
        .catch((e) => setError(e.message));
  }, [language, user]);
  if (new URLSearchParams(location.search).has('safety')) return <SafetyView />;
  if (new URLSearchParams(location.search).has('setup')) return <LocalSetupView />;
  if (loading)
    return (
      <main className="loading">
        <Shield />
        <p>Connecting to SafarAI…</p>
      </main>
    );
  if (error)
    return (
      <main className="loading">
        <h1>Could not connect</h1>
        <p role="alert">{error}</p>
        <button onClick={() => void boot()}>Retry connection</button>
      </main>
    );
  return user ? (
    <Workspace
      key={user.id}
      user={user}
      logout={() => {
        setCsrf('');
        store.clearPrivate();
        setUser(null);
      }}
    />
  ) : (
    <AuthView onLogin={setUser} />
  );
}
function Workspace({ user, logout }: { user: User; logout: () => void }) {
  const { store } = useLocale();
  const [data, setData] = useState<Snapshot | null>(null),
    [tab, setTab] = useState('home'),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [sync, setSync] = useState('Connecting'),
    [notifications, setNotifications] = useState(false);
  const mounted = useRef(true),
    loading = useRef(false),
    queued = useRef(false),
    streamOpen = useRef(false);
  const seen = useRef<Set<string> | null>(null);
  const report = useCallback((message: string) => setError(message), []);
  const { sharing, setSharing, locationStatus, requestLocation } = useLocation(
    user.id,
    report,
    !!user.profile.simulator,
  );
  const refresh = useCallback(async () => {
    if (loading.current) {
      queued.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        queued.current = false;
        const state = await api<Snapshot>('/state');
        if (state.user.id !== user.id) {
          setSharing(false);
          setError(
            'Another account signed in using this browser. Refresh to use that account. Use separate browser profiles or devices to track multiple pilgrims.',
          );
          return;
        }
        if (mounted.current) {
          setData(state);
          setSync(streamOpen.current ? 'Live updates' : 'Connected · periodic refresh');
        }
      } while (queued.current && mounted.current);
    } catch (e) {
      if (mounted.current) {
        setSync('Disconnected · data may be stale');
        if (e instanceof ApiError && e.status === 401) logout();
        else setError((e as Error).message);
      }
    } finally {
      loading.current = false;
    }
  }, [logout]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const stream = new EventSource('/api/events');
    stream.onopen = () => {
      streamOpen.current = true;
      setSync('Live updates');
    };
    stream.addEventListener('change', () => void refresh());
    stream.onerror = () => {
      streamOpen.current = false;
      setSync('Reconnecting · periodic refresh');
    };
    const pulse = () => {
      void api('/heartbeat', 'POST')
        .then(() => refresh())
        .catch(() => void refresh());
    };
    pulse();
    const timer = setInterval(pulse, 15000);
    const resume = () => {
      if (document.visibilityState === 'visible') pulse();
    };
    window.addEventListener('online', pulse);
    document.addEventListener('visibilitychange', resume);
    return () => {
      mounted.current = false;
      stream.close();
      clearInterval(timer);
      window.removeEventListener('online', pulse);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [tab, notifications]);
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.bulletins.map((b) => b.id));
    if (seen.current && data.user.profile.notifications) {
      for (const b of data.bulletins.filter(
        (b) => !seen.current!.has(b.id) && !b.read && b.actorId !== user.id,
      )) {
        if ('Notification' in window && Notification.permission === 'granted')
          void Promise.all([store.translate(b.title, true), store.translate(b.message, true)])
            .then(([title, body]) => new Notification(title, { body, tag: b.id }))
            .catch(() => {});
        navigator.vibrate?.([150, 80, 150]);
      }
    }
    seen.current = ids;
    const theme = data.user.profile.theme;
    document.documentElement.dataset.theme = 'dark';
  }, [data, user.id, store]);
  const act: Act = async (fn, success) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function stopSharing() {
    setSharing(false);
    await act(() => api('/telemetry', 'DELETE'), 'Shared location removed.');
  }
  if (!data)
    return (
      <main className="loading">
        <Shield />
        <p>{error || 'Loading your group…'}</p>
        <button onClick={() => void refresh()}>Retry</button>
        <button
          onClick={() =>
            void act(async () => {
              await api('/auth/logout', 'POST');
              logout();
            })
          }
        >
          Sign out
        </button>
      </main>
    );
  const unread = data.bulletins.filter((b) => !b.read).length;
  const navItems = [
    ['home', 'Home', Home],
    ['group', 'Group', Users],
    ['journey', 'Journey', Compass],
    ['copilot', 'Copilot', Sparkles],
    ['more', 'More', Settings],
  ] as const;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Shield /> SAFAR<span>AI</span>
          <small>PILGRIM GUARDIAN</small>
        </div>
        <div className="top-actions">
          <span className={'sync ' + (sync === 'Live updates' ? 'live' : '')}>{sync}</span>
          <button
            className="icon"
            title="Refresh group"
            aria-label="Refresh group"
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="icon"
            aria-label="Notifications"
            onClick={() => setNotifications(!notifications)}
          >
            <Bell size={19} />
            {unread > 0 && <b className="count">{unread}</b>}
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">YOUR COMPANION</p>
          {navItems.map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
              <Icon size={20} />
              {label}
            </button>
          ))}
          <div className="sidebar-footer">
            <strong translate="no">{data.user.name}</strong>
            <small>
              {data.user.role === 'leader' ? 'Group leader' : 'Pilgrim'} ·{' '}
              <span translate="no">{data.group.name}</span>
            </small>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api('/auth/logout', 'POST');
                  logout();
                })
              }
            >
              <LogOut size={17} />
              Sign out
            </button>
          </div>
        </aside>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow" translate="no">
                {data.group.name}
              </p>
              <h1>
                {tab === 'home'
                  ? 'Your journey, together'
                  : tab === 'group'
                    ? 'People beside you'
                    : tab === 'journey'
                      ? 'A shared direction'
                      : tab === 'copilot'
                        ? 'Ask SafarAI'
                        : 'Make it yours'}
              </h1>
            </div>
            <span className="role">{data.user.role === 'leader' ? 'LEADER' : 'PILGRIM'}</span>
          </div>
          {user.profile.simulator && (
            <p className="notice">
              Nokia simulator mode · positions come from your Nokia test device, not live pilgrim
              GPS.
            </p>
          )}
          {locationStatus && (
            <p className="fine" role="status">
              {locationStatus}
            </p>
          )}
          {(!sharing || locationStatus) && !data.user.profile.simulator && (
            <button onClick={requestLocation}>Share my location</button>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button aria-label="Dismiss message" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {notifications ? (
            <Card
              title="Your notifications"
              action={<button onClick={() => setNotifications(false)}>Close</button>}
            >
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => void act(() => api('/notifications/read', 'POST'))}
                >
                  Mark all read
                </button>
                <button
                  disabled={busy}
                  onClick={() => void act(() => api('/notifications', 'DELETE'))}
                >
                  Clear my feed
                </button>
              </div>
              {data.bulletins.length ? (
                data.bulletins.map((b) => (
                  <article className="feed-item" key={b.id}>
                    <span className={'dot ' + b.kind} />
                    <div>
                      <strong data-localize-content="true">
                        {b.title}
                        {!b.read ? ' •' : ''}
                      </strong>
                      <p data-localize-content="true">{b.message}</p>
                      <small>
                        <time translate="no">{stamp(b.createdAt)}</time>
                      </small>
                    </div>
                  </article>
                ))
              ) : (
                <Empty>Your feed is clear. New group messages and alerts will appear here.</Empty>
              )}
            </Card>
          ) : (
            <>
              {tab === 'home' && (
                <HomeView
                  data={data}
                  busy={busy}
                  act={act}
                  sharing={sharing}
                  startSharing={() => {
                    void act(async () => {
                      await api('/telemetry/start', 'POST');
                      setSharing(true);
                    });
                  }}
                  stopSharing={() => void stopSharing()}
                  navigate={setTab}
                />
              )}
              {tab === 'group' && <GroupView data={data} busy={busy} act={act} />}
              {tab === 'journey' && (
                <JourneyView
                  data={data}
                  busy={busy}
                  act={act}
                  sharing={sharing}
                  stopSharing={() => void stopSharing()}
                  startSharing={() => {
                    void act(async () => {
                      await api('/telemetry/start', 'POST');
                      setSharing(true);
                    });
                  }}
                />
              )}
              {tab === 'copilot' && (
                <CopilotView
                  data={data}
                  busy={busy}
                  act={act}
                  executeAction={async (action) => {
                    if (action.type === 'send_sos') {
                      await api('/sos', 'POST', {});
                      setNotice('SOS saved to your group feed.');
                      await refresh();
                    } else if (action.type === 'share_location') {
                      requestLocation();
                      setTab('journey');
                    } else if (action.type === 'stop_location') {
                      setSharing(false);
                      await api('/telemetry', 'DELETE');
                      await refresh();
                    } else if (action.href) {
                      if (action.type === 'call' && /^tel:\+[0-9]+$/.test(action.href))
                        location.assign(action.href);
                      else if (
                        action.type === 'map' &&
                        action.href.startsWith('https://www.google.com/maps/')
                      )
                        location.assign(action.href);
                    }
                  }}
                />
              )}
              {tab === 'more' && (
                <>
                  <SettingsView data={data} busy={busy} act={act} />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api('/auth/logout', 'POST');
                        logout();
                      })
                    }
                  >
                    <LogOut size={17} />
                    Sign out
                  </button>
                </>
              )}
            </>
          )}
        </main>
      </div>
      <nav className="mobile-nav">
        {navItems.map(([id, label, Icon]) => (
          <button
            key={id}
            className={tab === id ? 'selected' : ''}
            onClick={() => {
              setNotifications(false);
              setTab(id);
            }}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
