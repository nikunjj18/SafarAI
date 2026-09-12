import { memberLabel } from '../../../shared/memberPresence.ts';
import { useEffect, useState } from 'react';
import { MapPin, Phone, Shield, Users, TriangleAlert, Radio, Battery } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api.ts';
import { Card, Empty, Input, stamp, statusLabel, nav, type Act } from '../components/ui.tsx';
import { displayedBoundaryState as boundaryState } from '../../../shared/boundary.ts';
import type { Snapshot, Member } from '../../../shared/types.ts';
import hero from '../assets/hero.jpg';
type Props = { data: Snapshot; busy: boolean; act: Act };
export function HomeView({
  data,
  busy,
  act,
  navigate,
}: Props & {
  sharing: boolean;
  startSharing: () => void;
  stopSharing: () => void;
  navigate: (tab: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const leader = data.members.find((m) => m.id === data.group.leaderId);
  const inside = data.members.filter((m) => boundaryState(m, data) === 'inside').length,
    outside = data.members.filter((m) => boundaryState(m, data) === 'outside').length,
    unknown = data.members.length - inside - outside;
  const me = data.members.find((m) => m.id === data.user.id);
  const myBoundary = me ? boundaryState(me, data) : 'unknown';
  const sos = data.incidents.some((i) => i.memberId === data.user.id && !i.resolvedAt);
  return (
    <>
      <section
        className="hero"
        style={{
          backgroundImage:
            'linear-gradient(90deg,rgba(5,25,18,.94),rgba(5,25,18,.2)),url(' + hero + ')',
        }}
      >
        <div>
          <p className="eyebrow">
            ASSALAMU ALAIKUM, <span translate="no">{data.user.name.split(' ')[0]}</span>
          </p>
          <h2>
            One journey.
            <br />
            Always together.
          </h2>
          <p>Your people. Your meeting point. One place.</p>
          <button onClick={() => navigate('journey')}>Open journey</button>
        </div>
      </section>
      <section className={'personal-safety ' + (sos ? 'outside' : myBoundary)}>
        <div className="safety-emblem">
          <Shield size={32} />
        </div>
        <div>
          <p className="eyebrow">
            {data.demoMode ? 'YOUR SAVED POSITION' : 'YOUR GROUP CONNECTION'}
          </p>
          <h2>
            {sos
              ? 'Your SOS is active'
              : myBoundary === 'inside'
                ? 'You are safe within your group'
                : myBoundary === 'outside'
                  ? 'You are outside your group boundary'
                  : 'Waiting for your group location'}
          </h2>
          <p>
            {data.demoMode
              ? 'Based on saved positions · 150 m circle'
              : myBoundary === 'inside'
                ? 'Your latest position is within 150 m of your leader.'
                : 'Open Journey to check your position and contact your leader.'}
          </p>
        </div>
        <button onClick={() => navigate('journey')}>View map</button>
      </section>
      <div className="stats">
        {[
          [Users, data.members.length, 'Group members'],
          [Shield, inside, 'Within boundary'],
          [TriangleAlert, outside, 'Outside boundary'],
          [Radio, unknown, 'Location unknown'],
        ].map(([Icon, count, label]) => {
          const I = Icon as typeof Users;
          return (
            <div
              className={
                'stat ' +
                (label === 'Within boundary'
                  ? 'stat-safe'
                  : label === 'Outside boundary'
                    ? 'stat-risk'
                    : '')
              }
              key={String(label)}
            >
              <I size={19} />
              <strong>{String(count)}</strong>
              <span>{String(label)}</span>
            </div>
          );
        })}
      </div>
      <button
        className="group-summary-plain"
        onClick={() => navigate('group')}
        aria-label="Open group members"
      >
        <span className="eyebrow">GROUP STATUS</span>
        <strong>
          <span translate="no">
            {inside}/{data.members.length}
          </span>{' '}
          members within the radius
        </strong>
        <span className="fine">
          <span translate="no">{outside}</span> outside · <span translate="no">{unknown}</span>{' '}
          unknown · 150 m boundary{data.demoMode ? ' · Saved positions' : ''}
        </span>
        <span className="summary-link">View group</span>
      </button>
      <div className="grid two">
        {data.user.role === 'leader' ? (
          <Card title="Helpdesk">
            <p>Need further assistance? Contact your group’s helpdesk.</p>
            {data.group.helpdeskPhone ? (
              <a className="button wide" href={'tel:' + data.group.helpdeskPhone}>
                <Phone size={18} />
                Call helpdesk
              </a>
            ) : (
              <button className="wide" onClick={() => navigate('more')}>
                Set helpdesk number in More
              </button>
            )}
          </Card>
        ) : (
          <Card title="Stay connected">
            {leader && (
              <a className="button wide" href={'tel:' + leader.phone}>
                <Phone size={18} />
                Call group leader
              </a>
            )}
            <button
              className="danger wide home-sos"
              disabled={busy || sos}
              onClick={() => setConfirm(true)}
            >
              <TriangleAlert size={18} />
              {sos ? 'Your SOS is active' : 'Send SOS to my group'}
            </button>
            {confirm && (
              <div className="confirm">
                <p>Send an SOS to your group?</p>
                <button
                  className="danger"
                  onClick={() =>
                    void act(() => api('/sos', 'POST'), 'SOS sent to your group.').then((ok) => {
                      if (ok) setConfirm(false);
                    })
                  }
                >
                  Send SOS
                </button>
                <button onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            )}
          </Card>
        )}
        <Card title="Your next meeting point">
          <p>
            Your agent finds a nearby meeting point using the leader’s current location and Google
            Maps.
          </p>
          <button className="primary wide" onClick={() => navigate('journey')}>
            See dynamic meeting point
          </button>
        </Card>
      </div>
    </>
  );
}
function MemberCard({
  member,
  data,
}: {
  member: Member;
  data: Snapshot;
  leader: boolean;
  busy: boolean;
  act: Act;
}) {
  const [open, setOpen] = useState(false);
  const state = boundaryState(member, data);
  const label = memberLabel(member, data);
  return (
    <>
      <button className={'member-reference-row ' + state} onClick={() => setOpen(true)}>
        <span className="avatar" translate="no">
          {member.name
            .trim()
            .split(/\s+/)
            .map((n) => n[0])
            .join('')
            .slice(0, 2)}
        </span>
        <span className="member-identity">
          <strong translate="no">{member.name}</strong>
        </span>
        <span className="member-battery">
          <Battery size={19} />
          {member.telemetry?.battery == null ? '—' : member.telemetry.battery + '%'}
        </span>
        <span
          className={
            'badge ' +
            (label === 'Safe' ? 'within_boundary' : label === 'Risk' ? 'attention' : 'stale')
          }
        >
          {label}
        </span>
      </button>
      {open && (
        <dialog
          className="member-detail"
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onCancel={() => setOpen(false)}
        >
          <button
            className="dialog-close"
            autoFocus
            aria-label="Close member details"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
          <span className="avatar" translate="no">
            {member.name
              .trim()
              .split(/\s+/)
              .map((n) => n[0])
              .join('')
              .slice(0, 2)}
          </span>
          <h2 translate="no">{member.name}</h2>
          <p>
            {member.role === 'leader' ? 'Group leader' : 'Pilgrim'} · {label}
          </p>
          <p className="fine">
            Safe means a fresh position within the group boundary. Risk includes SOS or an
            unconfirmed boundary position. Offline means no app contact for five minutes. A
            connected member with unavailable or uncertain GPS is shown as Risk, not Offline.
          </p>
          <p className="fine">
            {member.telemetry?.source === 'nokia-simulator'
              ? 'Location source: Nokia simulator test device'
              : ''}
          </p>
          <div className="facts">
            <span>
              Distance<b>{member.distance === null ? 'Unknown' : member.distance + ' m'}</b>
            </span>
            <span>
              Battery
              <b>
                {member.telemetry?.battery == null ? 'Unavailable' : member.telemetry.battery + '%'}
              </b>
            </span>
            <span>
              Last location<b>{stamp(member.telemetry?.observedAt)}</b>
            </span>
            <span>
              Accuracy
              <b>
                {member.telemetry ? '± ' + Math.round(member.telemetry.accuracy) + ' m' : 'Unknown'}
              </b>
            </span>
          </div>
          <a className="button wide" href={'tel:' + member.phone}>
            <Phone size={18} />
            Call member
          </a>
          {member.telemetry ? (
            <a
              className="button wide"
              href={
                'https://www.google.com/maps/search/?api=1&query=' +
                member.telemetry.lat +
                ',' +
                member.telemetry.lng
              }
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={18} />
              View on Google Maps
            </a>
          ) : (
            <p className="fine">This member has not shared a location.</p>
          )}
        </dialog>
      )}
    </>
  );
}
export function GroupView({ data, busy, act }: Props) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [qr, setQr] = useState('');
  const isLeader = data.user.role === 'leader',
    invite = location.origin + '/?join=' + encodeURIComponent(data.group.code);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(invite, { margin: 2, width: 180 })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr('');
      });
    return () => {
      active = false;
    };
  }, [invite]);
  const filtered = data.members.filter(
    (m) =>
      (filter === 'all' || memberLabel(m, data) === filter) &&
      (m.name + ' ' + m.phone).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      {' '}
      <Card title="Group members">
        <div className="filters">
          <Input
            label="Search members"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="field">
            <span>Status</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All members</option>
              {['Safe', 'Risk', 'Offline'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="member-list">
          {filtered.map((m) => (
            <MemberCard key={m.id} member={m} data={data} leader={isLeader} busy={busy} act={act} />
          ))}
        </div>
        {!filtered.length && <Empty>No members match this search.</Empty>}
      </Card>
      <Card title="Your group invitation">
        <div className="invite">
          <div>
            <p className="eyebrow" translate="no">
              {data.group.name}
            </p>
            <strong className="group-code" translate="no" dir="ltr">
              {data.group.code}
            </strong>
            <p className="fine">
              Share only with people who should join this group and see shared locations.
            </p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void act(() => navigator.clipboard.writeText(invite), 'Invitation link copied.')
                }
              >
                Copy invitation
              </button>
              {isLeader && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() => api('/group/rotate-code', 'POST'), 'Invitation code rotated.')
                  }
                >
                  Rotate code
                </button>
              )}
            </div>
          </div>
          {qr && <img src={qr} width="140" height="140" alt="QR code for joining this group" />}
        </div>
      </Card>
      {isLeader && (
        <Card title="Send a group message">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const message = String(new FormData(form).get('message'));
              void act(
                () => api('/group/broadcast', 'POST', { message }),
                'Message published to the group feed.',
              ).then((ok) => {
                if (ok) form.reset();
              });
            }}
          >
            <label className="field">
              <span>Message for your group</span>
              <textarea name="message" required maxLength={2000} rows={3} />
            </label>
            <button className="primary" disabled={busy}>
              Publish message
            </button>
          </form>
          <p className="fine">
            Appears in the in-app feed. Browser alerts require permission and an open page; SMS
            delivery is not configured.
          </p>
        </Card>
      )}
      <Card title="Open SOS incidents">
        {data.incidents.filter((i) => !i.resolvedAt).length ? (
          data.incidents
            .filter((i) => !i.resolvedAt)
            .map((i) => (
              <article className="incident" key={i.id}>
                <h3 translate="no">{i.name}</h3>
                <p>
                  <time translate="no">{stamp(i.createdAt)}</time>
                </p>
                {isLeader ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(
                        () =>
                          api('/incidents/' + i.id + '/resolve', 'POST', {
                            resolution: String(new FormData(e.currentTarget).get('resolution')),
                          }),
                        'SOS closed. Location and boundary status are unchanged.',
                      );
                    }}
                  >
                    <Input label="Resolution note" name="resolution" required maxLength={1000} />
                    <button disabled={busy}>Close SOS</button>
                  </form>
                ) : (
                  <p className="fine">Your group leader can record a resolution.</p>
                )}
              </article>
            ))
        ) : (
          <Empty>No open SOS incidents.</Empty>
        )}
      </Card>
      <Card title="Group updates">
        {data.bulletins.some((b) => !(b.kind === 'risk' && b.title.endsWith(': stale'))) ? (
          data.bulletins
            .filter((b) => !(b.kind === 'risk' && b.title.endsWith(': stale')))
            .slice(0, 5)
            .map((b) => (
              <article className="feed-item" key={b.id}>
                <span className={'dot ' + b.kind} />
                <div>
                  <strong data-localize-content="true">{b.title}</strong>
                  <p data-localize-content="true">{b.message}</p>
                  <small>
                    <time translate="no">{stamp(b.createdAt)}</time>
                  </small>
                </div>
              </article>
            ))
        ) : (
          <Empty>Your group messages will appear here.</Empty>
        )}
      </Card>
    </>
  );
}
