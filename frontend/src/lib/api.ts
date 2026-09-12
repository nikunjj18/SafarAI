let csrf = '';
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(
        path === '/copilot/chat' ? 120000 : path === '/journey/meeting-point' ? 70000 : 40000,
      ),
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-CSRF-Token': csrf } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('Connection failed or timed out. Check your connection and retry.', 0);
  }
  if (response.status === 204) return undefined as T;
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  let data: any = null;
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      throw new ApiError('The server returned invalid JSON.', 502);
    }
  }
  if (!response.ok)
    throw new ApiError(
      data?.error || 'Request failed (HTTP ' + response.status + ').',
      response.status,
    );
  if (!isJson) throw new ApiError('The server returned a page instead of API data.', 502);
  return data as T;
}
