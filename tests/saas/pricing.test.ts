import { describe, expect, it } from 'vitest';
import { canPerform } from '@/lib/saas/roles';
import {
  isDeepSeekPeak,
  minimaxBillingChars,
  quoteDeepSeek,
  quoteMinimaxImage,
  quoteMinimaxTts,
  quoteMinimaxVideoClips,
  retailFromCost,
} from '@/lib/saas/pricing';

describe('SaaS roles', () => {
  it('lets students attend and keeps provider settings off every role', () => {
    expect(canPerform('student', 'play')).toBe(true);
    expect(canPerform('student', 'generate')).toBe(false);
    expect(canPerform('teacher', 'configure_providers')).toBe(false);
    expect(canPerform('org_admin', 'configure_providers')).toBe(false);
    expect(canPerform('teacher', 'publish')).toBe(true);
    expect(canPerform('org_admin', 'manage_billing')).toBe(true);
  });
});

describe('SaaS provider quotes', () => {
  it('bills DeepSeek weekday class time at the peak rate', () => {
    const at = new Date('2026-09-23T02:30:00.000Z');
    expect(isDeepSeekPeak(at)).toBe(true);
    expect(
      quoteDeepSeek({ cacheHitTokens: 1_000_000, cacheMissTokens: 1_000_000, outputTokens: 1_000_000 }, at),
    ).toBe(40 + 2_000 + 8_000);
  });

  it('bills DeepSeek evening generation at the off-peak rate', () => {
    const at = new Date('2026-09-23T12:30:00.000Z');
    expect(isDeepSeekPeak(at)).toBe(false);
    expect(quoteDeepSeek({ cacheHitTokens: 0, cacheMissTokens: 500_000, outputTokens: 100_000 }, at)).toBe(
      500 + 400,
    );
  });

  it('prices MiniMax images, narration, and an optional video clip', () => {
    expect(quoteMinimaxImage(4)).toBe(100);
    expect(minimaxBillingChars('你好a')).toBe(5);
    expect(quoteMinimaxTts('你'.repeat(5000))).toBe(2_000);
    expect(quoteMinimaxVideoClips(0)).toBe(0);
    expect(quoteMinimaxVideoClips(1)).toBe(2_000);
  });

  it('marks retail up from provider cost', () => {
    expect(retailFromCost(25, 20_000)).toBe(50);
  });
});
