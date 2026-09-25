import { randomBytes, randomUUID } from 'node:crypto';

import {
  assertPassword,
  hashSessionToken,
  newSessionToken,
  normalizeEmail,
  type SaasDb,
  type SaasPrincipal,
} from '@/lib/saas/accounts';
import { SAAS_SESSION_MAX_AGE_SECONDS } from '@/lib/saas/cookie';
import { hashPassword, verifyPassword } from '@/lib/saas/password';
import type { SaasRole } from '@/lib/saas/roles';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newClassCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[bytes[index]! % CODE_ALPHABET.length];
  }
  return code;
}

export async function ensureClassCode(db: SaasDb, orgId: string, stageId: string): Promise<string> {
  const existing = await db.query<{ code: string }>(
    'SELECT code FROM saas_classes WHERE org_id = $1 AND stage_id = $2',
    [orgId, stageId],
  );
  const found = existing.rows[0]?.code;
  if (found) return found;
  const code = newClassCode();
  await db.query('INSERT INTO saas_classes (code, org_id, stage_id) VALUES ($1, $2, $3)', [
    code,
    orgId,
    stageId,
  ]);
  return code;
}

interface ClassRow {
  org_id: string;
  org_name: string;
  stage_id: string;
}

/**
 * A student joins a published class. An existing school admin keeps that role.
 * A new email becomes a student of the class organization and does not get a wallet.
 */
export async function joinClass(
  db: SaasDb,
  input: { code: unknown; email: unknown; password: unknown },
): Promise<{ token: string; principal: SaasPrincipal; stageId: string } | undefined> {
  if (typeof input.code !== 'string' || !/^[A-Z2-9]{8}$/.test(input.code.trim().toUpperCase())) {
    return undefined;
  }
  const code = input.code.trim().toUpperCase();
  const email = normalizeEmail(input.email);
  const password = assertPassword(input.password);
  const classes = await db.query<ClassRow>(
    `SELECT c.org_id, o.name AS org_name, c.stage_id
       FROM saas_classes c
       JOIN saas_orgs o ON o.id = c.org_id
      WHERE c.code = $1`,
    [code],
  );
  const classroom = classes.rows[0];
  if (!classroom) return undefined;

  const users = await db.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM saas_users WHERE email = $1',
    [email],
  );
  let userId = users.rows[0]?.id;
  if (userId) {
    if (!(await verifyPassword(password, users.rows[0]!.password_hash))) return undefined;
  } else {
    userId = randomUUID();
    await db.query('INSERT INTO saas_users (id, email, password_hash) VALUES ($1, $2, $3)', [
      userId,
      email,
      await hashPassword(password),
    ]);
  }

  await db.query(
    `INSERT INTO saas_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [classroom.org_id, userId],
  );
  const membership = await db.query<{ role: SaasRole }>(
    'SELECT role FROM saas_memberships WHERE org_id = $1 AND user_id = $2',
    [classroom.org_id, userId],
  );
  const role = membership.rows[0]?.role ?? 'student';
  const wallet = await db.query<{ balance_milli_yuan: string | number }>(
    'SELECT balance_milli_yuan FROM saas_wallets WHERE org_id = $1',
    [classroom.org_id],
  );
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SAAS_SESSION_MAX_AGE_SECONDS * 1000);
  await db.query(
    'INSERT INTO saas_sessions (token_hash, user_id, org_id, expires_at) VALUES ($1, $2, $3, $4)',
    [hashSessionToken(token), userId, classroom.org_id, expiresAt],
  );
  const balance = Number(wallet.rows[0]?.balance_milli_yuan ?? 0);
  return {
    token,
    stageId: classroom.stage_id,
    principal: {
      userId,
      email,
      orgId: classroom.org_id,
      orgName: classroom.org_name,
      role,
      balanceMilliYuan: Number.isSafeInteger(balance) ? balance : 0,
    },
  };
}
