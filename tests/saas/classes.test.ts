import { describe, expect, it } from 'vitest';

import { hashPassword } from '@/lib/saas/password';
import { ensureClassCode, joinClass, newClassCode } from '@/lib/saas/classes';
import type { SaasDb, SaasQueryResult } from '@/lib/saas/accounts';

describe('class codes', () => {
  it('reuses one code per course and lets a new student join', async () => {
    const db = classDb();
    const first = await ensureClassCode(db, 'org-1', 'stage-1');
    const second = await ensureClassCode(db, 'org-1', 'stage-1');
    expect(second).toBe(first);
    expect(newClassCode()).toMatch(/^[A-Z2-9]{8}$/);

    const joined = await joinClass(db, {
      code: first.toLowerCase(),
      email: 'student@school.test',
      password: 'classroom-pass',
    });
    expect(joined?.principal.role).toBe('student');
    expect(joined?.principal.orgId).toBe('org-1');
    expect(joined?.stageId).toBe('stage-1');
    expect(joined?.principal.balanceMilliYuan).toBe(4_000);

    const again = await joinClass(db, {
      code: 'NO-SUCH',
      email: 'student@school.test',
      password: 'classroom-pass',
    });
    expect(again).toBeUndefined();
  });

  it('keeps an organization admin when they open their own class code', async () => {
    const db = classDb();
    const code = await ensureClassCode(db, 'org-1', 'stage-1');
    const passwordHash = await hashPassword('classroom-pass');
    db.users.push({ id: 'admin-1', email: 'admin@school.test', password_hash: passwordHash });
    db.memberships.push({ org_id: 'org-1', user_id: 'admin-1', role: 'org_admin' });
    const joined = await joinClass(db, {
      code,
      email: 'admin@school.test',
      password: 'classroom-pass',
    });
    expect(joined?.principal.role).toBe('org_admin');
  });
});

function classDb(): SaasDb & {
  users: Array<{ id: string; email: string; password_hash: string }>;
  memberships: Array<{ org_id: string; user_id: string; role: string }>;
} {
  const classes: Array<{ code: string; org_id: string; stage_id: string }> = [];
  const users: Array<{ id: string; email: string; password_hash: string }> = [];
  const memberships: Array<{ org_id: string; user_id: string; role: string }> = [];
  const sessions: unknown[] = [];

  const database: SaasDb = {
    query: async <T>(sql: string, params: readonly unknown[] = []) =>
      run(sql, params) as SaasQueryResult<T>,
    transaction: (fn) => fn(database),
  };

  function run(sql: string, params: readonly unknown[]): SaasQueryResult<Record<string, unknown>> {
    if (sql.startsWith('SELECT code FROM saas_classes')) {
      const row = classes.find((item) => item.org_id === params[0] && item.stage_id === params[1]);
      return { rows: row ? [{ code: row.code }] : [] };
    }
    if (sql.startsWith('INSERT INTO saas_classes')) {
      classes.push({
        code: String(params[0]),
        org_id: String(params[1]),
        stage_id: String(params[2]),
      });
      return { rows: [] };
    }
    if (sql.includes('FROM saas_classes')) {
      const row = classes.find((item) => item.code === params[0]);
      return {
        rows: row ? [{ org_id: row.org_id, org_name: '第一中学', stage_id: row.stage_id }] : [],
      };
    }
    if (sql.startsWith('SELECT id, password_hash FROM saas_users')) {
      const user = users.find((item) => item.email === params[0]);
      return { rows: user ? [{ id: user.id, password_hash: user.password_hash }] : [] };
    }
    if (sql.startsWith('INSERT INTO saas_users')) {
      users.push({
        id: String(params[0]),
        email: String(params[1]),
        password_hash: String(params[2]),
      });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO saas_memberships')) {
      const exists = memberships.some(
        (item) => item.org_id === params[0] && item.user_id === params[1],
      );
      if (!exists) {
        memberships.push({
          org_id: String(params[0]),
          user_id: String(params[1]),
          role: 'student',
        });
      }
      return { rows: [] };
    }
    if (sql.startsWith('SELECT role FROM saas_memberships')) {
      const row = memberships.find(
        (item) => item.org_id === params[0] && item.user_id === params[1],
      );
      return { rows: row ? [{ role: row.role }] : [] };
    }
    if (sql.startsWith('SELECT balance_milli_yuan')) {
      return { rows: [{ balance_milli_yuan: 4_000 }] };
    }
    if (sql.startsWith('INSERT INTO saas_sessions')) {
      sessions.push(params[0]);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  return Object.assign(database, { users, memberships });
}
