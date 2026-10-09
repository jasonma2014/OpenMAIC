import type { AlipayConfig } from './alipay';

/** Server-only configuration. Never send keys to a browser. */
export function alipayConfig(): AlipayConfig | null {
  if (process.env.ALIPAY_ENABLED !== 'true') return null;
  const appId = process.env.ALIPAY_APP_ID?.trim();
  const sellerId = process.env.ALIPAY_SELLER_ID?.trim();
  const privateKey = process.env.ALIPAY_PRIVATE_KEY?.trim().replaceAll('\\n', '\n');
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY?.trim().replaceAll('\\n', '\n');
  const origin = process.env.ALIPAY_PUBLIC_ORIGIN?.trim();
  if (!appId || !sellerId || !privateKey || !alipayPublicKey || !origin) return null;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return {
      appId,
      sellerId,
      privateKey,
      alipayPublicKey,
      origin: url.origin,
      sandbox: process.env.ALIPAY_SANDBOX === 'true',
    };
  } catch {
    return null;
  }
}
