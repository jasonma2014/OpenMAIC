import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, 'false', '0', 'true'])(
  'always delivers school login even with the former flag set to %s',
  async (value) => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', value);
    const { isSaasEnabled } = await vi.importActual<typeof import('@/lib/config/feature-flags')>(
      '@/lib/config/feature-flags',
    );
    expect(isSaasEnabled()).toBe(true);
  },
);
