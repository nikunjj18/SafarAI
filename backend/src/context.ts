import type { DB } from './db.ts';
import { groupFrom, records } from './db.ts';
import { members, evaluate } from './risk.ts';
import type {
  User,
  Group,
  Snapshot,
  Incident,
  Bulletin,
  MeetingPoint,
  Checkpoint,
} from '../../shared/types.ts';
import type { createEvents } from './events.ts';
import type { createProviders, Environment } from './providers.ts';
export const iso = () => new Date().toISOString();
export interface Context {
  db: DB;
  env: Environment;
  events: ReturnType<typeof createEvents>;
  providers: ReturnType<typeof createProviders>;
  publicUrl: URL;
}
export function groupFor(c: Context, user: User): Group {
  return groupFrom(c.db.prepare('SELECT * FROM groups WHERE id=?').get(user.groupId)!);
}
export function changed(c: Context, groupId: string) {
  evaluate(c.db, groupFrom(c.db.prepare('SELECT * FROM groups WHERE id=?').get(groupId)!));
  c.events.publish(groupId);
}
export function snapshot(c: Context, user: User): Snapshot {
  const group = groupFor(c, user);
  const receipts = c.db
    .prepare('SELECT record_id,hidden FROM receipts WHERE user_id=?')
    .all(user.id) as { record_id: string; hidden: number }[];
  return {
    user,
    group,
    demoMode: c.env.DEMO_MODE === 'true',
    members: members(c.db, group),
    incidents: records<Incident>(c.db, group.id, 'incident'),
    bulletins: records<Bulletin>(c.db, group.id, 'bulletin')
      .filter(
        (b) =>
          (!b.recipientId || b.recipientId === user.id) &&
          !receipts.find((r) => r.record_id === b.id)?.hidden,
      )
      .map((b) => ({ ...b, read: receipts.some((r) => r.record_id === b.id) })),
    checkpoints: records<Checkpoint>(c.db, group.id, 'checkpoint').sort((a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt),
    ),
    meetingPoints: records<MeetingPoint>(c.db, group.id, 'meeting-point'),
    serverTime: iso(),
  };
}
