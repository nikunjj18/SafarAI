import { coordinateDistance } from '../../../shared/boundary.ts';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocale } from '../i18n/context.ts';
import { displayedBoundaryState as boundaryState } from '../../../shared/boundary.ts';
import { stamp } from './ui.tsx';
import type { Snapshot } from '../../../shared/types.ts';
export type DynamicMeeting = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  directionsUrl: string;
  selectedAt: string;
  expiresAt: string;
  distanceFromLeader: number;
  crowd: {
    level: 'low' | 'medium' | 'high' | 'unknown';
    source: string | null;
    observedAt: string | null;
  };
  selectionReason: string;
  source: string;
};
let loading: Promise<any> | null = null;
function loadMaps(key: string, language: string) {
  if ((window as any).google?.maps?.marker) return Promise.resolve((window as any).google.maps);
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script'),
        url = new URL('https://maps.googleapis.com/maps/api/js');
      url.search = new URLSearchParams({
        key,
        loading: 'async',
        libraries: 'marker',
        v: 'weekly',
        language,
        callback: 'safaraiGoogleReady',
      }).toString();
      const timer = setTimeout(() => {
        loading = null;
        reject(new Error('Google Maps timed out. Check the Maps JavaScript key and connection.'));
      }, 20000);
      (window as any).safaraiGoogleReady = () => {
        clearTimeout(timer);
        resolve((window as any).google.maps);
      };
      (window as any).gm_authFailure = () => {
        clearTimeout(timer);
        loading = null;
        window.dispatchEvent(new Event('safarai-map-auth-error'));
        reject(
          new Error(
            'Google Maps rejected the browser key. Check API access, billing and website restrictions.',
          ),
        );
      };
      script.async = true;
      script.src = url.href;
      script.onerror = () => {
        clearTimeout(timer);
        loading = null;
        reject(new Error('Google Maps could not load.'));
      };
      document.head.append(script);
    });
  return loading;
}
export function GoogleGroupMap({
  data,
  meeting,
  browserKey,
}: {
  data: Snapshot;
  meeting: DynamicMeeting | null;
  browserKey: string;
}) {
  const { store, language } = useLocale(),
    revision = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const el = useRef<HTMLDivElement>(null),
    map = useRef<any>(null),
    google = useRef<any>(null),
    objects = useRef<any[]>([]),
    fitted = useRef(false),
    bounds = useRef<any>(null),
    leaderBounds = useRef<any>(null),
    focusKey = useRef(''),
    destination = useRef(meeting);
  destination.current = meeting;
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const failed = () =>
      setError(
        'Google Maps rejected the browser key. Check API access, billing and website restrictions.',
      );
    window.addEventListener('safarai-map-auth-error', failed);
    return () => window.removeEventListener('safarai-map-auth-error', failed);
  }, []);
  useEffect(() => {
    let active = true;
    loadMaps(browserKey, language)
      .then((g) => {
        if (!active || !el.current) return;
        google.current = g;
        map.current = new g.Map(el.current, {
          center: { lat: 21.4225, lng: 39.8262 },
          zoom: 14,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: false,
          streetViewControl: false,
          gestureHandling: 'cooperative',
        });
        map.current.addListener('click', (e: any) =>
          window.open(
            destination.current?.directionsUrl ||
              'https://www.google.com/maps/search/?api=1&query=' +
                e.latLng.lat() +
                ',' +
                e.latLng.lng(),
            '_blank',
            'noopener,noreferrer',
          ),
        );
        setReady(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      objects.current.forEach((o) => {
        if ('setMap' in o) o.setMap(null);
        else o.map = null;
      });
      if (map.current && google.current) google.current.event.clearInstanceListeners(map.current);
      map.current = null;
      fitted.current = false;
    };
  }, [browserKey]);
  useEffect(() => {
    const g = google.current,
      m = map.current;
    if (!ready || !g || !m) return;
    objects.current.forEach((o) => {
      if ('setMap' in o) o.setMap(null);
      else o.map = null;
    });
    objects.current = [];
    const b = new g.LatLngBounds();
    const leader = data.members.find((p) => p.id === data.group.leaderId)?.telemetry;
    leaderBounds.current = null;
    if (leader) {
      const fresh = Date.now() - Date.parse(leader.observedAt) < 120000,
        estimated =
          !data.demoMode &&
          (leader.source === 'nokia-simulator' || !fresh || leader.accuracy > 150);
      const circle = new g.Circle({
        map: m,
        center: { lat: leader.lat, lng: leader.lng },
        radius: 150,
        strokeColor: estimated ? '#d4a54d' : '#16a974',
        strokeWeight: 3,
        fillColor: estimated ? '#d4a54d' : '#34d399',
        fillOpacity: 0.13,
        clickable: false,
      });
      objects.current.push(circle);
      b.union(circle.getBounds());
      leaderBounds.current = circle.getBounds();
    }
    function marker(
      lat: number,
      lng: number,
      title: string,
      initials: string,
      style: string,
      body: HTMLElement,
    ) {
      const pin = document.createElement('div');
      pin.className = 'person-pin ' + style;
      const label = document.createElement('span');
      label.textContent = initials;
      pin.append(label);
      const p = new g.marker.AdvancedMarkerElement({
          map: m,
          position: { lat, lng },
          title,
          content: pin,
        }),
        info = new g.InfoWindow({ content: body });
      p.addListener('click', () => info.open({ map: m, anchor: p }));
      objects.current.push(p, {
        setMap() {
          info.close();
        },
      });
      b.extend({ lat, lng });
    }
    for (const member of data.members) {
      if (!member.telemetry) continue;
      const t = member.telemetry,
        state = boundaryState(member, data),
        box = document.createElement('div');
      box.className = 'person-popup';
      const title = document.createElement('strong');
      title.textContent = member.name;
      box.append(title);
      const status = document.createElement('p');
      status.textContent =
        store.lookup(
          state === 'inside'
            ? 'Within 150 m'
            : state === 'outside'
              ? 'Outside 150 m'
              : 'Location uncertain',
        ) +
        ' · ' +
        stamp(t.observedAt);
      box.append(status);
      const call = document.createElement('a');
      call.className = 'map-call';
      call.href = 'tel:' + member.phone;
      call.textContent = store.lookup('Call');
      box.append(call);
      const nearby = data.members.filter(
        (other) =>
          other.id !== member.id && other.telemetry && coordinateDistance(t, other.telemetry) <= 10,
      );
      for (const other of nearby) {
        const row = document.createElement('div');
        row.className = 'nearby-member';
        const name = document.createElement('span');
        name.textContent = other.name;
        const dial = document.createElement('a');
        dial.className = 'map-call';
        dial.href = 'tel:' + other.phone;
        dial.textContent = store.lookup('Call');
        const locate = document.createElement('a');
        locate.href =
          'https://www.google.com/maps/search/?api=1&query=' +
          other.telemetry!.lat +
          ',' +
          other.telemetry!.lng;
        locate.target = '_blank';
        locate.rel = 'noreferrer';
        locate.textContent = store.lookup('View map');
        row.append(name, dial, locate);
        box.append(row);
      }
      marker(
        t.lat,
        t.lng,
        member.name,
        member.name
          .trim()
          .split(/\s+/)
          .map((n) => n[0])
          .join('')
          .slice(0, 2),
        state === 'outside' || member.status === 'sos'
          ? 'outside'
          : state !== 'inside' || (!data.demoMode && member.status === 'stale')
            ? 'stale'
            : member.role === 'leader'
              ? 'leader'
              : '',
        box,
      );
    }
    if (meeting) {
      if (leaderBounds.current) leaderBounds.current.extend({ lat: meeting.lat, lng: meeting.lng });
      const box = document.createElement('div');
      box.className = 'person-popup';
      const name = document.createElement('strong');
      name.textContent = meeting.name;
      box.append(name);
      const link = document.createElement('a');
      link.href = meeting.directionsUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = store.lookup('Walking directions');
      box.append(link);
      marker(meeting.lat, meeting.lng, meeting.name, '★', 'meeting', box);
    }
    bounds.current = b;
    const key = (leader ? 'leader' : 'none') + (meeting ? 'meeting' : '');
    if (!b.isEmpty() && (!fitted.current || focusKey.current !== key)) {
      m.fitBounds(leaderBounds.current || b, 50);
      focusKey.current = key;
      g.event.addListenerOnce(m, 'idle', () => {
        if (m.getZoom() > 18) m.setZoom(18);
      });
      fitted.current = true;
    }
  }, [data, meeting, ready, revision, store]);
  return (
    <>
      <div className="map-stage">
        <div
          ref={el}
          className="live-map"
          dir="ltr"
          role="region"
          aria-label="Google Maps with group members and 150 metre boundary"
        />
        {!ready && !error && <p className="map-overlay">Loading Google Maps…</p>}
        <button
          className="map-fit"
          onClick={() => {
            if (bounds.current && !bounds.current.isEmpty())
              map.current?.fitBounds(bounds.current, 50);
          }}
        >
          Show group
        </button>
        <button
          className="map-leader"
          onClick={() => {
            if (leaderBounds.current) map.current?.fitBounds(leaderBounds.current, 50);
          }}
        >
          Show leader circle
        </button>
      </div>
      {error && <p className="notice error">{error}</p>}
      {!data.demoMode && (
        <p className="fine">Marker status uses reported location freshness and accuracy.</p>
      )}
      <p className="fine">
        {data.demoMode
          ? '150 m around the saved leader centre. Saved positions do not imply live movement.'
          : 'Green circle: fresh leader position. Amber circle: simulator, approximate or last-known centre; it does not confirm who is safe.'}
      </p>
      <p className="fine">
        Tap a member for Call. Tap the map to open Google Maps directions. Live member overlays stay
        in SafarAI.
      </p>
    </>
  );
}
