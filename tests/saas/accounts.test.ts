import { describe, expect, it, vi } from 'vitest';

import {
  SaasConflictError,
  SaasInputError,
  assertOrgName,
  assertPassword,
  deleteSession,
  hashSessionToken,
  loginWithPassword,
  normalizeEmail,
  principalForToken,
  registerOrgAdmin,
  signupCreditMilliYuan,
  type SaasDb,
  type SaasQueryResult,
} from '@/lib/saas/accounts';
import { hashPassword, verifyPassword } from '@/lib/saas/password';
import { GET as sessionGet } from '@/app/api/saas/session/route';
import { POST as registerPost } from '@/app/api/saas/register/route';

describe('SaaS passwords', () => {
  it('round-trips a password and rejects a different one', async () => {
    const stored = await hashPassword('classroom-pass');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('classroom-pass');
    expect(await verifyPassword('classroom-pass', stored)).toBe(true);
    expect(await verifyPassword('other-pass', stored)).toBe(false);
    expect(await verifyPassword('classroom-pass', 'not-a-hash')).toBe(false);
  });
});

describe('SaaS account input', () => {
  it('normalizes email and rejects a short password', () => {
    expect(normalizeEmail(' Teacher@School.com ')).toBe('teacher@school.com');
    expect(() => assertPassword('short')).toThrow(SaasInputError);
    expect(() => assertOrgName('   ')).toThrow(SaasInputError);
    expect(assertOrgName(' 第一中学 ')).toBe('第一中学');
  });

  it('treats a missing signup credit as zero', () => {
    expect(signupCreditMilliYuan(undefined)).toBe(0);
    expect(signupCreditMilliYuan(' 5000 ')).toBe(5000);
    expect(signupCreditMilliYuan('-1')).toBe(0);
  });
});

describe('SaaS registration', () => {
  it('opens an organization with an admin session and refuses the same email', async () => {
    const db = memoryDb();
    const created = await registerOrgAdmin(
      db,
      { email: 'admin@school.com', password: 'classroom-pass', orgName: '第一中学' },
      10_000,
    );
    expect(created.principal.role).toBe('org_admin');
    expect(created.principal.balanceMilliYuan).toBe(10_000);
    expect(created.token).not.toBe(hashSessionToken(created.token));

    const signedIn = await principalForToken(db, created.token);
    expect(signedIn?.orgName).toBe('第一中学');

    await expect(
      registerOrgAdmin(
        db,
        { email: 'admin@school.com', password: 'classroom-pass', orgName: '另一所' },
        0,
      ),
    ).rejects.toBeInstanceOf(SaasConflictError);

    const again = await loginWithPassword(db, {
      email: 'admin@school.com',
      password: 'classroom-pass',
    });
    expect(again?.principal.orgId).toBe(created.principal.orgId);
    expect(await loginWithPassword(db, { email: 'admin@school.com', password: 'wrong-pass' })).toBe(
      undefined,
    );

    await deleteSession(db, created.token);
    expect(await principalForToken(db, created.token)).toBeUndefined();
  });
});

describe('SaaS HTTP routes', () => {
  it('hides registration and session while SaaS mode is off', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', '');
    const register = await registerPost(
      new Request('http://localhost/api/saas/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.co', password: 'classroom-pass', orgName: '学校' }),
      }),
    );
    expect(register.status).toBe(404);
    expect((await sessionGet()).status).toBe(404);
  });
});

interface MemoryRow {
  [key: string]: string | number | Date;
}

function memoryDb(): SaasDb {
  const orgs: MemoryRow[] = [];
  const users: MemoryRow[] = [];
  const memberships: MemoryRow[] = [];
  const wallets: MemoryRow[] = [];
  const sessions: MemoryRow[] = [];
  const ledger: MemoryRow[] = [];

  const database: SaasDb = {
    query: (sql, params = []) => Promise.resolve(run(sql, params)),
    transaction: (fn) => fn(database),
  };

  function run(sql: string, params: readonly unknown[]): SaasQueryResult<MemoryRow> {
    if (sql.startsWith('INSERT INTO saas_orgs')) {
      orgs.push({ id: String(params[0]), name: String(params[1]) });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO saas_users')) {
      const email = String(params[1]);
      if (users.some((user) => user.email === email)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      users.push({
        id: String(params[0]),
        email,
        password_hash: String(params[2]),
      });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO saas_memberships')) {
      memberships.push({
        org_id: String(params[0]),
        user_id: String(params[1]),
        role: 'org_admin',
      });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO saas_wallets')) {
      wallets.push({ org_id: String(params[0]), balance_milli_yuan: Number(params[1]) });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO saas_ledger')) {
      ledger.push({ id: String(params[0]) });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO saas_sessions')) {
      sessions.push({
        token_hash: String(params[0]),
        user_id: String(params[1]),
        org_id: String(params[2]),
        expires_at: params[3] as Date,
      });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT u.id AS user_id, u.email, u.password_hash')) {
      const email = String(params[0]);
      const user = users.find((row) => row.email === email);
      if (!user) return { rows: [] };
      const membership = memberships.find((row) => row.user_id === user.id);
      const org = orgs.find((row) => row.id === membership?.org_id);
      const wallet = wallets.find((row) => row.org_id === org?.id);
      if (!membership || !org || !wallet) return { rows: [] };
      return {
        rows: [
          {
            user_id: user.id,
            email: user.email,
            password_hash: user.password_hash,
            org_id: org.id,
            org_name: org.name,
            role: membership.role,
            balance_milli_yuan: wallet.balance_milli_yuan,
          },
        ],
      };
    }
    if (sql.startsWith('DELETE FROM saas_sessions')) {
      const tokenHash = String(params[0]);
      const index = sessions.findIndex((row) => row.token_hash === tokenHash);
      if (index >= 0) sessions.splice(index, 1);
      return { rows: [] };
    }
    if (sql.includes('FROM saas_sessions')) {
      const tokenHash = String(params[0]);
      const session = sessions.find(
        (row) => row.token_hash === tokenHash && (row.expires_at as Date).getTime() > Date.now(),
      );
      if (!session) return { rows: [] };
      const user = users.find((row) => row.id === session.user_id);
      const org = orgs.find((row) => row.id === session.org_id);
      const membership = memberships.find(
        (row) => row.user_id === session.user_id && row.org_id === session.org_id,
      );
      const wallet = wallets.find((row) => row.org_id === session.org_id);
      if (!user || !org || !membership || !wallet) return { rows: [] };
      return {
        rows: [
          {
            user_id: user.id,
            email: user.email,
            org_id: org.id,
            org_name: org.name,
            role: membership.role,
            balance_milli_yuan: wallet.balance_milli_yuan,
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL in memory SaaS db: ${sql}`);
  }

  return database;
}
