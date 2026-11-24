import { createSign } from 'node:crypto';
import type { Config } from '../config';

/** What sending to one device came to. `gone`: the app was uninstalled or the token expired; forget it. */
export type PushResult = 'sent' | 'gone' | 'failed';

export interface PushSender {
  readonly enabled: boolean;
  /** Why push is off, for the admin system check. */
  readonly status: 'connected' | 'not-configured' | 'misconfigured';
  send(token: string, data: Record<string, string>): Promise<PushResult>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** FIREBASE_SERVICE_ACCOUNT holds the service-account key file Firebase gives you: as JSON, or base64 of the JSON. */
export function parseServiceAccount(raw: string): ServiceAccount | null {
  const text = raw.trim();
  if (!text) return null;
  for (const candidate of [text, safeBase64(text)]) {
    try {
      const sa = JSON.parse(candidate ?? '');
      if (sa?.project_id && sa?.client_email && sa?.private_key) return { ...sa, private_key: String(sa.private_key).replace(/\\n/g, '\n') };
    } catch {
      /* try the next form */
    }
  }
  return null;
}

function safeBase64(text: string) {
  try {
    return Buffer.from(text, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

const disabled = (status: PushSender['status']): PushSender => ({ enabled: false, status, send: async () => 'failed' });

/**
 * Firebase Cloud Messaging (HTTP v1). Signs its own Google access token from the service account,
 * so no SDK is needed; the token is cached until shortly before it expires.
 */
export function createPushSender(config: Config, fetchImpl: typeof fetch = (...a) => fetch(...a)): PushSender {
  if (!config.FIREBASE_SERVICE_ACCOUNT.trim()) return disabled('not-configured');
  const sa = parseServiceAccount(config.FIREBASE_SERVICE_ACCOUNT);
  if (!sa) return disabled('misconfigured');

  let cached: { token: string; until: number } | null = null;
  async function accessToken(force = false): Promise<string> {
    if (!force && cached && cached.until > Date.now()) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: sa!.client_email, scope: SCOPE, aud: sa!.token_uri ?? DEFAULT_TOKEN_URI, iat: now, exp: now + 3600 })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(sa!.private_key, 'base64url');
    const res = await fetchImpl(sa!.token_uri ?? DEFAULT_TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`Google sign-in for push failed (${res.status}): ${body.error_description ?? body.error ?? ''}`);
    cached = { token: body.access_token, until: Date.now() + (Number(body.expires_in ?? 3600) - 120) * 1000 };
    return cached.token;
  }

  async function post(token: string, data: Record<string, string>, bearer: string) {
    return fetchImpl(`https://fcm.googleapis.com/v1/projects/${sa!.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      // Data-only and high priority: wakes the app even in Doze, and the app shows the notification itself.
      body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: '86400s' } } }),
    });
  }

  return {
    enabled: true,
    status: 'connected',
    async send(token, data) {
      try {
        let res = await post(token, data, await accessToken());
        if (res.status === 401) res = await post(token, data, await accessToken(true));
        if (res.ok) return 'sent';
        const body: any = await res.json().catch(() => ({}));
        const code = JSON.stringify(body?.error ?? {});
        // Uninstalled app, expired or malformed token: Google won't take it again.
        if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(code) || (res.status === 400 && /INVALID_ARGUMENT/.test(code) && /token/i.test(code))) return 'gone';
        return 'failed';
      } catch {
        return 'failed';
      }
    },
  };
}
