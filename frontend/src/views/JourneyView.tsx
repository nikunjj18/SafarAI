import { usableMeetingAnchor } from '../../../shared/locationReference.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Card, stamp, type Act } from '../components/ui.tsx';
import { LiveMap } from '../components/LiveMap.tsx';
import { GoogleGroupMap, type DynamicMeeting } from '../components/GoogleGroupMap.tsx';
import { coordinateDistance } from '../../../shared/boundary.ts';
import type { Snapshot } from '../../../shared/types.ts';
export function JourneyView({
  data,
  busy,
  act,
  sharing,
  startSharing,
  stopSharing,
}: {
  data: Snapshot;
  busy: boolean;
  act: Act;
  sharing: boolean;
  startSharing: () => void;
  stopSharing: () => void;
}) {
  const [config, setConfig] = useState<{ browserKey: string; placesConfigured: boolean } | null>(
      null,
    ),
    [meeting, setMeeting] = useState<DynamicMeeting | null>(null),
    [error, setError] = useState(''),
    [finding, setFinding] = useState(false);
  const pending = useRef(false),
    active = useRef(true),
    currentMeeting = useRef<DynamicMeeting | null>(null);
  const find = useCallback(async (manual = false) => {
    if (pending.current) return;
    pending.current = true;
    setFinding(manual || !currentMeeting.current);
    setError('');
    try {
      const result = await api<DynamicMeeting>('/journey/meeting-point', 'POST', {
        refresh: manual,
      });
      if (active.current) {
        if (manual && result.placeId === currentMeeting.current?.placeId)
          setError(
            'No different eligible meeting place is available nearby. Keeping the current meeting point.',
          );
        currentMeeting.current = result;
        setMeeting(result);
      }
    } catch (e) {
      if (active.current) {
        setError((e as Error).message);
      }
    } finally {
      pending.current = false;
      if (active.current) setFinding(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void api<{ browserKey: string; placesConfigured: boolean }>('/maps/config')
      .then((c) => {
        if (active.current) setConfig(c);
      })
      .catch((e) => {
        if (active.current) setError(e.message);
      });
    void find();
    const timer = setInterval(() => void find(), 60000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [find]);
  const leader = data.members.find((m) => m.id === data.group.leaderId)?.telemetry;
  const leaderReady = !!leader && (data.demoMode || usableMeetingAnchor(leader));
  useEffect(() => {
    if (leaderReady) void find();
  }, [leaderReady, find]);
  const moved = !!meeting && !!leader && coordinateDistance(meeting, leader) > 600;
  useEffect(() => {
    if (moved) void find();
  }, [moved, find]);
  const validMeeting =
    meeting && Date.parse(meeting.expiresAt) > Date.now() && leaderReady && !moved ? meeting : null;
  return (
    <>
      <Card title="Your dynamic meeting point" action={<span className="badge">AI agent</span>}>
        {finding && !validMeeting ? (
          <p role="status">Finding a real meeting point near your leader…</p>
        ) : validMeeting ? (
          <div className="dynamic-destination">
            <MapPin size={30} />
            <div>
              <p className="eyebrow">MEET YOUR GROUP HERE</p>
              <h2 data-localize-content="true">{validMeeting.name}</h2>
              <p data-localize-content="true">{validMeeting.address}</p>
              <p className="fine">
                {validMeeting.distanceFromLeader} m straight-line distance from the leader · Search
                within 600 m · Google Maps
              </p>
              {validMeeting.crowd.level !== 'unknown' && (
                <div className={'crowd-level ' + validMeeting.crowd.level}>
                  <span>Pedestrian congestion</span>
                  <strong>
                    {validMeeting.crowd.level === 'low'
                      ? 'Low'
                      : validMeeting.crowd.level === 'medium'
                        ? 'Medium'
                        : validMeeting.crowd.level === 'high'
                          ? 'High'
                          : 'Unknown'}
                  </strong>
                </div>
              )}
              {validMeeting.crowd.level !== 'unknown' && (
                <p className="fine" data-localize-content="true">
                  {validMeeting.selectionReason}
                </p>
              )}
              {validMeeting.crowd.observedAt && (
                <p className="fine">
                  Measured by <span data-localize-content="true">{validMeeting.crowd.source}</span>{' '}
                  · <time translate="no">{stamp(validMeeting.crowd.observedAt)}</time>
                </p>
              )}
              <a
                className="button primary"
                href={validMeeting.directionsUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={18} />
                Go there · Google Maps
              </a>
              <p className="fine">
                Check entrances and local access before walking. Selected{' '}
                <time translate="no">{stamp(validMeeting.selectedAt)}</time>.
              </p>
            </div>
          </div>
        ) : (
          <p className="notice" role="status">
            {error || 'Waiting for a current meeting point.'}
          </p>
        )}
        <button disabled={finding} onClick={() => void find(true)}>
          <RefreshCw size={15} />
          Refresh meeting point
        </button>
        {validMeeting && error && (
          <p className="fine" role="status">
            {error}
          </p>
        )}
        {config && !config.placesConfigured && location.hostname === 'localhost' && (
          <a className="button" href="/?setup=1">
            Add Google Maps keys
          </a>
        )}
      </Card>
      <Card title="Your people, on the map" action={<span className="badge">150 m circle</span>}>
        <div className="location-strip">
          <div>
            <strong>
              {sharing ? 'Location sharing enabled' : 'Share your location to appear here'}
            </strong>
            <p>
              The circle follows the leader. Red markers show confirmed outside positions or SOS.
            </p>
          </div>
          <button
            disabled={busy}
            className="primary"
            onClick={sharing ? stopSharing : startSharing}
          >
            {sharing ? 'Stop sharing' : 'Enable live location'}
          </button>
        </div>
        {config?.browserKey ? (
          <GoogleGroupMap data={data} meeting={validMeeting} browserKey={config.browserKey} />
        ) : validMeeting ? (
          <p>
            Add a Google Maps browser key in API setup to show this Google place with your group
            overlays.
          </p>
        ) : (
          <>
            <LiveMap
              data={{ ...data, meetingPoints: [] }}
              onPick={(lat, lng) =>
                window.open(
                  'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            />
            <p className="fine">
              OpenStreetMap preview. Add a Google Maps JavaScript key in API setup for the Google
              map.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
