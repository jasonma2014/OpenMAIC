import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SaaS persistence session', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgres://unused');
    vi.stubEnv('PERSISTENCE_DEV_TOKEN', '');
  });

  it('requires a session instead of the development token when SaaS mode is on', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    vi.doMock('@/lib/saas/principal', () => ({
      saasPrincipalFromHeaders: vi.fn(async () => undefined),
    }));
    const { GET } = await import('@/app/api/persistence/[...path]/route');
    const response = await GET(new Request('http://localhost/api/persistence/documents/lesson'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required' },
    });
  });

  it('still requires the development token when SaaS mode is off', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', '');
    const { GET } = await import('@/app/api/persistence/[...path]/route');
    const response = await GET(new Request('http://localhost/api/persistence/documents/lesson'));
    expect(response.status).toBe(503);
  });
});
