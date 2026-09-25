import { describe, expect, it } from 'vitest';

import { debitOrgWallet, quoteUsageCost } from '@/lib/saas/billing';
import { currentSaasOrgId, runWithSaasOrg } from '@/lib/saas/context';
import { quoteLessonCost, quoteLessonRetail } from '@/lib/saas/quote';
import type { SaasDb, SaasQueryResult } from '@/lib/saas/accounts';
import type { UsageRecord } from '@/lib/server/usage-storage';

describe('SaaS usage quotes', () => {
  it('prices a DeepSeek cache miss and a MiniMax image from the usage row', () => {
    const at = new Date('2026-09-23T12:30:00.000Z');
    const llm: UsageRecord = {
      id: '1',
      createdAt: at.getTime(),
      kind: 'llm',
      source: 'scene-content',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash-vision-exp',
      modelString: 'deepseek:deepseek-v4-flash-vision-exp',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
    };
    expect(quoteUsageCost(llm, at)).toBe(1_000);
    expect(quoteUsageCost({ ...llm, kind: 'image', quantity: 2, inputTokens: 0 }, at)).toBe(50);
  });

  it('quotes one lesson before generation and bills the job after the response', () => {
    const offPeak = new Date('2026-09-23T12:30:00.000Z');
    const peak = new Date('2026-09-23T02:00:00.000Z');
    expect(quoteLessonCost(offPeak)).toBe(6_984);
    expect(quoteLessonRetail(offPeak, 20_000)).toBe(13_968);
    expect(quoteLessonCost(peak)).toBeGreaterThan(quoteLessonCost(offPeak));
  });
});

describe('SaaS organization binding', () => {
  it('keeps the organization on work that starts after the request returns', async () => {
    let seen: string | undefined;
    await Promise.resolve().then(() =>
      runWithSaasOrg('org-1', async () => {
        await Promise.resolve();
        seen = currentSaasOrgId();
      }),
    );
    expect(seen).toBe('org-1');
    expect(currentSaasOrgId()).toBeUndefined();
  });
});

describe('SaaS wallet debit', () => {
  it('debits the organization and refuses to go below zero', async () => {
    const { db, state } = walletDb(100);
    expect(await debitOrgWallet(db, 'org-1', { kind: 'llm', cost: 40, retail: 80 })).toBe(
      'debited',
    );
    expect(state.balance).toBe(20);
    expect(state.ledger).toBe(1);
    expect(await debitOrgWallet(db, 'org-1', { kind: 'llm', cost: 40, retail: 80 })).toBe(
      'insufficient',
    );
    expect(state.balance).toBe(20);
    expect(await debitOrgWallet(db, 'org-1', { kind: 'llm', cost: 0, retail: 0 })).toBe('free');
  });
});

function walletDb(start: number): { db: SaasDb; state: { balance: number; ledger: number } } {
  const state = { balance: start, ledger: 0 };
  const database: SaasDb = {
    query: (sql, params = []) => {
      if (sql.includes('UPDATE saas_wallets')) {
        const retail = Number(params[1]);
        if (state.balance < retail) return Promise.resolve({ rows: [] });
        state.balance -= retail;
        return Promise.resolve({ rows: [{ balance_milli_yuan: state.balance }] });
      }
      if (sql.startsWith('INSERT INTO saas_ledger')) {
        state.ledger += 1;
        return Promise.resolve({ rows: [] } satisfies SaasQueryResult<Record<string, unknown>>);
      }
      throw new Error(sql);
    },
    transaction: (fn) => fn(database),
  };
  return { db: database, state };
}
