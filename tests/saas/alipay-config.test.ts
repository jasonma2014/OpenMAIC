import { afterEach, expect, it, vi } from 'vitest';
import { alipayConfig } from '@/lib/saas/alipay-config';
afterEach(() => vi.unstubAllEnvs());
it('keeps payments disabled until explicitly enabled with complete HTTPS merchant configuration', () => {
  vi.stubEnv('ALIPAY_ENABLED', 'false');
  expect(alipayConfig()).toBeNull();
  vi.stubEnv('ALIPAY_ENABLED', 'true');
  for (const key of [
    'ALIPAY_APP_ID',
    'ALIPAY_SELLER_ID',
    'ALIPAY_PRIVATE_KEY',
    'ALIPAY_PUBLIC_KEY',
    'ALIPAY_PUBLIC_ORIGIN',
  ])
    vi.stubEnv(key, '');
  expect(alipayConfig()).toBeNull();
  vi.stubEnv('ALIPAY_APP_ID', '2026000000000001');
  vi.stubEnv('ALIPAY_SELLER_ID', '2088000000000001');
  vi.stubEnv('ALIPAY_PRIVATE_KEY', 'private\\nkey');
  vi.stubEnv('ALIPAY_PUBLIC_KEY', 'public\\nkey');
  vi.stubEnv('ALIPAY_PUBLIC_ORIGIN', 'http://example.com');
  expect(alipayConfig()).toBeNull();
  vi.stubEnv('ALIPAY_PUBLIC_ORIGIN', 'https://example.com/');
  vi.stubEnv('ALIPAY_SANDBOX', 'true');
  expect(alipayConfig()).toMatchObject({
    origin: 'https://example.com',
    sandbox: true,
    privateKey: 'private\nkey',
  });
});
