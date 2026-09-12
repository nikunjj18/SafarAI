import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLocale } from '../i18n/context.ts';
import { statusLabel, stamp } from './ui.tsx';
import type { Snapshot } from '../../../shared/types.ts';
import { displayedBoundaryState } from '../../../shared/boundary.ts';
export function LiveMap({
  data,
  onPick,
}: {
  data: Snapshot;
  onPick: (lat: number, lng: number) => void;
}) {
  const { store } = useLocale(),
    revision = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null),
    fitted = useRef(false),
    pick = useRef(onPick);
  pick.current = onPick;
  const [error, setError] = useState(false);
  const bounds = useRef<L.LatLngBounds | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: [21.4225, 39.8262], zoom: 14, zoomControl: false });
    map.current = m;
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    tiles.on('tileerror', () => setError(true));
    tiles.on('load', () => setError(false));
    layers.current = L.layerGroup().addTo(m);
    m.on('click', (e) => pick.current(e.latlng.lat, e.latlng.lng));
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      fitted.current = false;
    };
  }, []);
  useEffect(() => {
    const m = map.current,
      g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    const area = L.latLngBounds([]);
    const leader = data.members.find((p) => p.id === data.group.leaderId)?.telemetry;
    const anchor = leader || data.group.anchor;
    if (anchor) {
      const circle = L.circle([anchor.lat, anchor.lng], {
        radius: data.group.radius,
        color: '#16a974',
        weight: 2,
        dashArray: '7 6',
        fillColor: '#34d399',
        fillOpacity: 0.12,
      }).addTo(g);
      area.extend(circle.getBounds());
    }
    for (const member of data.members) {
      if (!member.telemetry) continue;
      const t = member.telemetry,
        fresh = Date.now() - Date.parse(t.observedAt) < 120000;
      const state = displayedBoundaryState(member, data);
      const outside = state === 'outside';
      const red = outside || member.status === 'sos';
      const icon = document.createElement('div');
      icon.className =
        'person-pin ' +
        (red
          ? 'outside'
          : state === 'unknown'
            ? 'stale'
            : member.role === 'leader'
              ? 'leader'
              : '');
      const initials = document.createElement('span');
      initials.textContent = member.name
        .trim()
        .split(/\s+/)
        .map((n) => n[0])
        .join('')
        .slice(0, 2);
      icon.append(initials);
      icon.setAttribute('aria-label', member.name);
      const popup = document.createElement('div');
      popup.className = 'person-popup';
      const name = document.createElement('strong');
      name.textContent = member.name;
      popup.append(name);
      const info = document.createElement('p');
      info.textContent =
        store.lookup(member.role === 'leader' ? 'Group leader' : 'Pilgrim') +
        ' · ' +
        store.lookup(outside ? 'Outside boundary' : statusLabel(member.status));
      popup.append(info);
      const time = document.createElement('small');
      time.textContent = stamp(t.observedAt) + ' · ± ' + Math.round(t.accuracy) + ' m';
      popup.append(time);
      const call = document.createElement('a');
      call.href = 'tel:' + member.phone;
      call.className = 'map-call';
      call.textContent = store.lookup('Call');
      popup.append(call);
      L.marker([t.lat, t.lng], {
        icon: L.divIcon({
          html: icon,
          className: 'person-marker',
          iconSize: [28, 36],
          iconAnchor: [14, 36],
        }),
        title: member.name,
        keyboard: true,
      })
        .bindPopup(popup)
        .addTo(g);
      area.extend([t.lat, t.lng]);
    }
    for (const point of data.meetingPoints) {
      const label = document.createElement('span');
      label.textContent = store.lookup(point.name, true);
      L.circleMarker([point.lat, point.lng], {
        radius: 7,
        color: '#fff',
        fillColor: '#d99b26',
        fillOpacity: 1,
      })
        .bindTooltip(label)
        .addTo(g);
      area.extend([point.lat, point.lng]);
    }
    bounds.current = area.isValid() ? area : null;
    if (area.isValid() && !fitted.current) {
      m.fitBounds(area, { padding: [55, 55], maxZoom: 17 });
      fitted.current = true;
    }
  }, [data, revision, store]);
  return (
    <div className="map-stage">
      <div ref={el} className="live-map" dir="ltr" role="region" aria-label="Live group map" />
      <div className="map-overlay">
        <span className="map-live-dot" />
        <strong>Live group map</strong>
        <span>
          {data.members.filter((p) => p.telemetry).length} / {data.members.length} sharing
        </span>
      </div>
      <div className="map-buttons">
        <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
          +
        </button>
        <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
          −
        </button>
        <button
          onClick={() => {
            if (bounds.current)
              map.current?.fitBounds(bounds.current, { padding: [55, 55], maxZoom: 17 });
          }}
        >
          Show group
        </button>
      </div>
      <div className="map-legend">
        <span>● Leader</span>
        <span>● Group member</span>
        <span>● Outside boundary / SOS</span>
      </div>
      {error && <p className="notice error">Map tiles could not load. Check your connection.</p>}
    </div>
  );
}
