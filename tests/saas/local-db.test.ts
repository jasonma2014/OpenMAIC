import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { registerOrgAdmin } from '@/lib/saas/accounts';
import { debitOrgWallet } from '@/lib/saas/billing';
import { ensureClassCode, joinClass } from '@/lib/saas/classes';
import { saasDbFromPool } from '@/lib/saas/db';
import { ensureSaasSchema } from '@/lib/saas/accounts';

const connectionString = 'postgresql://majian@127.0.0.1:5432/openmaic';

describe('local PostgreSQL SaaS schema', () => {
  const pool = new Pool({ connectionString });
  const email = `saas-${Date.now()}@school.test`;

  afterAll(async () => {
    await pool.end();
  });

  it('registers an organization, debits its wallet, and joins a student by class code', async () => {
    const db = saasDbFromPool(pool);
    await ensureSaasSchema(db);
    const created = await registerOrgAdmin(
      db,
      { email, password: 'classroom-pass', orgName: '本地演示学校' },
      5_000,
    );
    const debited = await debitOrgWallet(db, created.principal.orgId, {
      kind: 'llm',
      cost: 1_000,
      retail: 2_000,
    });
    expect(debited).toBe('debited');
    const code = await ensureClassCode(db, created.principal.orgId, 'stage-local-1');
    const student = await joinClass(db, {
      code,
      email: `student-${email}`,
      password: 'classroom-pass',
    });
    expect(student?.principal.role).toBe('student');
    expect(student?.principal.orgId).toBe(created.principal.orgId);
    expect(student?.stageId).toBe('stage-local-1');
    const balance = await pool.query<{ balance_milli_yuan: string }>(
      'SELECT balance_milli_yuan FROM saas_wallets WHERE org_id = $1',
      [created.principal.orgId],
    );
    expect(Number(balance.rows[0]?.balance_milli_yuan)).toBe(3_000);
    await pool.query('DELETE FROM saas_ledger WHERE org_id = $1', [created.principal.orgId]);
    await pool.query('DELETE FROM saas_classes WHERE org_id = $1', [created.principal.orgId]);
    await pool.query('DELETE FROM saas_sessions WHERE org_id = $1', [created.principal.orgId]);
    await pool.query('DELETE FROM saas_memberships WHERE org_id = $1', [created.principal.orgId]);
    await pool.query('DELETE FROM saas_wallets WHERE org_id = $1', [created.principal.orgId]);
    await pool.query('DELETE FROM saas_users WHERE email = $1 OR email = $2', [
      email,
      `student-${email}`,
    ]);
    await pool.query('DELETE FROM saas_orgs WHERE id = $1', [created.principal.orgId]);
  });
});
