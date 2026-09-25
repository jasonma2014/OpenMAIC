import { randomUUID } from 'node:crypto';

import type { SaasDb } from '@/lib/saas/accounts';
import { currentSaasOrgId } from '@/lib/saas/context';
import {
  quoteDeepSeek,
  quoteMinimaxImage,
  quoteMinimaxVideoClips,
  retailFromCost,
  type MilliYuan,
} from '@/lib/saas/pricing';
import type { UsageRecord } from '@/lib/server/usage-storage';

const TTS_PER_CHAR = 2_000 / 10_000;

export function markupBps(envValue: string | undefined): number {
  if (envValue && /^[0-9]+$/.test(envValue.trim())) {
    const parsed = Number(envValue.trim());
    if (parsed >= 10_000 && Number.isSafeInteger(parsed)) return parsed;
  }
  return 20_000;
}

/** Provider cost in milli-yuan for one recorded usage row. */
export function quoteUsageCost(record: UsageRecord, at: Date): MilliYuan {
  if (record.kind === 'llm') {
    const cacheHit = Math.max(0, record.cacheReadTokens);
    const cacheMiss = Math.max(0, record.inputTokens - cacheHit);
    return quoteDeepSeek(
      {
        cacheHitTokens: cacheHit,
        cacheMissTokens: cacheMiss,
        outputTokens: Math.max(0, record.outputTokens),
      },
      at,
    );
  }
  if (record.kind === 'image') return quoteMinimaxImage(record.quantity ?? 0);
  if (record.kind === 'tts') {
    const chars = record.quantity ?? 0;
    if (!Number.isFinite(chars) || chars <= 0) return 0;
    return Math.ceil(chars * TTS_PER_CHAR);
  }
  if (record.kind === 'video') {
    const seconds = record.quantity ?? 0;
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return quoteMinimaxVideoClips(Math.ceil(seconds / 6));
  }
  return 0;
}

export type DebitResult = 'free' | 'debited' | 'insufficient';

export async function debitOrgWallet(
  db: SaasDb,
  orgId: string,
  input: { kind: string; cost: MilliYuan; retail: MilliYuan },
): Promise<DebitResult> {
  if (input.retail <= 0) return 'free';
  return db.transaction(async (tx) => {
    const updated = await tx.query<{ balance_milli_yuan: string | number }>(
      `UPDATE saas_wallets
          SET balance_milli_yuan = balance_milli_yuan - $2
        WHERE org_id = $1 AND balance_milli_yuan >= $2
        RETURNING balance_milli_yuan`,
      [orgId, input.retail],
    );
    if (!updated.rows[0]) return 'insufficient';
    await tx.query(
      `INSERT INTO saas_ledger (id, org_id, kind, cost_milli_yuan, retail_milli_yuan)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), orgId, input.kind, input.cost, input.retail],
    );
    return 'debited';
  });
}

/**
 * Charge the organization bound to this request. A logging failure must not
 * fail generation, and neither should a billing hiccup: the caller already
 * refused an empty wallet before the job started.
 */
export async function billRecordedUsage(record: UsageRecord, at: Date): Promise<void> {
  const orgId = currentSaasOrgId();
  if (!orgId) return;
  const { openSaasDb } = await import('@/lib/saas/db');
  const cost = quoteUsageCost(record, at);
  const retail = retailFromCost(cost, markupBps(process.env.OPENMAIC_SAAS_MARKUP_BPS));
  await debitOrgWallet(await openSaasDb(), orgId, { kind: record.kind, cost, retail });
}
