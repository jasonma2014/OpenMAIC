/**
 * Provider cost for the SaaS stack we settled on.
 *
 * Amounts are integer milli-yuan (1 yuan = 1000). DeepSeek rates are the
 * official V4.1 Flash list (model id `deepseek-flash`, and the legacy id
 * `deepseek-v4-flash-vision-exp` that this app uses so vision stays on).
 * MiniMax rates are pay-as-you-go, not Token Plan.
 *
 * Peak window matches DeepSeek's published rule: Beijing time, Monday–Friday
 * 09:00–12:00 and 14:00–18:00. Statutory holidays are not special-cased yet.
 */

export type MilliYuan = number;

const PER_MILLION = 1_000_000;

export interface DeepSeekTokenUsage {
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
}

export interface DeepSeekRates {
  cacheHit: MilliYuan;
  cacheMiss: MilliYuan;
  output: MilliYuan;
}

/** Per 1,000,000 tokens. */
export const DEEPSEEK_V41_FLASH = {
  offPeak: { cacheHit: 20, cacheMiss: 1_000, output: 4_000 },
  peak: { cacheHit: 40, cacheMiss: 2_000, output: 8_000 },
} as const satisfies { offPeak: DeepSeekRates; peak: DeepSeekRates };

/** image-01, per image. */
export const MINIMAX_IMAGE_MILLI_YUAN = 25;

/** speech-2.8-turbo, per 10,000 billing characters. One Han character counts as two. */
export const MINIMAX_TTS_TURBO_PER_10K_CHARS = 2_000;

/** Hailuo 2.3, 768P, 6 seconds. Video stays off unless a job explicitly asks. */
export const MINIMAX_HAILUO_768P_6S = 2_000;

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

export function isDeepSeekPeak(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (!weekday || !WEEKDAYS.has(weekday) || !Number.isInteger(hour)) return false;
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

function tokensCost(tokens: number, perMillion: MilliYuan): MilliYuan {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.ceil((tokens * perMillion) / PER_MILLION);
}

export function quoteDeepSeek(usage: DeepSeekTokenUsage, at: Date): MilliYuan {
  const rates = isDeepSeekPeak(at) ? DEEPSEEK_V41_FLASH.peak : DEEPSEEK_V41_FLASH.offPeak;
  return (
    tokensCost(usage.cacheHitTokens, rates.cacheHit) +
    tokensCost(usage.cacheMissTokens, rates.cacheMiss) +
    tokensCost(usage.outputTokens, rates.output)
  );
}

export function quoteMinimaxImage(count: number): MilliYuan {
  if (!Number.isInteger(count) || count <= 0) return 0;
  return count * MINIMAX_IMAGE_MILLI_YUAN;
}

/** MiniMax bills Han characters as two characters; everything else as one. */
export function minimaxBillingChars(text: string): number {
  let count = 0;
  for (const char of text) {
    count += /[\u3400-\u9fff]/.test(char) ? 2 : 1;
  }
  return count;
}

export function quoteMinimaxTts(text: string): MilliYuan {
  const chars = minimaxBillingChars(text);
  if (chars <= 0) return 0;
  return Math.ceil((chars * MINIMAX_TTS_TURBO_PER_10K_CHARS) / 10_000);
}

export function quoteMinimaxVideoClips(clips: number): MilliYuan {
  if (!Number.isInteger(clips) || clips <= 0) return 0;
  return clips * MINIMAX_HAILUO_768P_6S;
}

/** Retail price from provider cost. `markupBps` of 10000 means no markup. */
export function retailFromCost(cost: MilliYuan, markupBps: number): MilliYuan {
  if (cost <= 0) return 0;
  if (!Number.isInteger(markupBps) || markupBps < 10000) {
    throw new Error('SaaS markup must be an integer basis-point value of at least 10000');
  }
  return Math.ceil((cost * markupBps) / 10_000);
}
