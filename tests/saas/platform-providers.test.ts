import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/provider-config', () => ({
  resolveServerImageProviderId: () => 'minimax-image',
  resolveServerVideoProviderId: () => undefined,
  resolveServerASRProviderId: () => 'whisper',
  getServerPDFProviders: () => ({ mineru: {} }),
  enabledServerTTSProviderIds: () => ['minimax'],
}));

import {
  asrProviderForRequest,
  documentExtractConfigForRequest,
  imageProviderForRequest,
  pdfProviderForRequest,
  ttsProviderForRequest,
  videoProviderForRequest,
} from '@/lib/saas/platform-providers';

describe('SaaS platform providers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a customer provider while SaaS mode is off', () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', '');
    expect(imageProviderForRequest('openai-image')).toBe('openai-image');
    expect(videoProviderForRequest('kling')).toBe('kling');
    expect(ttsProviderForRequest('openai-tts')).toBe('openai-tts');
    expect(asrProviderForRequest('custom-asr')).toBe('custom-asr');
    expect(pdfProviderForRequest('mineru-cloud')).toBe('mineru-cloud');
  });

  it('uses the platform provider while SaaS mode is on', () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    expect(imageProviderForRequest('openai-image')).toBe('minimax-image');
    expect(videoProviderForRequest('kling')).toBeUndefined();
    expect(ttsProviderForRequest('browser-native-tts')).toBe('minimax');
    expect(asrProviderForRequest('custom-asr')).toBe('whisper');
    expect(pdfProviderForRequest('mineru-cloud')).toBe('mineru');
    expect(
      documentExtractConfigForRequest({
        providerId: 'mineru-cloud',
        apiKey: 'customer-key',
        baseUrl: 'https://example.invalid',
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
      }),
    ).toEqual({
      providerId: 'mineru',
      apiKey: undefined,
      baseUrl: undefined,
      accessKeyId: undefined,
      accessKeySecret: undefined,
    });
  });
});
