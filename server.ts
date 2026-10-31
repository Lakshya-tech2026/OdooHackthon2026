import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import {
  AuditLog,
  Customer,
  DatabaseState,
  DiscountRule,
  Plan,
  Product,
  ProductVariant,
  Quotation,
  QuotationTemplate,
  Staff,
  Subscription,
  SubscriptionLine,
  SubscriptionStatus,
  TaxRule,
  User,
  UserRole,
} from './src/types/domain';
import { createInitialSeedData } from './src/lib/seedData';
import {
  advanceBillingDate,
  applyPaymentToInvoice,
  calculateDocumentTotals,
  calculateVariantUnitPricePaise,
  getUpcomingRenewals,
  isValidSubscriptionTransition,
  runBatchInvoiceGeneration,
  validatePasswordStrength,
} from './src/lib/billingEngine';
import {
  extractBearerToken,
  hashPasswordWithRandomSalt,
  signSessionToken,
  verifyFirebaseIdToken,
  verifyPasswordHash,
  verifySessionToken,
} from './src/lib/serverSecurity';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'brightloop-db.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'brightloop-Auth.json');
const BOOTSTRAP_ADMIN_EMAIL = (
  process.env.BOOTSTRAP_ADMIN_EMAIL || 'lakshya.tech2026@gmail.com'
).toLowerCase();

interface StoredCredentials {
  [emailLower: string]: {
    passwordHash: string;
    userId: string;
    updatedAt?: string;
  };
}

interface PasswordResetRecord {
  email: string;
  userId: string;
  expiresAt: number;
  used: boolean;
}

const passwordResetStore = new Map<string, PasswordResetRecord>();

/**
 * Deduplicate records by ID and idempotency keys to guarantee one authoritative, consistent state
 */
function deduplicateDatabaseState(state: DatabaseState): DatabaseState {
  const uniqueById = <T extends { id: string }>(items: T[] = []): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  };

  const uniqueInvoices = (() => {
    const seenIds = new Set<string>();
    const seenIdempotency = new Set<string>();
    const out = [];
    for (const inv of state.invoices || []) {
      if (!inv || !inv.id) continue;
      const idemKey = inv.idempotencyKey || `${inv.subscriptionId}_${inv.invoiceDate}`;
      if (seenIds.has(inv.id) || seenIdempotency.has(idemKey)) continue;
      seenIds.add(inv.id);
      seenIdempotency.add(idemKey);
      out.push(inv);
    }
    return out;
  })();

  const uniquePayments = (() => {
    const seenIds = new Set<string>();
    const seenRefs = new Set<string>();
    const out = [];
    for (const pay of state.payments || []) {
      if (!pay || !pay.id) continue;
      const refKey = `${pay.invoiceId}_${(pay.transactionReference || '').toUpperCase()}`;
      if (seenIds.has(pay.id) || (pay.transactionReference && seenRefs.has(refKey))) continue;
      seenIds.add(pay.id);
      if (pay.transactionReference) seenRefs.add(refKey);
      out.push(pay);
    }
    return out;
  })();

  return {
    users: uniqueById(state.users),
    customers: uniqueById(state.customers),
    staff: uniqueById(state.staff),
    products: uniqueById(state.products),
    productVariants: uniqueById(state.productVariants),
    plans: uniqueById(state.plans),
    quotationTemplates: uniqueById(state.quotationTemplates),
    quotations: uniqueById(state.quotations),
    subscriptions: uniqueById(state.subscriptions),
    subscriptionLines: uniqueById(state.subscriptionLines),
    invoices: uniqueInvoices,
    invoiceLines: uniqueById(state.invoiceLines),
    taxRules: uniqueById(state.taxRules),
    discountRules: uniqueById(state.discountRules),
    payments: uniquePayments,
    auditLogs: uniqueById(state.auditLogs),
  };
}

function createDatabaseBackup(reason = 'manual'): { backupFile: string; createdAt: string } {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const createdAt = new Date().toISOString();
  const safeStamp = createdAt.replace(/[:.]/g, '-');
  const fileName = `brightloop-backup-${safeStamp}-${reason}.json`;
  const fullPath = path.join(BACKUP_DIR, fileName);
  if (fs.existsSync(DB_FILE)) {
    fs.copyFileSync(DB_FILE, fullPath);
  } else {
    fs.writeFileSync(fullPath, JSON.stringify(createInitialSeedData(), null, 2), 'utf-8');
  }
  return { backupFile: fileName, createdAt };
}

function listDatabaseBackups(): Array<{ fileName: string; sizeBytes: number; updatedAt: string }> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((fileName) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, fileName));
        return {
          fileName,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 15);
  } catch {
    return [];
  }
}

function loadDatabase(): DatabaseState {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = deduplicateDatabaseState(createInitialSeedData());
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    createDatabaseBackup('initial-seed');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DatabaseState;
    const cleaned = deduplicateDatabaseState(parsed);
    if (listDatabaseBackups().length === 0) {
      createDatabaseBackup('pre-audit-snapshot');
    }
    return cleaned;
  } catch {
    const initial = deduplicateDatabaseState(createInitialSeedData());
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
}

function saveDatabase(state: DatabaseState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const cleaned = deduplicateDatabaseState(state);
  fs.writeFileSync(DB_FILE, JSON.stringify(cleaned, null, 2), 'utf-8');
}

function buildDefaultCredentials(dbState: DatabaseState): StoredCredentials {
  const now = new Date().toISOString();
  const initialCreds: StoredCredentials = {
    'admin@brightloop.in': {
      passwordHash: hashPasswordWithRandomSalt('Admin@2026!'),
      userId: 'usr_admin_1',
      updatedAt: now,
    },
    'staff@brightloop.in': {
      passwordHash: hashPasswordWithRandomSalt('Staff@2026!'),
      userId: 'usr_staff_1',
      updatedAt: now,
    },
    'aarav@kinetixlabs.in': {
      passwordHash: hashPasswordWithRandomSalt('Customer@2026!'),
      userId: 'usr_cust_1',
      updatedAt: now,
    },
    'priya@vervecloud.co.in': {
      passwordHash: hashPasswordWithRandomSalt('Customer@2026!'),
      userId: 'usr_cust_2',
      updatedAt: now,
    },
  };
  for (const u of dbState.users) {
    const key = u.email.toLowerCase();
    if (!initialCreds[key]) {
      initialCreds[key] = {
        passwordHash: hashPasswordWithRandomSalt('Brightloop@2026!'),
        userId: u.id,
        updatedAt: now,
      };
    }
  }
  return initialCreds;
}

function loadCredentials(dbState: DatabaseState): StoredCredentials {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8')) as StoredCredentials;
      // Upgrade any legacy fixed-salt hashes (which lack a ':' separator) to per-user random salt scrypt hashes
      const hasLegacyFixedSalt = Object.values(existing).some(
        (entry) => !entry.passwordHash || !entry.passwordHash.includes(':')
      );
      if (!hasLegacyFixedSalt) {
        return existing;
      }
    } catch {
      // rebuild with random-salt hashes below
    }
  }
  const freshCreds = buildDefaultCredentials(dbState);
  saveCredentials(freshCreds);
  return freshCreds;
}

function saveCredentials(creds: StoredCredentials): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf-8');
}

let dbState: DatabaseState = loadDatabase();
let credentialsStore: StoredCredentials = loadCredentials(dbState);

function recordAudit(
  actor: Pick<User, 'id' | 'name' | 'role'> | { id: string; name: string; role: UserRole | 'SYSTEM' },
  action: string,
  entityType: string,
  entityId: string,
  details: string
): AuditLog {
  const entry: AuditLog = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    details: details.slice(0, 1000),
    createdAt: new Date().toISOString(),
  };
  dbState.auditLogs.unshift(entry);
  return entry;
}

interface AuthenticatedRequest extends Request {
  currentUser?: User;
  authMode?: 'auth' | 'demo' | 'firebase';
}

/**
 * Per-IP Sliding Window Rate Limiter for sensitive authentication and mutation endpoints
 */
function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait before retrying.',
      });
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

/**
 * Zero-Trust Authentication Middleware:
 * - Completely ignores `x-user-id` and `x-user-email` headers.
 * - Requires a cryptographically verified `Authorization: Bearer <token>` (Server HMAC-SHA256 JWT or Firebase RS256 ID token).
 * - Resolves the user's role (`ADMIN`, `STAFF`, `CUSTOMER`) strictly from the server-controlled `dbState.users` database.
 */
