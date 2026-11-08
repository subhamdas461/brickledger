import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

// ---------------------------------------------------------------- passwords (scrypt, no native deps)

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 64, maxmem: 96 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, keyLen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Format: scrypt$N$r$p$saltB64$hashB64 - parameters are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A precomputed hash used to equalise timing when the email does not exist. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
  return dummyHash;
}

// ---------------------------------------------------------------- opaque tokens

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- JWT access tokens

const ISSUER = 'brickledger';

export class TokenService {
  private readonly key: Uint8Array;
  private readonly fileKey: string;

  constructor(
    secret: string,
    private readonly accessTtlMin: number,
  ) {
    this.key = new TextEncoder().encode(secret);
    this.fileKey = createHash('sha256').update(`files:${secret}`).digest('hex');
  }

  get accessTtlSeconds(): number {
    return this.accessTtlMin * 60;
  }

  async signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlMin}m`)
      .sign(this.key);
  }

  /** Returns the user id, or null when the token is invalid/expired. */
  async verifyAccess(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * Signed, expiring URL for file content so `<img src>` works without an auth header.
   * Expiry is rounded up to the hour so URLs stay stable (and cacheable) within that window.
   */
  signFileUrl(fileId: string, ttlSeconds = 3600): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = (Math.floor((now + ttlSeconds) / 3600) + 1) * 3600;
    const sig = createHmac('sha256', this.fileKey).update(`${fileId}.${exp}`).digest('base64url');
    return `/api/v1/files/${fileId}/content?exp=${exp}&sig=${sig}`;
  }

  verifyFileSignature(fileId: string, exp: string | undefined, sig: string | undefined): boolean {
    if (!exp || !sig) return false;
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) return false;
    const expected = createHmac('sha256', this.fileKey).update(`${fileId}.${expNum}`).digest('base64url');
    return safeEqual(expected, sig);
  }
}
