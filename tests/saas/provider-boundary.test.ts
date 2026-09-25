import { NextRequest, type NextRequest as NextRequestType } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SaaS provider boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('drops a customer model and API key while SaaS mode is on', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    vi.stubEnv('DEFAULT_MODEL', '');
    vi.stubEnv('MODEL_ROUTES', '');
    const { resolveModelFromHeaders } = await import('@/lib/server/resolve-model');
    const request = {
      headers: new Headers({
        'x-model': 'openai:gpt-4o',
        'x-api-key': 'sk-customer',
        'x-base-url': 'https://example.invalid',
      }),
    } as NextRequestType;
    await expect(resolveModelFromHeaders(request)).rejects.toThrow(/DEFAULT_MODEL/);
  });

  it('hides provider secrets from the browser while SaaS mode is on', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    vi.doMock('@/lib/server/provider-config', () => ({
      getServerProviders: () => ({
        deepseek: { apiKey: 'sk-platform', baseUrl: 'https://api.deepseek.com' },
      }),
      getServerTTSProviders: () => ({ minimax: { apiKey: 'mm-secret' } }),
      getServerASRProviders: () => ({}),
      getServerPDFProviders: () => ({}),
      getServerImageProviders: () => ({}),
      getServerVideoProviders: () => ({}),
      getServerWebSearchProviders: () => ({}),
      getParallelSceneConcurrency: () => 1,
    }));
    const { GET } = await import('@/app/api/server-providers/route');
    const body = await (await GET()).json();
    expect(body.providers.deepseek.apiKey).toBe('');
    expect(body.providers.deepseek.baseUrl).toBe('https://api.deepseek.com');
    expect(body.tts.minimax.apiKey).toBe('');
  });

  it('refuses customer model verification while SaaS mode is on', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({ model: 'openai:gpt-4o', apiKey: 'sk-customer' }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
