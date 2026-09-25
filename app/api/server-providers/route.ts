import { isSaasEnabled } from '@/lib/config/feature-flags';
import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
  getParallelSceneConcurrency,
} from '@/lib/server/provider-config';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('ServerProviders');

function redactProviderSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactProviderSecrets(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] =
      typeof item === 'string' && /key|secret|token/i.test(key) ? '' : redactProviderSecrets(item);
  }
  return redacted as T;
}

export async function GET() {
  try {
    const body = {
      providers: getServerProviders(),
      tts: getServerTTSProviders(),
      asr: getServerASRProviders(),
      pdf: getServerPDFProviders(),
      image: getServerImageProviders(),
      video: getServerVideoProviders(),
      webSearch: getServerWebSearchProviders(),
      generation: {
        parallelSceneConcurrency: getParallelSceneConcurrency(),
      },
    };
    return apiSuccess(isSaasEnabled() ? redactProviderSecrets(body) : body);
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