async function attachUser(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) {
    return next();
  }

  // 1. Check Server-Signed HMAC-SHA256 Session JWT
  const sessionCheck = verifySessionToken(token);
  if (sessionCheck.valid && sessionCheck.claims) {
    const found = dbState.users.find(
      (u) =>
        u.id === sessionCheck.claims!.sub ||
        u.email.toLowerCase() === sessionCheck.claims!.email.toLowerCase()
    );
    if (found && found.status === 'ACTIVE') {
      req.currentUser = found;
      req.authMode = sessionCheck.claims.mode;
    }
    return next();
  }

  // 2. Check Firebase Auth RS256 ID Token
  const firebaseCheck = await verifyFirebaseIdToken(token);
  if (firebaseCheck.valid && firebaseCheck.email) {
    const emailLower = firebaseCheck.email.toLowerCase();
    let found = dbState.users.find((u) => u.email.toLowerCase() === emailLower);
    if (!found && firebaseCheck.emailVerified) {
      // Auto-provision verified Firebase user with server-controlled role
      const isBootstrapAdmin = emailLower === BOOTSTRAP_ADMIN_EMAIL;
      const now = new Date().toISOString();
      const userId = firebaseCheck.uid || `usr_${Date.now()}`;
      const customerId = isBootstrapAdmin ? undefined : `cust_${Date.now()}`;
      found = {
        id: userId,
        email: emailLower,
        name: firebaseCheck.name || emailLower.split('@')[0],
        role: isBootstrapAdmin ? 'ADMIN' : 'CUSTOMER',
        status: 'ACTIVE',
        customerId,
        createdAt: now,
      };
      dbState.users.push(found);
      if (customerId) {
        dbState.customers.unshift({
          id: customerId,
          userId,
          name: found.name,
          email: emailLower,
          status: 'ACTIVE',
          createdAt: now,
        });
      }
      saveDatabase(dbState);
    }
    if (found && found.status === 'ACTIVE') {
      req.currentUser = found;
      req.authMode = 'firebase';
    }
  }

  return next();
}

