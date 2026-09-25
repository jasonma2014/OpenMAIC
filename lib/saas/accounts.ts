import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { SaasRole } from '@/lib/saas/roles';
import { SAAS_SCHEMA_SQL } from '@/lib/saas/schema';

import { SAAS_SESSION_MAX_AGE_SECONDS } from './cookie';
import { hashPassword, verifyPassword } from './password';

export interface SaasQueryResult<T> {
  rows: T[];
}

/** Minimal query surface so account rules can run against Postgres or a test double. */
export interface SaasDb {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SaasQueryResult<T>>;
  transaction<T>(fn: (db: SaasDb) => Promise<T>): Promise<T>;
}

export class SaasInputError extends Error {}
export class SaasConflictError extends Error {}

export interface SaasPrincipal {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: SaasRole;
  balanceMilliYuan: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new SaasInputError('Email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new SaasInputError('Email is not valid');
  }
  return email;
}

export function assertPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new SaasInputError('Password must be 8 to 128 characters');
  }
  return value;
}

export function assertOrgName(value: unknown): string {
  if (typeof value !== 'string') throw new SaasInputError('Organization name is required');
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new SaasInputError('Organization name must be 1 to 80 characters');
  }
  return name;
}

/** Milli-yuan granted to a new organization. Unset or invalid means zero. */
export function signupCreditMilliYuan(envValue: string | undefined): number {
  if (envValue === undefined || envValue.trim() === '') return 0;
  if (!/^[0-9]+$/.test(envValue.trim())) return 0;
  const credit = Number(envValue.trim());
  if (!Number.isSafeInteger(credit)) return 0;
  return credit;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function ensureSaasSchema(db: SaasDb): Promise<void> {
  const statements = SAAS_SCHEMA_SQL.split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await db.query(statement);
  }
}

export async function registerOrgAdmin(
  db: SaasDb,
  input: { email: unknown; password: unknown; orgName: unknown },
  signupCredit: number,
): Promise<{ token: string; principal: SaasPrincipal }> {
  const email = normalizeEmail(input.email);
  const password = assertPassword(input.password);
  const orgName = assertOrgName(input.orgName);
  const passwordHash = await hashPassword(password);
  const orgId = randomUUID();
  const userId = randomUUID();
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SAAS_SESSION_MAX_AGE_SECONDS * 1000);

  try {
    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO saas_orgs (id, name) VALUES ($1, $2)', [orgId, orgName]);
      await tx.query('INSERT INTO saas_users (id, email, password_hash) VALUES ($1, $2, $3)', [
        userId,
        email,
        passwordHash,
      ]);
      await tx.query(
        `INSERT INTO saas_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')`,
        [orgId, userId],
      );
      await tx.query('INSERT INTO saas_wallets (org_id, balance_milli_yuan) VALUES ($1, $2)', [
        orgId,
        signupCredit,
      ]);
      if (signupCredit > 0) {
        await tx.query(
          `INSERT INTO saas_ledger (id, org_id, kind, cost_milli_yuan, retail_milli_yuan)
           VALUES ($1, $2, 'signup_grant', 0, $3)`,
          [randomUUID(), orgId, signupCredit],
        );
      }
      await tx.query(
        'INSERT INTO saas_sessions (token_hash, user_id, org_id, expires_at) VALUES ($1, $2, $3, $4)',
        [hashSessionToken(token), userId, orgId, expiresAt],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SaasConflictError('Email is already registered');
    throw error;
  }

  return {
    token,
    principal: {
      userId,
      email,
      orgId,
      orgName,
      role: 'org_admin',
      balanceMilliYuan: signupCredit,
    },
  };
}

interface LoginRow {
  user_id: string;
  email: string;
  password_hash: string;
  org_id: string;
  org_name: string;
  role: SaasRole;
  balance_milli_yuan: string | number;
}

export async function loginWithPassword(
  db: SaasDb,
  input: { email: unknown; password: unknown },
): Promise<{ token: string; principal: SaasPrincipal } | undefined> {
  const email = normalizeEmail(input.email);
  const password = assertPassword(input.password);
  const found = await db.query<LoginRow>(
    `SELECT u.id AS user_id, u.email, u.password_hash, o.id AS org_id, o.name AS org_name,
            m.role, w.balance_milli_yuan
     FROM saas_users u
     JOIN saas_memberships m ON m.user_id = u.id
     JOIN saas_orgs o ON o.id = m.org_id
     JOIN saas_wallets w ON w.org_id = o.id
     WHERE u.email = $1
     ORDER BY CASE m.role WHEN 'org_admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END
     LIMIT 1`,
    [email],
  );
  const row = found.rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) return undefined;

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SAAS_SESSION_MAX_AGE_SECONDS * 1000);
  await db.query(
    'INSERT INTO saas_sessions (token_hash, user_id, org_id, expires_at) VALUES ($1, $2, $3, $4)',
    [hashSessionToken(token), row.user_id, row.org_id, expiresAt],
  );
  return { token, principal: principalFromRow(row) };
}

interface SessionRow {
  user_id: string;
  email: string;
  org_id: string;
  org_name: string;
  role: SaasRole;
  balance_milli_yuan: string | number;
}

export async function principalForToken(
  db: SaasDb,
  token: string,
): Promise<SaasPrincipal | undefined> {
  if (!token) return undefined;
  const found = await db.query<SessionRow>(
    `SELECT u.id AS user_id, u.email, o.id AS org_id, o.name AS org_name, m.role, w.balance_milli_yuan
     FROM saas_sessions s
     JOIN saas_users u ON u.id = s.user_id
     JOIN saas_orgs o ON o.id = s.org_id
     JOIN saas_memberships m ON m.org_id = s.org_id AND m.user_id = s.user_id
     JOIN saas_wallets w ON w.org_id = o.id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  const row = found.rows[0];
  return row ? principalFromRow(row) : undefined;
}

export async function deleteSession(db: SaasDb, token: string): Promise<void> {
  if (!token) return;
  await db.query('DELETE FROM saas_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
}

function principalFromRow(row: {
  user_id: string;
  email: string;
  org_id: string;
  org_name: string;
  role: SaasRole;
  balance_milli_yuan: string | number;
}): SaasPrincipal {
  const balance = Number(row.balance_milli_yuan);
  return {
    userId: row.user_id,
    email: row.email,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
    balanceMilliYuan: Number.isSafeInteger(balance) ? balance : 0,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}
