import crypto from 'node:crypto';

const DEFAULT_SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'brightloop_enterprise_hmac_secret_2026_do_not_expose_to_client';

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || 'augmented-pivot-13skh';

export interface SignedTokenClaims {
  sub: string;
  email: string;
  mode: 'auth' | 'demo' | 'firebase';
  iat: number;
  exp: number;
}

/**
 * Hash a password using a unique cryptographically random 16-byte salt and scrypt.
 * Format: `<saltHex>:<derivedKeyHex>`
 */
export function hashPasswordWithRandomSalt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verify a candidate password against a `<saltHex>:<derivedKeyHex>` hash using constant-time comparison.
 */
export function verifyPasswordHash(password: string, storedHash: string): boolean {
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (!storedHash.includes(':')) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const candidateBuf = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(keyHex, 'hex');
    if (candidateBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  } catch {
    return false;
  }
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

/**
 * Issue a server-signed HMAC-SHA256 JWT.
 * Note: Role is intentionally omitted from trusted claims so the server ALWAYS reads the live role from the database.
 */
export function signSessionToken(
  payload: { sub: string; email: string; mode: 'auth' | 'demo' | 'firebase' },
  expiresInSeconds = 8 * 3600,
  secret: string = DEFAULT_SESSION_SECRET
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims: SignedTokenClaims = {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    mode: payload.mode,
    iat: nowSec,
    exp: nowSec + expiresInSeconds,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verify a server-signed HMAC-SHA256 JWT and check expiration.
 */
export function verifySessionToken(
  token: string,
  secret: string = DEFAULT_SESSION_SECRET
): { valid: boolean; claims?: SignedTokenClaims; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing token.' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure.' };
  }
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  try {
    const header = JSON.parse(base64UrlDecodeToString(encodedHeader));
    if (header.alg !== 'HS256') {
      return { valid: false, error: 'Unsupported token algorithm.' };
    }
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signingInput)
      .digest();
    const actualSig = base64UrlDecodeToBuffer(encodedSig);
    if (
      expectedSig.length !== actualSig.length ||
      !crypto.timingSafeEqual(expectedSig, actualSig)
    ) {
      return { valid: false, error: 'Invalid token signature.' };
    }
    const claims = JSON.parse(base64UrlDecodeToString(encodedPayload)) as SignedTokenClaims;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp <= nowSec) {
      return { valid: false, error: 'Token has expired.' };
    }
    if (!claims.sub || !claims.email) {
      return { valid: false, error: 'Invalid token subject claims.' };
    }
    return { valid: true, claims };
  } catch {
    return { valid: false, error: 'Failed to decode or verify token.' };
  }
}

// Cache Google SecureToken X.509 public certificates for Firebase ID token verification
let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > now) {
    return cachedGoogleCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Could not fetch Google SecureToken public certificates.');
  }
  const certs = (await res.json()) as Record<string, string>;
  cachedGoogleCerts = {
    certs,
    expiresAt: now + 3600 * 1000,
  };
  return certs;
}

/**
 * Cryptographically verify a Firebase Auth ID Token (RS256) against Google's X.509 public keys.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  expectedProjectId: string = FIREBASE_PROJECT_ID
): Promise<{
  valid: boolean;
  uid?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  error?: string;
}> {
  if (!idToken || typeof idToken !== 'string') {
    return { valid: false, error: 'Missing Firebase ID token.' };
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed Firebase ID token.' };
  }
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  try {
    const header = JSON.parse(base64UrlDecodeToString(encodedHeader));
    if (header.alg !== 'RS256' || !header.kid) {
      return { valid: false, error: 'Firebase ID token must use RS256 with a valid kid.' };
    }
    const payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= nowSec) {
      return { valid: false, error: 'Firebase ID token has expired.' };
    }
    if (payload.aud !== expectedProjectId) {
      return { valid: false, error: 'Firebase ID token audience mismatch.' };
    }
    if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
      return { valid: false, error: 'Firebase ID token issuer mismatch.' };
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      return { valid: false, error: 'Firebase ID token subject (uid) missing.' };
    }

    const certs = await getGooglePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) {
      return { valid: false, error: 'No matching Google X.509 certificate for token kid.' };
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    const signatureBuf = base64UrlDecodeToBuffer(encodedSig);
    const signatureValid = verifier.verify(certPem, signatureBuf);

    if (!signatureValid) {
      return { valid: false, error: 'Invalid Firebase ID token RSA signature.' };
    }

    return {
      valid: true,
      uid: payload.sub,
      email: payload.email ? String(payload.email).toLowerCase() : undefined,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name ? String(payload.name) : undefined,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Firebase ID token verification failed.',
    };
  }
}

/**
 * Extract Bearer token from the Authorization header.
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}
