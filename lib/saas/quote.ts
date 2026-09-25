import {
  quoteDeepSeek,
  quoteMinimaxImage,
  retailFromCost,
  MINIMAX_TTS_TURBO_PER_10K_CHARS,
  type MilliYuan,
} from '@/lib/saas/pricing';

/**
 * Planning budget for one lesson before generation starts.
 *
 * Eight scenes, each with about 20k uncached input tokens and 7k output
 * tokens, eight images, and about 2,000 Han characters of narration per
 * scene. Video stays out of this quote because it is off unless a job asks.
 * The wallet is checked against this amount up front. The bill afterwards
 * is the measured usage, not this budget.
 */
export const LESSON_QUOTE_BUDGET = {
  scenes: 8,
  cacheMissTokensPerScene: 20_000,
  outputTokensPerScene: 7_000,
  images: 8,
  narrationHanPerScene: 2_000,
} as const;

export function quoteLessonCost(at: Date): MilliYuan {
  const { scenes, cacheMissTokensPerScene, outputTokensPerScene, images, narrationHanPerScene } =
    LESSON_QUOTE_BUDGET;
  const llm = quoteDeepSeek(
    {
      cacheHitTokens: 0,
      cacheMissTokens: scenes * cacheMissTokensPerScene,
      outputTokens: scenes * outputTokensPerScene,
    },
    at,
  );
  const narrationBillingChars = scenes * narrationHanPerScene * 2;
  const narration = Math.ceil((narrationBillingChars * MINIMAX_TTS_TURBO_PER_10K_CHARS) / 10_000);
  return llm + quoteMinimaxImage(images) + narration;
}

export function quoteLessonRetail(at: Date, markupBasisPoints: number): MilliYuan {
  return retailFromCost(quoteLessonCost(at), markupBasisPoints);
}
