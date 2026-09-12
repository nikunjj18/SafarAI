export type LanguageCode = string;
export type Role = 'leader' | 'pilgrim';
export interface Profile {
  language: string;
  medical: string;
  emergencyContact: string;
  theme: 'dark' | 'light' | 'system';
  notifications: boolean;
  networkConsent: boolean;
  simulator?: boolean;
}
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  groupId: string;
  profile: Profile;
}
export interface Group {
  helpdeskPhone?: string;
  id: string;
  name: string;
  code: string;
  leaderId: string;
  radius: number;
  anchor: { lat: number; lng: number } | null;
}
export interface Telemetry {
  lat: number;
  lng: number;
  accuracy: number;
  observedAt: string;
  receivedAt?: string;
  source: 'browser' | 'carrier' | 'nokia-simulator';
  battery: number | null;
}
export interface Member {
  id: string;
  name: string;
  phone: string;
  role: Role;
  telemetry: Telemetry | null;
  lastSeen: string | null;
  status: 'unknown' | 'stale' | 'attention' | 'within_boundary' | 'sos';
  distance: number | null;
  riskScore: number | null;
  factors: string[];
}
export interface Incident {
  id: string;
  memberId: string;
  name: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}
export interface Bulletin {
  id: string;
  kind: 'sos' | 'broadcast' | 'risk' | 'resolution' | 'journey';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  actorId: string;
  recipientId?: string;
}
export interface Checkpoint {
  id: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  scheduledAt: string;
  status: 'upcoming' | 'active' | 'completed';
}
export interface MeetingPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  crowd: number | null;
  observedAt: string;
  active: boolean;
}
export interface ClientAction {
  type: 'call' | 'map' | 'share_location' | 'stop_location' | 'send_sos';
  href?: string;
  label: string;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  provider?: string;
  language?: string;
  action?: ClientAction;
}
export interface NetworkResource {
  id: string;
  kind: 'qod' | 'geofencing' | 'congestion-subscription';
  providerId: string;
  data: Record<string, unknown>;
  updatedAt: string;
}
export interface Snapshot {
  demoMode?: boolean;
  user: User;
  group: Group;
  members: Member[];
  incidents: Incident[];
  bulletins: Bulletin[];
  checkpoints: Checkpoint[];
  meetingPoints: MeetingPoint[];
  serverTime: string;
}
export interface Configuration {
  ai: { configured: boolean; provider: string };
  carrier: { configured: boolean; connected: boolean; operations: string[] };
  maps: 'OpenStreetMap';
  prayerMethod: number;
}
