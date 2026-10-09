import { randomUUID } from 'node:crypto';
import { SaasConflictError, SaasInputError, type SaasDb } from './accounts';
import { alipayConfig } from './alipay-config';
import { SchoolError } from './school';

export function trialTopupEnabled(): boolean {
  return process.env.OPENMAIC_TRIAL_TOPUP_ENABLED === 'true';
}

export async function requireWalletAdmin(db: SaasDb, orgId: string, userId: string) {
  const membership = await db.query<{ role: string }>(
    'SELECT role FROM saas_memberships WHERE org_id = $1 AND user_id = $2',
    [orgId, userId],
  );
  if (membership.rows[0]?.role !== 'org_admin') throw new SchoolError('forbidden');
}

export async function readWallet(db: SaasDb, orgId: string, userId: string) {
  await requireWalletAdmin(db, orgId, userId);
  const wallet = await db.query<{ balance: string }>(
    'SELECT balance_milli_yuan AS balance FROM saas_wallets WHERE org_id = $1',
    [orgId],
  );
  const ledger = await db.query<{ id: string; kind: string; amount: string; created_at: Date }>(
    `SELECT id, kind, retail_milli_yuan AS amount, created_at FROM saas_ledger WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
    [orgId],
  );
  const payments = await db.query<{
    id: string;
    request_id: string;
    amount_milli_yuan: string;
    status: 'pending' | 'paid';
    sandbox: boolean;
    created_at: Date;
  }>(
    'SELECT id,request_id,amount_milli_yuan,status,sandbox,created_at FROM saas_payment_orders WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20',
    [orgId],
  );
  const paymentConfig = alipayConfig();
  return {
    alipayEnabled: !!paymentConfig,
    alipaySandbox: paymentConfig?.sandbox ?? false,
    paymentOrders: payments.rows.map((row) => ({
      orderId: row.id,
      requestId: row.request_id,
      amountMilliYuan: Number(row.amount_milli_yuan),
      status: row.status,
      sandbox: row.sandbox,
      createdAt: new Date(row.created_at).getTime(),
    })),
    balanceMilliYuan: Number(wallet.rows[0]?.balance ?? 0),
    trialTopupEnabled: trialTopupEnabled(),
    entries: ledger.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amountMilliYuan: Number(row.amount),
      createdAt: new Date(row.created_at).getTime(),
    })),
  };
}

/** Trial credit is explicit and opt-in; it never represents a verified payment. */
export async function rechargeTrialWallet(
  db: SaasDb,
  input: { orgId: string; userId: string; amountMilliYuan: unknown; requestId: unknown },
) {
  return db.transaction(async (tx) => {
    await requireWalletAdmin(tx, input.orgId, input.userId);
    if (!trialTopupEnabled()) throw new SchoolError('forbidden');
    const amount = input.amountMilliYuan;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 1_000_000
    )
      throw new SaasInputError('每次测试充值须大于 0，最多 1000 元');
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId))
      throw new SaasInputError('缺少有效充值请求编号');
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO saas_wallet_topups (id, org_id, user_id, request_id, amount_milli_yuan)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (org_id, request_id) DO NOTHING RETURNING id`,
      [randomUUID(), input.orgId, input.userId, input.requestId, amount],
    );
    if (inserted.rows[0]) {
      await tx.query(
        'UPDATE saas_wallets SET balance_milli_yuan = balance_milli_yuan + $2 WHERE org_id = $1',
        [input.orgId, amount],
      );
      await tx.query(
        `INSERT INTO saas_ledger (id, org_id, kind, cost_milli_yuan, retail_milli_yuan) VALUES ($1, $2, 'trial_topup', 0, $3)`,
        [inserted.rows[0].id, input.orgId, amount],
      );
    } else {
      const prior = await tx.query<{ amount: string }>(
        'SELECT amount_milli_yuan AS amount FROM saas_wallet_topups WHERE org_id = $1 AND request_id = $2',
        [input.orgId, input.requestId],
      );
      if (Number(prior.rows[0]?.amount) !== amount)
        throw new SaasConflictError('同一充值请求不能更改金额');
    }
    return readWallet(tx, input.orgId, input.userId);
  });
}
