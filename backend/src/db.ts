import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import type { Group, User, Profile, Telemetry } from '../../shared/types.ts';

export type UserRow = {
  id: string;
  group_id: string;
  email: string;
  phone: string;
  name: string;
  role: User['role'];
  password: string;
  profile: string;
  telemetry: string | null;
  last_seen: string | null;
  location_sharing?: number;
};
export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES (1);
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, leader_id TEXT NOT NULL, radius REAL NOT NULL DEFAULT 150, anchor TEXT);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), email TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('leader','pilgrim')), password TEXT NOT NULL, profile TEXT NOT NULL, telemetry TEXT, last_seen TEXT, location_sharing INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS user_group ON users(group_id);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), owner_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS record_group_kind ON records(group_id, kind, created_at);
    CREATE TABLE IF NOT EXISTS receipts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, record_id));
    CREATE TABLE IF NOT EXISTS risk_states (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, user_id TEXT NOT NULL, operation TEXT NOT NULL, status INTEGER NOT NULL, duration INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);
  const groupColumns = db.prepare('PRAGMA table_info(groups)').all() as { name: string }[];
  if (!groupColumns.some((c) => c.name === 'helpdesk_phone'))
    db.exec("ALTER TABLE groups ADD COLUMN helpdesk_phone TEXT NOT NULL DEFAULT ''");
  const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'location_sharing'))
    db.exec('ALTER TABLE users ADD COLUMN location_sharing INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE groups SET radius=150,anchor=NULL WHERE radius<>150 OR anchor IS NOT NULL');
  for (const g of db.prepare('SELECT id FROM groups WHERE length(code)<>5').all())
    db.prepare('UPDATE groups SET code=? WHERE id=?').run(newGroupCode(db), g.id);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function userFrom(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    groupId: row.group_id,
    profile: JSON.parse(row.profile) as Profile,
  };
}
export function groupFrom(row: Record<string, unknown>): Group {
  return {
    helpdeskPhone: String(row.helpdesk_phone || ''),
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    leaderId: String(row.leader_id),
    radius: Number(row.radius),
    anchor: row.anchor ? JSON.parse(String(row.anchor)) : null,
  };
}
export function record<T>(
  db: DB,
  groupId: string,
  kind: string,
  data: T,
  owner: string | null = null,
): T & { id: string } {
  const item = { ...data, id: randomUUID() };
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)').run(
    item.id,
    groupId,
    owner,
    kind,
    JSON.stringify(item),
    new Date().toISOString(),
  );
  return item;
}
export function records<T>(db: DB, groupId: string, kind: string, owner?: string): T[] {
  return (
    db
      .prepare(
        `SELECT data FROM records WHERE group_id=? AND kind=? ${owner ? 'AND owner_id=?' : ''} ORDER BY created_at DESC LIMIT 500`,
      )
      .all(...(owner ? [groupId, kind, owner] : [groupId, kind])) as { data: string }[]
  ).map((r) => JSON.parse(r.data) as T);
}
export function updateRecord(db: DB, id: string, data: unknown) {
  db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data), id);
}
export function telemetryFrom(row: UserRow): Telemetry | null {
  return row.telemetry ? JSON.parse(row.telemetry) : null;
}

export function newGroupCode(db: DB): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = Array.from({ length: 5 }, () => chars[randomInt(chars.length)]).join('');
    if (!db.prepare('SELECT id FROM groups WHERE code=?').get(code)) return code;
  }
  throw new Error('Could not allocate a group invitation code.');
}