function requireRoles(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return res.status(401).json({
        error: 'Authentication required. Present a valid Bearer token in the Authorization header.',
      });
    }
    if (!allowedRoles.includes(req.currentUser.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.currentUser.role}.`,
      });
    }
    next();
  };
}

function findCustomerForUser(user: User): Customer | undefined {
  return dbState.customers.find(
    (c) =>
      c.id === user.customerId ||
      c.userId === user.id ||
      c.email.toLowerCase() === user.email.toLowerCase()
  );
}

export async function createBrightloopApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Security Headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  app.use(attachUser);

  const authRateLimiter = createRateLimiter(25, 60_000);
  const sensitiveRateLimiter = createRateLimiter(60, 60_000);

  // ============================================================================
  // AUTHENTICATION ENDPOINTS
  // ============================================================================

  app.post('/api/auth/register', authRateLimiter, (req: AuthenticatedRequest, res: Response) => {
    const { name, email, password, phone, company, gstin, billingAddress } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
      return res.status(400).json({ error: 'Full name is required (2–120 characters).' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = dbState.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email address already exists. Duplicate emails are not allowed.',
      });
    }

    const pwCheck = validatePasswordStrength(String(password || ''));
    if (!pwCheck.valid) {
      return res.status(400).json({
        error: pwCheck.errors[0],
        validationErrors: pwCheck.errors,
      });
    }

    const now = new Date().toISOString();
    const userId = `usr_${Date.now()}`;
    const customerId = `cust_${Date.now()}`;

    // Never allow client payload to set its own role; public registration is strictly CUSTOMER
    const newUser: User = {
      id: userId,
      email: normalizedEmail,
      name: name.trim(),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      customerId,
      createdAt: now,
    };

    const newCustomer: Customer = {
      id: customerId,
      userId,
      name: name.trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim().slice(0, 32) : '+91 98000 00000',
      company: company ? String(company).trim().slice(0, 160) : `${name.trim()} Enterprises`,
      gstin: gstin ? String(gstin).trim().toUpperCase().slice(0, 32) : '',
      billingAddress: billingAddress
        ? String(billingAddress).trim().slice(0, 500)
        : 'Mumbai, Maharashtra, India',
      status: 'ACTIVE',
      createdAt: now,
    };

    dbState.users.push(newUser);
    dbState.customers.unshift(newCustomer);
    credentialsStore[normalizedEmail] = {
      passwordHash: hashPasswordWithRandomSalt(String(password)),
      userId,
      updatedAt: now,
    };

    recordAudit(
      newUser,
      'CUSTOMER_REGISTERED',
      'Customer',
      customerId,
      `Registered new customer account for ${newUser.name} (${newUser.email}).`
    );

    saveDatabase(dbState);
    saveCredentials(credentialsStore);

    const token = signSessionToken({ sub: newUser.id, email: newUser.email, mode: 'auth' });
    return res.status(201).json({
      user: newUser,
      customer: newCustomer,
      token,
    });
  });

  app.post('/api/auth/login', authRateLimiter, (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = dbState.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    const cred = credentialsStore[normalizedEmail];

    if (!user || !cred || !verifyPasswordHash(password, cred.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({
        error: 'Your account has been deactivated. Contact an administrator.',
      });
    }

    const token = signSessionToken({ sub: user.id, email: user.email, mode: 'auth' });
    recordAudit(user, 'USER_LOGIN', 'User', user.id, `Authenticated session started for ${user.email}.`);
    saveDatabase(dbState);
    return res.json({ user, token });
  });

  /**
   * Verify a Firebase Auth ID token on the server and exchange it for a verified session
   */
  app.post('/api/auth/firebase-exchange', authRateLimiter, async (req: Request, res: Response) => {
    const idToken =
      extractBearerToken(req.header('authorization')) ||
      (typeof req.body?.idToken === 'string' ? req.body.idToken : null);

    if (!idToken) {
      return res.status(401).json({ error: 'Firebase ID token is required.' });
    }

    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.valid || !verified.email) {
      return res.status(401).json({ error: verified.error || 'Invalid Firebase ID token.' });
    }

    const normalizedEmail = verified.email.toLowerCase();
    let user = dbState.users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      const isBootstrapAdmin = normalizedEmail === BOOTSTRAP_ADMIN_EMAIL && verified.emailVerified;
      const now = new Date().toISOString();
      const userId = verified.uid || `usr_${Date.now()}`;
      const customerId = isBootstrapAdmin ? undefined : `cust_${Date.now()}`;
      user = {
        id: userId,
        email: normalizedEmail,
        name: verified.name || normalizedEmail.split('@')[0],
        role: isBootstrapAdmin ? 'ADMIN' : 'CUSTOMER',
        status: 'ACTIVE',
        customerId,
        createdAt: now,
      };
      dbState.users.push(user);
      if (customerId) {
        dbState.customers.unshift({
          id: customerId,
          userId,
          name: user.name,
          email: normalizedEmail,
          status: 'ACTIVE',
          createdAt: now,
        });
      }
      recordAudit(
        user,
        'FIREBASE_USER_PROVISIONED',
        'User',
        user.id,
        `Provisioned user ${user.email} via verified Firebase ID token.`
      );
      saveDatabase(dbState);
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is inactive.' });
    }

    const token = signSessionToken({ sub: user.id, email: user.email, mode: 'firebase' });
    return res.json({ user, token });
  });

  /**
   * Sandboxed Demo Role Session Endpoint:
   * - Can be disabled in production by setting ENABLE_DEMO_MODE="false".
   * - Strictly limited to the 3 pre-configured sandbox demo accounts.
   * - Never accepts arbitrary emails or exposes production credentials.
   */
  app.post('/api/auth/demo-session', authRateLimiter, (req: Request, res: Response) => {
    if (process.env.ENABLE_DEMO_MODE === 'false') {
      return res.status(403).json({
        error: 'Sandbox demo mode is disabled in this environment. Please sign in with credentials.',
      });
    }

    const { role } = req.body || {};
    const DEMO_SANDBOX_MAP: Record<UserRole, string> = {
      ADMIN: 'usr_admin_1',
      STAFF: 'usr_staff_1',
      CUSTOMER: 'usr_cust_1',
    };

    const requestedRole: UserRole =
      role === 'ADMIN' || role === 'STAFF' || role === 'CUSTOMER' ? role : 'CUSTOMER';
    const sandboxUserId = DEMO_SANDBOX_MAP[requestedRole];
    const user = dbState.users.find((u) => u.id === sandboxUserId && u.status === 'ACTIVE');

    if (!user) {
      return res.status(404).json({ error: 'Sandbox demo account not available.' });
    }

    const token = signSessionToken({ sub: user.id, email: user.email, mode: 'demo' }, 2 * 3600);
    recordAudit(
      user,
      'DEMO_SANDBOX_SESSION',
      'User',
      user.id,
      `Started sandboxed demo session for role ${user.role}.`
    );
    saveDatabase(dbState);
    return res.json({ user, token, demoMode: true });
  });

  app.post('/api/auth/forgot-password', authRateLimiter, (req: Request, res: Response) => {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Please enter your registered email address.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = dbState.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: 'No account found with that email address.' });
    }
    const resetCode = `rst_${crypto.randomBytes(12).toString('hex')}`;
    passwordResetStore.set(resetCode, {
      email: normalizedEmail,
      userId: user.id,
      expiresAt: Date.now() + 15 * 60_000,
      used: false,
    });
    recordAudit(
      user,
      'PASSWORD_RESET_REQUESTED',
      'User',
      user.id,
      `Password reset verification dispatched to ${user.email}.`
    );
    saveDatabase(dbState);
    return res.json({
      message: `Password reset verification link dispatched to ${user.email}.`,
      resetTokenPreview: resetCode,
    });
  });

  app.post('/api/auth/reset-password', authRateLimiter, (req: Request, res: Response) => {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || typeof resetToken !== 'string') {
      return res.status(400).json({ error: 'Valid password reset verification token is required.' });
    }
    const record = passwordResetStore.get(resetToken.trim());
    if (!record || record.used || record.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired.' });
    }
    const pwCheck = validatePasswordStrength(String(newPassword || ''));
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.errors[0], validationErrors: pwCheck.errors });
    }
    record.used = true;
    credentialsStore[record.email] = {
      passwordHash: hashPasswordWithRandomSalt(String(newPassword)),
      userId: record.userId,
      updatedAt: new Date().toISOString(),
    };
    saveCredentials(credentialsStore);
    const user = dbState.users.find((u) => u.id === record.userId);
    if (user) {
      recordAudit(user, 'PASSWORD_RESET_COMPLETED', 'User', user.id, `Password updated via verified reset flow.`);
      saveDatabase(dbState);
    }
    return res.json({ message: 'Password has been securely updated. You may now sign in.' });
  });

  app.put(
    '/api/auth/profile',
    sensitiveRateLimiter,
    requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']),
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.currentUser!;
      const { name, currentPassword, newPassword } = req.body || {};
      const uIdx = dbState.users.findIndex((u) => u.id === user.id);
      if (uIdx === -1) return res.status(404).json({ error: 'User not found.' });

      // Prevent users from ever modifying their own role or status through profile updates
      if (req.body?.role && req.body.role !== user.role) {
        return res.status(403).json({ error: 'Users are not permitted to modify their own role.' });
      }

      if (name && typeof name === 'string' && name.trim().length >= 2) {
        dbState.users[uIdx].name = name.trim().slice(0, 120);
      }

      if (newPassword) {
        const cred = credentialsStore[user.email.toLowerCase()];
        if (cred && currentPassword && !verifyPasswordHash(String(currentPassword), cred.passwordHash)) {
          return res.status(401).json({ error: 'Current password verification failed.' });
        }
        const pwCheck = validatePasswordStrength(String(newPassword));
        if (!pwCheck.valid) {
          return res.status(400).json({ error: pwCheck.errors[0] });
        }
        credentialsStore[user.email.toLowerCase()] = {
          passwordHash: hashPasswordWithRandomSalt(String(newPassword)),
          userId: user.id,
          updatedAt: new Date().toISOString(),
        };
        saveCredentials(credentialsStore);
      }

      recordAudit(user, 'UPDATED_PROFILE', 'User', user.id, `Updated account profile for ${user.email}.`);
      saveDatabase(dbState);
      return res.json({ user: dbState.users[uIdx] });
    }
  );

  // ============================================================================
  // STATE FETCH (WITH STRICT ROLE & CUSTOMER DATA ISOLATION)
  // ============================================================================

  app.get('/api/state', requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']), (req: AuthenticatedRequest, res: Response) => {
    const user = req.currentUser!;

    if (user.role === 'CUSTOMER') {
      // Strictly isolate customer data so a customer NEVER receives another customer's records
      const customerRecord = findCustomerForUser(user);
      const cid = customerRecord?.id || user.customerId || '__none__';

      const mySubscriptions = dbState.subscriptions.filter((s) => s.customerId === cid);
      const mySubIds = new Set(mySubscriptions.map((s) => s.id));
      const myQuotations = dbState.quotations.filter((q) => q.customerId === cid);
      const myQuoIds = new Set(myQuotations.map((q) => q.id));
      const myInvoices = dbState.invoices.filter((i) => i.customerId === cid);
      const myInvIds = new Set(myInvoices.map((i) => i.id));
      const myPayments = dbState.payments.filter((p) => p.customerId === cid);

      const isolatedState: DatabaseState = {
        users: [user],
        customers: customerRecord ? [customerRecord] : [],
        staff: [],
        products: dbState.products.filter((p) => p.status === 'ACTIVE'),
        productVariants: dbState.productVariants.filter((v) => v.status === 'ACTIVE'),
        plans: dbState.plans.filter((p) => p.status === 'ACTIVE'),
        quotationTemplates: [],
        quotations: myQuotations,
        subscriptions: mySubscriptions,
        subscriptionLines: dbState.subscriptionLines.filter(
          (l) => mySubIds.has(l.subscriptionId) || myQuoIds.has(l.subscriptionId)
        ),
        invoices: myInvoices,
        invoiceLines: dbState.invoiceLines.filter((il) => myInvIds.has(il.invoiceId)),
        taxRules: dbState.taxRules.filter((t) => t.status === 'ACTIVE'),
        discountRules: dbState.discountRules.filter((d) => d.status === 'ACTIVE'),
        payments: myPayments,
        auditLogs: dbState.auditLogs.filter((a) => a.actorId === user.id),
      };

      return res.json(isolatedState);
    }

    // Staff cannot read raw admin audit logs or other user credentials
    if (user.role === 'STAFF') {
      return res.json({
        ...dbState,
        auditLogs: dbState.auditLogs.slice(0, 50),
      });
    }

    return res.json(dbState);
  });


  // ============================================================================
  // PRODUCT & VARIANT MANAGEMENT (ADMIN ONLY)
  // ============================================================================

  app.post('/api/products', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const { name, productType, salesPricePaise, costPricePaise, description, variants } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Product name is required.' });
    }
    const sales = Math.round(Number(salesPricePaise));
    const cost = Math.round(Number(costPricePaise ?? 0));
    if (!Number.isFinite(sales) || sales < 0) {
      return res.status(400).json({ error: 'Valid sales price is required.' });
    }

    const now = new Date().toISOString();
    const product: Product = {
      id: `prod_${Date.now()}`,
      name: name.trim(),
      productType: ['SERVICE', 'SAAS', 'ADDON', 'LICENSE'].includes(productType) ? productType : 'SAAS',
      salesPricePaise: sales,
      costPricePaise: Math.max(0, cost),
      description: description ? String(description).trim() : '',
      status: 'ACTIVE',
      createdAt: now,
    };

    dbState.products.unshift(product);

    const createdVariants: ProductVariant[] = [];
    if (Array.isArray(variants)) {
      variants.forEach((v: Partial<ProductVariant>, idx: number) => {
        if (v.attributeName && v.attributeValue) {
          const pv: ProductVariant = {
            id: `var_${Date.now()}_${idx + 1}`,
            productId: product.id,
            attributeName: String(v.attributeName).trim(),
            attributeValue: String(v.attributeValue).trim(),
            additionalPricePaise: Math.round(Number(v.additionalPricePaise || 0)),
            sku: v.sku ? String(v.sku).trim() : `${product.name.slice(0, 3).toUpperCase()}-${idx + 1}`,
            status: 'ACTIVE',
          };
          dbState.productVariants.push(pv);
          createdVariants.push(pv);
        }
      });
    }

    recordAudit(
      req.currentUser!,
      'CREATED_PRODUCT',
      'Product',
      product.id,
      `Created product "${product.name}" with ${createdVariants.length} variant(s).`
    );
    saveDatabase(dbState);
    return res.status(201).json({ product, variants: createdVariants });
  });

  app.put('/api/products/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const idx = dbState.products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Product not found.' });

    const existing = dbState.products[idx];
    const { name, productType, salesPricePaise, costPricePaise, description, status } = req.body || {};

    const updated: Product = {
      ...existing,
      name: name ? String(name).trim() : existing.name,
      productType: productType || existing.productType,
      salesPricePaise: salesPricePaise !== undefined ? Math.max(0, Math.round(Number(salesPricePaise))) : existing.salesPricePaise,
      costPricePaise: costPricePaise !== undefined ? Math.max(0, Math.round(Number(costPricePaise))) : existing.costPricePaise,
      description: description !== undefined ? String(description).trim() : existing.description,
      status: status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    };

    dbState.products[idx] = updated;
    recordAudit(req.currentUser!, 'UPDATED_PRODUCT', 'Product', updated.id, `Updated product "${updated.name}".`);
    saveDatabase(dbState);
    return res.json({ product: updated });
  });

  app.delete('/api/products/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const prod = dbState.products.find((p) => p.id === req.params.id);
    if (!prod) return res.status(404).json({ error: 'Product not found.' });
    dbState.products = dbState.products.filter((p) => p.id !== req.params.id);
    dbState.productVariants = dbState.productVariants.filter((v) => v.productId !== req.params.id);
    recordAudit(req.currentUser!, 'DELETED_PRODUCT', 'Product', prod.id, `Deleted product "${prod.name}".`);
    saveDatabase(dbState);
    return res.json({ deletedId: prod.id });
  });

  app.post('/api/variants', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const { productId, attributeName, attributeValue, additionalPricePaise, sku } = req.body || {};
    const product = dbState.products.find((p) => p.id === productId);
    if (!product) return res.status(404).json({ error: 'Parent product not found.' });
    if (!attributeName || !attributeValue) {
      return res.status(400).json({ error: 'Variant attribute name and value are required.' });
    }

    const variant: ProductVariant = {
      id: `var_${Date.now()}`,
      productId: product.id,
      attributeName: String(attributeName).trim(),
      attributeValue: String(attributeValue).trim(),
      additionalPricePaise: Math.round(Number(additionalPricePaise || 0)),
      sku: sku ? String(sku).trim() : `${product.name.slice(0, 3).toUpperCase()}-${ String(attributeValue).slice(0, 4).toUpperCase() }`,
      status: 'ACTIVE',
    };
    dbState.productVariants.push(variant);

    const calculatedUnitPricePaise = calculateVariantUnitPricePaise(product, variant);
    recordAudit(
      req.currentUser!,
      'CREATED_VARIANT',
      'ProductVariant',
      variant.id,
      `Added variant ${variant.attributeName}: ${variant.attributeValue} to ${product.name}.`
    );
    saveDatabase(dbState);
    return res.status(201).json({ variant, calculatedUnitPricePaise });
  });

  // ============================================================================
  // SUBSCRIPTION PLAN MANAGEMENT (ADMIN ONLY)
  // ============================================================================

  app.post('/api/plans', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const {
      name,
      relatedProductIds,
      pricePaise,
      billingFrequency,
      minQuantity,
      availableFrom,
      availableUntil,
      autoCloseDays,
      allowEarlyClosure,
      allowPause,
      allowRenewal,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Plan name is required.' });
    }
    const price = Math.round(Number(pricePaise));
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'Valid plan price is required.' });
    }

    const newPlan: Plan = {
      id: `plan_${Date.now()}`,
      name: String(name).trim(),
      relatedProductIds: Array.isArray(relatedProductIds) ? relatedProductIds : [],
      pricePaise: price,
      billingFrequency: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(billingFrequency)
        ? billingFrequency
        : 'MONTHLY',
      minQuantity: Math.max(1, Math.round(Number(minQuantity || 1))),
      availableFrom: availableFrom || '2026-01-01',
      availableUntil: availableUntil || '2028-12-31',
      autoCloseDays: Math.max(0, Math.round(Number(autoCloseDays ?? 30))),
      allowEarlyClosure: Boolean(allowEarlyClosure),
      allowPause: Boolean(allowPause),
      allowRenewal: Boolean(allowRenewal ?? true),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    dbState.plans.unshift(newPlan);
    recordAudit(req.currentUser!, 'CREATED_PLAN', 'Plan', newPlan.id, `Created billing plan "${newPlan.name}" (${newPlan.billingFrequency}).`);
    saveDatabase(dbState);
    return res.status(201).json({ plan: newPlan });
  });

  app.put('/api/plans/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const idx = dbState.plans.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Plan not found.' });

    const existing = dbState.plans[idx];
    const updated: Plan = {
      ...existing,
      ...req.body,
      id: existing.id,
      pricePaise: req.body.pricePaise !== undefined ? Math.max(0, Math.round(Number(req.body.pricePaise))) : existing.pricePaise,
      minQuantity: req.body.minQuantity !== undefined ? Math.max(1, Math.round(Number(req.body.minQuantity))) : existing.minQuantity,
    };
    dbState.plans[idx] = updated;
    recordAudit(req.currentUser!, 'UPDATED_PLAN', 'Plan', updated.id, `Updated plan "${updated.name}" (Status: ${updated.status}).`);
    saveDatabase(dbState);
    return res.json({ plan: updated });
  });

  app.delete('/api/plans/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const plan = dbState.plans.find((p) => p.id === req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    dbState.plans = dbState.plans.filter((p) => p.id !== req.params.id);
    recordAudit(req.currentUser!, 'DELETED_PLAN', 'Plan', plan.id, `Deleted plan "${plan.name}".`);
    saveDatabase(dbState);
    return res.json({ deletedId: plan.id });
  });

  // ============================================================================
  // QUOTATION TEMPLATES & QUOTATIONS (ADMIN & STAFF)
  // ============================================================================

  app.post('/api/quotation-templates', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const { name, planId, validityDays, description, defaultProductIds } = req.body || {};
    if (!name || !planId) {
      return res.status(400).json({ error: 'Template name and plan are required.' });
    }
    const tpl: QuotationTemplate = {
      id: `qtpl_${Date.now()}`,
      name: String(name).trim(),
      planId: String(planId),
      validityDays: Math.max(1, Math.round(Number(validityDays || 15))),
      description: description ? String(description).trim() : '',
      defaultProductIds: Array.isArray(defaultProductIds) ? defaultProductIds : [],
      createdAt: new Date().toISOString(),
    };
    dbState.quotationTemplates.unshift(tpl);
    saveDatabase(dbState);
    return res.status(201).json({ template: tpl });
  });

  app.post('/api/quotations', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const { customerId, planId, validityDays, taxRuleId, discountCode, lines, status } = req.body || {};
    const customer = dbState.customers.find((c) => c.id === customerId);
    const plan = dbState.plans.find((p) => p.id === planId);
    if (!customer) return res.status(400).json({ error: 'Please select a valid customer.' });
    if (!plan) return res.status(400).json({ error: 'Please select a valid subscription plan.' });
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'At least one product line is required.' });
    }

    const nowStr = new Date().toISOString().slice(0, 10);
    const taxRule = taxRuleId ? dbState.taxRules.find((t) => t.id === taxRuleId) || null : null;
    const discountRule = discountCode
      ? dbState.discountRules.find((d) => d.code.toUpperCase() === String(discountCode).trim().toUpperCase()) || null
      : null;

    const preparedLines: Array<{
      productId: string;
      productName: string;
      variantId?: string;
      variantLabel?: string;
      quantity: number;
      unitPricePaise: number;
      lineTotalPaise: number;
    }> = [];

    for (const rawLine of lines) {
      const prod = dbState.products.find((p) => p.id === rawLine.productId);
      if (!prod) continue;
      const variant = rawLine.variantId
        ? dbState.productVariants.find((v) => v.id === rawLine.variantId)
        : undefined;
      const qty = Math.max(1, Math.round(Number(rawLine.quantity || 1)));
      const unitPricePaise =
        rawLine.unitPricePaise !== undefined
          ? Math.max(0, Math.round(Number(rawLine.unitPricePaise)))
          : calculateVariantUnitPricePaise(prod, variant);

      preparedLines.push({
        productId: prod.id,
        productName: prod.name,
        variantId: variant?.id,
        variantLabel: variant ? `${variant.attributeName}: ${variant.attributeValue}` : undefined,
        quantity: qty,
        unitPricePaise,
        lineTotalPaise: qty * unitPricePaise,
      });
    }

    if (preparedLines.length === 0) {
      return res.status(400).json({ error: 'Valid product line items are required.' });
    }

    const calc = calculateDocumentTotals({
      lines: preparedLines,
      taxRule,
      discountRule,
      referenceDateStr: nowStr,
    });

    const vDays = Math.max(1, Math.round(Number(validityDays || 15)));
    const validUntilDate = new Date();
    validUntilDate.setUTCDate(validUntilDate.getUTCDate() + vDays);

    const quotationId = `quo_${Date.now()}`;
    const seq = dbState.quotations.length + 41;
    const quotation: Quotation = {
      id: quotationId,
      quotationNumber: `QTN-2026-${String(seq).padStart(4, '0')}`,
      customerId: customer.id,
      customerName: `${customer.name}${customer.company ? ` (${customer.company})` : ''}`,
      planId: plan.id,
      planName: plan.name,
      validityDays: vDays,
      validUntil: validUntilDate.toISOString().slice(0, 10),
      taxRuleId: taxRule?.id,
      discountCode: calc.discountApplied && discountRule ? discountRule.code : undefined,
      subtotalPaise: calc.subtotalPaise,
      discountPaise: calc.discountPaise,
      taxPaise: calc.taxPaise,
      totalPaise: calc.totalPaise,
      status: ['DRAFT', 'QUOTATION', 'CONFIRMED'].includes(status) ? status : 'QUOTATION',
      createdAt: new Date().toISOString(),
    };

    const createdLines: SubscriptionLine[] = preparedLines.map((pl, idx) => ({
      id: `qline_${quotationId}_${idx + 1}`,
      subscriptionId: quotationId,
      ...pl,
    }));

    dbState.quotations.unshift(quotation);
    dbState.subscriptionLines.push(...createdLines);

    recordAudit(
      req.currentUser!,
      'CREATED_QUOTATION',
      'Quotation',
      quotation.id,
      `Created quotation ${quotation.quotationNumber} for ${customer.name}.`
    );
    saveDatabase(dbState);
    return res.status(201).json({ quotation, lines: createdLines, calculation: calc });
  });

  app.put('/api/quotations/:id/status', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const quo = dbState.quotations.find((q) => q.id === req.params.id);
    if (!quo) return res.status(404).json({ error: 'Quotation not found.' });
    const { status } = req.body || {};
    if (!['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'CLOSED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid quotation status.' });
    }
    quo.status = status;
    recordAudit(
      req.currentUser!,
      'UPDATED_QUOTATION_STATUS',
      'Quotation',
      quo.id,
      `Updated quotation ${quo.quotationNumber} status to ${status}.`
    );
    saveDatabase(dbState);
    return res.json({ quotation: quo });
  });

  app.post('/api/quotations/:id/convert', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const quo = dbState.quotations.find((q) => q.id === req.params.id);
    if (!quo) return res.status(404).json({ error: 'Quotation not found.' });
    if (quo.convertedSubscriptionId) {
      const existingSub = dbState.subscriptions.find((s) => s.id === quo.convertedSubscriptionId);
      if (existingSub) {
        return res.json({ subscription: existingSub, quotation: quo });
      }
    }

    const plan = dbState.plans.find((p) => p.id === quo.planId);
    const freq = plan?.billingFrequency || 'MONTHLY';
    const startDate = new Date().toISOString().slice(0, 10);
    const expiryDateObj = new Date();
    expiryDateObj.setUTCFullYear(expiryDateObj.getUTCFullYear() + 1);
    const expiryDate = expiryDateObj.toISOString().slice(0, 10);

    const subId = `sub_${Date.now()}`;
    const seq = dbState.subscriptions.length + 1001;
    const newSub: Subscription = {
      id: subId,
      subscriptionNumber: `SUB-2026-${seq}`,
      customerId: quo.customerId,
      customerName: quo.customerName,
      planId: quo.planId,
      planName: quo.planName,
      billingFrequency: freq,
      startDate,
      expiryDate,
      nextBillingDate: startDate, // Ready for immediate billing!
      paymentTerms: 'Net 15 Days',
      taxRuleId: quo.taxRuleId,
      discountCode: quo.discountCode,
      subtotalPaise: quo.subtotalPaise,
      discountPaise: quo.discountPaise,
      taxPaise: quo.taxPaise,
      totalPaise: quo.totalPaise,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    const quoLines = dbState.subscriptionLines.filter((l) => l.subscriptionId === quo.id);
    const newSubLines: SubscriptionLine[] = quoLines.map((ql, idx) => ({
      ...ql,
      id: `sline_${subId}_${idx + 1}`,
      subscriptionId: subId,
    }));

    quo.status = 'ACTIVE';
    quo.convertedSubscriptionId = subId;

    dbState.subscriptions.unshift(newSub);
    dbState.subscriptionLines.push(...newSubLines);

    recordAudit(
      req.currentUser!,
      'CONVERTED_QUOTATION_TO_SUBSCRIPTION',
      'Subscription',
      newSub.id,
      `Converted quotation ${quo.quotationNumber} into active subscription ${newSub.subscriptionNumber}.`
    );
    saveDatabase(dbState);
    return res.status(201).json({ subscription: newSub, quotation: quo, lines: newSubLines });
  });

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  app.post('/api/subscriptions', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const {
      customerId,
      planId,
      startDate,
      expiryDate,
      paymentTerms,
      taxRuleId,
      discountCode,
      lines,
      status,
    } = req.body || {};

    const customer = dbState.customers.find((c) => c.id === customerId);
    const plan = dbState.plans.find((p) => p.id === planId);
    if (!customer) return res.status(400).json({ error: 'Valid customer is required.' });
    if (!plan) return res.status(400).json({ error: 'Valid subscription plan is required.' });

    const start = startDate || new Date().toISOString().slice(0, 10);
    const expiry =
      expiryDate ||
      (() => {
        const d = new Date(start + 'T00:00:00Z');
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        return d.toISOString().slice(0, 10);
      })();

    const taxRule = taxRuleId ? dbState.taxRules.find((t) => t.id === taxRuleId) || null : null;
    const discountRule = discountCode
      ? dbState.discountRules.find((d) => d.code.toUpperCase() === String(discountCode).trim().toUpperCase()) || null
      : null;

    const preparedLines: Array<{
      productId: string;
      productName: string;
      variantId?: string;
      variantLabel?: string;
      quantity: number;
      unitPricePaise: number;
      lineTotalPaise: number;
    }> = [];

    if (Array.isArray(lines) && lines.length > 0) {
      for (const rawLine of lines) {
        const prod = dbState.products.find((p) => p.id === rawLine.productId);
        if (!prod) continue;
        const variant = rawLine.variantId
          ? dbState.productVariants.find((v) => v.id === rawLine.variantId)
          : undefined;
        const qty = Math.max(plan.minQuantity || 1, Math.round(Number(rawLine.quantity || 1)));
        const unitPricePaise =
          rawLine.unitPricePaise !== undefined
            ? Math.max(0, Math.round(Number(rawLine.unitPricePaise)))
            : calculateVariantUnitPricePaise(prod, variant);
        preparedLines.push({
          productId: prod.id,
          productName: prod.name,
          variantId: variant?.id,
          variantLabel: variant ? `${variant.attributeName}: ${variant.attributeValue}` : undefined,
          quantity: qty,
          unitPricePaise,
          lineTotalPaise: qty * unitPricePaise,
        });
      }
    }

    if (preparedLines.length === 0) {
      preparedLines.push({
        productId: plan.relatedProductIds?.[0] || dbState.products[0]?.id || 'prod_101',
        productName: plan.name,
        quantity: plan.minQuantity || 1,
        unitPricePaise: plan.pricePaise,
        lineTotalPaise: (plan.minQuantity || 1) * plan.pricePaise,
      });
    }

    const calc = calculateDocumentTotals({
      lines: preparedLines,
      taxRule,
      discountRule,
      referenceDateStr: start,
    });

    const subId = `sub_${Date.now()}`;
    const seq = dbState.subscriptions.length + 1001;
    const newSub: Subscription = {
      id: subId,
      subscriptionNumber: `SUB-2026-${seq}`,
      customerId: customer.id,
      customerName: `${customer.name}${customer.company ? ` (${customer.company})` : ''}`,
      planId: plan.id,
      planName: plan.name,
      billingFrequency: plan.billingFrequency,
      startDate: start,
      expiryDate: expiry,
      nextBillingDate: start,
      paymentTerms: paymentTerms || 'Net 15 Days',
      taxRuleId: taxRule?.id,
      discountCode: calc.discountApplied && discountRule ? discountRule.code : undefined,
      subtotalPaise: calc.subtotalPaise,
      discountPaise: calc.discountPaise,
      taxPaise: calc.taxPaise,
      totalPaise: calc.totalPaise,
      status: ['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE'].includes(status) ? status : 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    const createdLines: SubscriptionLine[] = preparedLines.map((pl, idx) => ({
      id: `sline_${subId}_${idx + 1}`,
      subscriptionId: subId,
      ...pl,
    }));

    dbState.subscriptions.unshift(newSub);
    dbState.subscriptionLines.push(...createdLines);

    recordAudit(
      req.currentUser!,
      'CREATED_SUBSCRIPTION',
      'Subscription',
      newSub.id,
      `Created subscription ${newSub.subscriptionNumber} (${newSub.status}) for ${customer.name}.`
    );
    saveDatabase(dbState);
    return res.status(201).json({ subscription: newSub, lines: createdLines });
  });

  app.put('/api/subscriptions/:id/lifecycle', requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']), (req: AuthenticatedRequest, res: Response) => {
    const sub = dbState.subscriptions.find((s) => s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });

    const user = req.currentUser!;
    if (user.role === 'CUSTOMER') {
      const cust = dbState.customers.find((c) => c.id === user.customerId || c.userId === user.id);
      if (!cust || sub.customerId !== cust.id) {
        return res.status(403).json({ error: 'You can only manage your own subscriptions.' });
      }
    }

    const { action, targetStatus } = req.body || {};
    const plan = dbState.plans.find((p) => p.id === sub.planId);

    if (action === 'RENEW') {
      if (plan && !plan.allowRenewal && user.role !== 'ADMIN') {
        return res.status(400).json({ error: 'This subscription plan does not allow renewal.' });
      }
      sub.expiryDate = advanceBillingDate(sub.expiryDate, 'YEARLY');
      sub.status = 'ACTIVE';
      const audit = recordAudit(
        user,
        'RENEWED_SUBSCRIPTION',
        'Subscription',
        sub.id,
        `Renewed subscription ${sub.subscriptionNumber}. New expiry date: ${sub.expiryDate}.`
      );
      saveDatabase(dbState);
      return res.json({ subscription: sub, audit });
    }

    const nextStatus = targetStatus as SubscriptionStatus;
    if (!nextStatus) {
      return res.status(400).json({ error: 'Target subscription status is required.' });
    }

    if (nextStatus === 'PAUSED' && plan && !plan.allowPause && user.role !== 'ADMIN') {
      return res.status(400).json({ error: 'This plan does not allow pausing subscriptions.' });
    }
    if (nextStatus === 'CLOSED' && plan && !plan.allowEarlyClosure && user.role === 'CUSTOMER') {
      return res.status(400).json({ error: 'Early closure is restricted by the subscription plan policy.' });
    }

    if (!isValidSubscriptionTransition(sub.status, nextStatus) && user.role !== 'ADMIN') {
      return res.status(400).json({
        error: `Invalid lifecycle transition from ${sub.status} to ${nextStatus}.`,
      });
    }

    const prevStatus = sub.status;
    sub.status = nextStatus;

    const audit = recordAudit(
      user,
      `SUBSCRIPTION_${nextStatus}`,
      'Subscription',
      sub.id,
      `Changed subscription ${sub.subscriptionNumber} status from ${prevStatus} to ${nextStatus}.`
    );
    saveDatabase(dbState);
    return res.json({ subscription: sub, audit });
  });

  // ============================================================================
  // AUTOMATIC & BATCH INVOICE GENERATION (IDEMPOTENT)
  // ============================================================================

  app.post('/api/invoices/generate-batch', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const billingDateStr = req.body?.billingDate || new Date().toISOString().slice(0, 10);

    const batchResult = runBatchInvoiceGeneration({
      subscriptions: dbState.subscriptions,
      subscriptionLines: dbState.subscriptionLines,
      existingInvoices: dbState.invoices,
      taxRules: dbState.taxRules,
      discountRules: dbState.discountRules,
      billingDateStr,
    });

    if (batchResult.generatedInvoices.length > 0) {
      dbState.invoices.unshift(...batchResult.generatedInvoices);
      dbState.invoiceLines.push(...batchResult.generatedInvoiceLines);

      const updatedSubMap = new Map(batchResult.updatedSubscriptions.map((s) => [s.id, s]));
      dbState.subscriptions = dbState.subscriptions.map((s) => updatedSubMap.get(s.id) || s);
      dbState.discountRules = batchResult.updatedDiscountRules;

      recordAudit(
        req.currentUser!,
        'BATCH_INVOICES_GENERATED',
        'Invoice',
        batchResult.generatedInvoices[0].id,
        `Generated ${batchResult.generatedInvoices.length} due invoice(s) for billing date ${billingDateStr} (${batchResult.skippedDuplicateCount} duplicate period(s) skipped).`
      );
      saveDatabase(dbState);
    }

    return res.json({
      generatedCount: batchResult.generatedInvoices.length,
      skippedDuplicateCount: batchResult.skippedDuplicateCount,
      generatedInvoices: batchResult.generatedInvoices,
    });
  });

  app.post('/api/subscriptions/:id/generate-invoice', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const sub = dbState.subscriptions.find((s) => s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    if (sub.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Only ACTIVE subscriptions can generate billing invoices.' });
    }

    const billingDateStr = req.body?.billingDate || sub.nextBillingDate || new Date().toISOString().slice(0, 10);
    const batchResult = runBatchInvoiceGeneration({
      subscriptions: [sub],
      subscriptionLines: dbState.subscriptionLines,
      existingInvoices: dbState.invoices,
      taxRules: dbState.taxRules,
      discountRules: dbState.discountRules,
      billingDateStr,
    });

    if (batchResult.generatedInvoices.length === 0) {
      return res.status(409).json({
        error: `Duplicate prevented: An invoice for subscription ${sub.subscriptionNumber} in billing period ${sub.nextBillingDate || billingDateStr} already exists.`,
        skippedDuplicateCount: batchResult.skippedDuplicateCount,
      });
    }

    dbState.invoices.unshift(...batchResult.generatedInvoices);
    dbState.invoiceLines.push(...batchResult.generatedInvoiceLines);
    const updatedSub = batchResult.updatedSubscriptions[0];
    if (updatedSub) {
      const idx = dbState.subscriptions.findIndex((s) => s.id === sub.id);
      if (idx !== -1) dbState.subscriptions[idx] = updatedSub;
    }
    dbState.discountRules = batchResult.updatedDiscountRules;

    recordAudit(
      req.currentUser!,
      'GENERATED_SUBSCRIPTION_INVOICE',
      'Invoice',
      batchResult.generatedInvoices[0].id,
      `Generated invoice ${batchResult.generatedInvoices[0].invoiceNumber} for ${sub.subscriptionNumber}.`
    );
    saveDatabase(dbState);
    return res.status(201).json({
      invoice: batchResult.generatedInvoices[0],
      subscription: updatedSub,
    });
  });

  // ============================================================================
  // PAYMENT MANAGEMENT (WITH OWNERSHIP & DUPLICATE PAYMENT PROTECTION)
  // ============================================================================

  app.post(
    '/api/payments',
    sensitiveRateLimiter,
    requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']),
    (req: AuthenticatedRequest, res: Response) => {
      const { invoiceId, paymentMethod, amountPaise, paymentDate, transactionReference, notes } =
        req.body || {};
      const invIdx = dbState.invoices.findIndex((i) => i.id === invoiceId);
      if (invIdx === -1) return res.status(404).json({ error: 'Invoice not found.' });

      const invoice = dbState.invoices[invIdx];
      const user = req.currentUser!;

      // Customer ownership check: customers can only pay their own invoices
      if (user.role === 'CUSTOMER') {
        const cust = findCustomerForUser(user);
        if (!cust || invoice.customerId !== cust.id) {
          return res.status(403).json({
            error: 'Access denied. You can only submit payments for your own invoices.',
          });
        }
      }

      const resolvedTxRef = transactionReference
        ? String(transactionReference).trim()
        : `TXN-${Date.now().toString().slice(-8)}`;

      const payRes = applyPaymentToInvoice(
        invoice,
        Number(amountPaise),
        paymentDate || new Date().toISOString().slice(0, 10),
        {
          existingPayments: dbState.payments,
          transactionReference: resolvedTxRef,
        }
      );

      if (!payRes.valid || !payRes.updatedInvoice) {
        return res.status(payRes.isDuplicate ? 409 : 400).json({ error: payRes.error });
      }

      const seq = dbState.payments.length + 81;
      const payment = {
        id: `pay_${Date.now()}`,
        paymentNumber: `PAY-2026-${String(seq).padStart(4, '0')}`,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentMethod: ['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'].includes(paymentMethod)
          ? paymentMethod
          : 'UPI',
        amountPaise: Math.round(Number(amountPaise)),
        paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
        transactionReference: resolvedTxRef,
        notes: notes ? String(notes).trim().slice(0, 500) : '',
        createdAt: new Date().toISOString(),
      };

      dbState.invoices[invIdx] = payRes.updatedInvoice;
      dbState.payments.unshift(payment);

      recordAudit(
        user,
        'RECORDED_PAYMENT',
        'Payment',
        payment.id,
        `Recorded ${payment.paymentMethod} payment of ₹${(payment.amountPaise / 100).toFixed(2)} for ${invoice.invoiceNumber} (Ref: ${payment.transactionReference}).`
      );
      saveDatabase(dbState);
      return res.status(201).json({ payment, invoice: payRes.updatedInvoice });
    }
  );

  // ============================================================================
  // INDIVIDUAL RECORD & BILLING HISTORY ENDPOINTS (OWNERSHIP VERIFIED)
  // ============================================================================

  app.get(
    '/api/invoices/:id',
    requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']),
    (req: AuthenticatedRequest, res: Response) => {
      const invoice = dbState.invoices.find((i) => i.id === req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
      const user = req.currentUser!;
      if (user.role === 'CUSTOMER') {
        const cust = findCustomerForUser(user);
        if (!cust || invoice.customerId !== cust.id) {
          return res.status(403).json({ error: 'Access denied. You do not own this invoice.' });
        }
      }
      const lines = dbState.invoiceLines.filter((l) => l.invoiceId === invoice.id);
      const payments = dbState.payments.filter((p) => p.invoiceId === invoice.id);
      return res.json({ invoice, lines, payments });
    }
  );

  app.get(
    '/api/subscriptions/:id',
    requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']),
    (req: AuthenticatedRequest, res: Response) => {
      const subscription = dbState.subscriptions.find((s) => s.id === req.params.id);
      if (!subscription) return res.status(404).json({ error: 'Subscription not found.' });
      const user = req.currentUser!;
      if (user.role === 'CUSTOMER') {
        const cust = findCustomerForUser(user);
        if (!cust || subscription.customerId !== cust.id) {
          return res.status(403).json({ error: 'Access denied. You do not own this subscription.' });
        }
      }
      const lines = dbState.subscriptionLines.filter((l) => l.subscriptionId === subscription.id);
      const invoices = dbState.invoices.filter((i) => i.subscriptionId === subscription.id);
      return res.json({ subscription, lines, invoices });
    }
  );

  app.get(
    '/api/customers/:id/billing-history',
    requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']),
    (req: AuthenticatedRequest, res: Response) => {
      const customer = dbState.customers.find((c) => c.id === req.params.id);
      if (!customer) return res.status(404).json({ error: 'Customer not found.' });
      const user = req.currentUser!;
      if (user.role === 'CUSTOMER') {
        const cust = findCustomerForUser(user);
        if (!cust || customer.id !== cust.id) {
          return res.status(403).json({
            error: 'Access denied. You can only view your own billing history.',
          });
        }
      }
      const subscriptions = dbState.subscriptions.filter((s) => s.customerId === customer.id);
      const quotations = dbState.quotations.filter((q) => q.customerId === customer.id);
      const invoices = dbState.invoices.filter((i) => i.customerId === customer.id);
      const payments = dbState.payments.filter((p) => p.customerId === customer.id);
      const totalBilledPaise = invoices.reduce((sum, i) => sum + i.grandTotalPaise, 0);
      const totalPaidPaise = payments.reduce((sum, p) => sum + p.amountPaise, 0);
      const totalOutstandingPaise = invoices.reduce((sum, i) => sum + i.balanceDuePaise, 0);

      return res.json({
        customer,
        subscriptions,
        quotations,
        invoices,
        payments,
        summary: {
          totalBilledPaise,
          totalPaidPaise,
          totalOutstandingPaise,
        },
      });
    }
  );

  // ============================================================================
  // TAX & DISCOUNT RULES MANAGEMENT (ADMIN ONLY)
  // ============================================================================

  app.post('/api/taxes', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const { name, percentageBasisPoints, taxType, effectiveStartDate, effectiveEndDate } = req.body || {};
    if (!name || percentageBasisPoints === undefined) {
      return res.status(400).json({ error: 'Tax name and percentage are required.' });
    }
    const tax: TaxRule = {
      id: `tax_${Date.now()}`,
      name: String(name).trim(),
      percentageBasisPoints: Math.max(0, Math.min(10000, Math.round(Number(percentageBasisPoints)))),
      taxType: ['GST', 'IGST', 'CGST_SGST', 'VAT', 'CUSTOM'].includes(taxType) ? taxType : 'GST',
      effectiveStartDate: effectiveStartDate || '2026-01-01',
      effectiveEndDate: effectiveEndDate || '2028-12-31',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    dbState.taxRules.unshift(tax);
    recordAudit(req.currentUser!, 'CREATED_TAX_RULE', 'TaxRule', tax.id, `Created tax rule "${tax.name}".`);
    saveDatabase(dbState);
    return res.status(201).json({ taxRule: tax });
  });

  app.put('/api/taxes/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const idx = dbState.taxRules.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Tax rule not found.' });
    dbState.taxRules[idx] = { ...dbState.taxRules[idx], ...req.body, id: dbState.taxRules[idx].id };
    saveDatabase(dbState);
    return res.json({ taxRule: dbState.taxRules[idx] });
  });

  app.post('/api/discounts', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const {
      name,
      code,
      discountType,
      value,
      minPurchasePaise,
      minQuantity,
      startDate,
      endDate,
      maxUsageCount,
      scope,
      applicableProductIds,
    } = req.body || {};

    if (!name || !code || value === undefined) {
      return res.status(400).json({ error: 'Discount name, code, and value are required.' });
    }

    const discount: DiscountRule = {
      id: `disc_${Date.now()}`,
      name: String(name).trim(),
      code: String(code).trim().toUpperCase(),
      discountType: discountType === 'FIXED_PAISE' ? 'FIXED_PAISE' : 'PERCENTAGE',
      value: Math.max(0, Math.round(Number(value))),
      minPurchasePaise: Math.max(0, Math.round(Number(minPurchasePaise || 0))),
      minQuantity: Math.max(1, Math.round(Number(minQuantity || 1))),
      startDate: startDate || '2026-01-01',
      endDate: endDate || '2027-12-31',
      maxUsageCount: Math.max(1, Math.round(Number(maxUsageCount || 100))),
      usedCount: 0,
      scope: scope === 'PRODUCT_SPECIFIC' ? 'PRODUCT_SPECIFIC' : 'SUBSCRIPTION_WIDE',
      applicableProductIds: Array.isArray(applicableProductIds) ? applicableProductIds : [],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    dbState.discountRules.unshift(discount);
    recordAudit(req.currentUser!, 'CREATED_DISCOUNT_RULE', 'DiscountRule', discount.id, `Created discount code ${discount.code}.`);
    saveDatabase(dbState);
    return res.status(201).json({ discountRule: discount });
  });

  app.put('/api/discounts/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const idx = dbState.discountRules.findIndex((d) => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Discount rule not found.' });
    dbState.discountRules[idx] = { ...dbState.discountRules[idx], ...req.body, id: dbState.discountRules[idx].id };
    saveDatabase(dbState);
    return res.json({ discountRule: dbState.discountRules[idx] });
  });

  // ============================================================================
  // CUSTOMER & STAFF MANAGEMENT
  // ============================================================================

  app.post('/api/customers', requireRoles(['ADMIN', 'STAFF']), (req: AuthenticatedRequest, res: Response) => {
    const { name, email, phone, company, gstin, billingAddress } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'Customer name and email are required.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (dbState.customers.some((c) => c.email.toLowerCase() === normalizedEmail)) {
      return res.status(409).json({ error: 'A customer with this email already exists.' });
    }
    const customer: Customer = {
      id: `cust_${Date.now()}`,
      name: String(name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : '',
      company: company ? String(company).trim() : '',
      gstin: gstin ? String(gstin).trim().toUpperCase() : '',
      billingAddress: billingAddress ? String(billingAddress).trim() : '',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    dbState.customers.unshift(customer);
    recordAudit(req.currentUser!, 'CREATED_CUSTOMER', 'Customer', customer.id, `Added customer ${customer.name}.`);
    saveDatabase(dbState);
    return res.status(201).json({ customer });
  });

  app.put('/api/customers/:id', requireRoles(['ADMIN', 'STAFF', 'CUSTOMER']), (req: AuthenticatedRequest, res: Response) => {
    const idx = dbState.customers.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Customer not found.' });
    const existing = dbState.customers[idx];

    if (req.currentUser!.role === 'CUSTOMER' && existing.id !== req.currentUser!.customerId && existing.userId !== req.currentUser!.id) {
      return res.status(403).json({ error: 'Cannot edit another customer profile.' });
    }

    const updated: Customer = {
      ...existing,
      name: req.body.name ? String(req.body.name).trim() : existing.name,
      phone: req.body.phone !== undefined ? String(req.body.phone).trim() : existing.phone,
      company: req.body.company !== undefined ? String(req.body.company).trim() : existing.company,
      gstin: req.body.gstin !== undefined ? String(req.body.gstin).trim().toUpperCase() : existing.gstin,
      billingAddress: req.body.billingAddress !== undefined ? String(req.body.billingAddress).trim() : existing.billingAddress,
      status: req.currentUser!.role !== 'CUSTOMER' && req.body.status ? req.body.status : existing.status,
    };
    dbState.customers[idx] = updated;
    saveDatabase(dbState);
    return res.json({ customer: updated });
  });

  app.post('/api/staff', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const { name, email, department, role, password } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'Staff name and email are required.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (dbState.staff.some((s) => s.email.toLowerCase() === normalizedEmail) || dbState.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const pwToUse = password ? String(password) : 'Staff@2026!';
    const pwCheck = validatePasswordStrength(pwToUse);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.errors[0] });
    }

    const now = new Date().toISOString();
    const userId = `usr_stf_${Date.now()}`;
    const staffId = `stf_${Date.now()}`;
    const assignedRole: 'ADMIN' | 'STAFF' = role === 'ADMIN' ? 'ADMIN' : 'STAFF';

    const newUser: User = {
      id: userId,
      email: normalizedEmail,
      name: String(name).trim(),
      role: assignedRole,
      status: 'ACTIVE',
      createdAt: now,
    };

    const newStaff: Staff = {
      id: staffId,
      userId,
      name: String(name).trim(),
      email: normalizedEmail,
      department: department ? String(department).trim() : 'Operations',
      role: assignedRole,
      status: 'ACTIVE',
      createdAt: now,
    };

    dbState.users.push(newUser);
    dbState.staff.unshift(newStaff);
    credentialsStore[normalizedEmail] = {
      passwordHash: hashPasswordWithRandomSalt(pwToUse),
      userId,
      updatedAt: now,
    };

    recordAudit(
      req.currentUser!,
      'CREATED_STAFF_ACCOUNT',
      'Staff',
      staffId,
      `Created ${assignedRole} staff account for ${newStaff.name} (${newStaff.email}).`
    );
    saveDatabase(dbState);
    saveCredentials(credentialsStore);
    return res.status(201).json({ staff: newStaff, user: newUser });
  });

  app.put('/api/staff/:id', requireRoles(['ADMIN']), (req: AuthenticatedRequest, res: Response) => {
    const idx = dbState.staff.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Staff member not found.' });
    const existing = dbState.staff[idx];

    const updated: Staff = {
      ...existing,
      name: req.body.name ? String(req.body.name).trim() : existing.name,
      department: req.body.department !== undefined ? String(req.body.department).trim() : existing.department,
      role: req.body.role === 'ADMIN' || req.body.role === 'STAFF' ? req.body.role : existing.role,
      status: req.body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    };
    dbState.staff[idx] = updated;

    if (existing.userId) {
      const uIdx = dbState.users.findIndex((u) => u.id === existing.userId);
      if (uIdx !== -1) {
        dbState.users[uIdx].role = updated.role;
        dbState.users[uIdx].status = updated.status;
        dbState.users[uIdx].name = updated.name;
      }
    }

    recordAudit(
      req.currentUser!,
      'UPDATED_STAFF_ACCOUNT',
      'Staff',
      updated.id,
      `Updated staff member ${updated.name} (Role: ${updated.role}, Status: ${updated.status}).`
    );
    saveDatabase(dbState);
    return res.json({ staff: updated });
  });

  // ============================================================================
  // ADMIN SECURITY AUDIT & NON-DESTRUCTIVE BACKUP ENDPOINTS
  // ============================================================================

  app.get(
    '/api/admin/security-status',
    requireRoles(['ADMIN']),
    (req: AuthenticatedRequest, res: Response) => {
      const upcomingRenewals = getUpcomingRenewals(
        dbState.subscriptions,
        new Date().toISOString().slice(0, 10),
        60
      );
      return res.json({
        securityPosture: {
          headerTrustRemoved: true,
          bearerTokenVerification: 'HMAC-SHA256 Session JWT + Firebase RS256 ID Token',
          passwordHashing: 'scrypt with per-user 16-byte random salt + timingSafeEqual',
          rbacEnforcement: 'Server-controlled database role lookup (ADMIN / STAFF / CUSTOMER)',
          customerOwnershipIsolation: true,
          demoModeEnabled: process.env.ENABLE_DEMO_MODE !== 'false',
          rateLimitingActive: true,
          firestoreDatabaseId:
            process.env.FIREBASE_DATABASE_ID ||
            'ai-studio-brightloop-f68b4de1-e5a1-44cf-8391-2e577a275e07',
        },
        backups: listDatabaseBackups(),
        upcomingRenewalsCount: upcomingRenewals.length,
        collectionCounts: {
          users: dbState.users.length,
          customers: dbState.customers.length,
          staff: dbState.staff.length,
          products: dbState.products.length,
          plans: dbState.plans.length,
          subscriptions: dbState.subscriptions.length,
          invoices: dbState.invoices.length,
          payments: dbState.payments.length,
        },
        requestedBy: req.currentUser!.email,
      });
    }
  );

  app.post(
    '/api/admin/database/backup',
    sensitiveRateLimiter,
    requireRoles(['ADMIN']),
    (req: AuthenticatedRequest, res: Response) => {
      const label = req.body?.label
        ? String(req.body.label)
            .trim()
            .replace(/[^a-zA-Z0-9_-]/g, '')
            .slice(0, 32)
        : 'admin-snapshot';
      const result = createDatabaseBackup(label || 'admin-snapshot');
      recordAudit(
        req.currentUser!,
        'DATABASE_BACKUP_CREATED',
        'Database',
        result.backupFile,
        `Created non-destructive database backup snapshot ${result.backupFile}.`
      );
      saveDatabase(dbState);
      return res.status(201).json({
        backup: result,
        backups: listDatabaseBackups(),
      });
    }
  );

  return app;
}

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters in production.');
  }

  const app = await createBrightloopApp();
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Brightloop server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.BRIGHTLOOP_TEST_MODE !== '1') {
  startServer();
}

