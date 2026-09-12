import type { Response } from 'express';
export function createEvents() {
  const clients = new Map<string, Set<Response>>();
  return {
    add(group: string, res: Response) {
      const set = clients.get(group) || new Set<Response>();
      if (set.size >= 100) return false;
      set.add(res);
      clients.set(group, set);
      res.on('close', () => {
        set.delete(res);
        if (!set.size) clients.delete(group);
      });
      return true;
    },
    publish(group: string) {
      for (const res of clients.get(group) || []) {
        if (!res.writableEnded && !res.write('event: change\ndata: {}\n\n')) res.end();
      }
    },
    close() {
      for (const set of clients.values()) for (const res of set) res.end();
      clients.clear();
    },
  };
}
