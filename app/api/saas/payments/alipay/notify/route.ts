import { openSaasDb } from '@/lib/saas/db';
import { alipayConfig } from '@/lib/saas/alipay-config';
import { receiveAlipayNotification } from '@/lib/saas/alipay';
export const runtime = 'nodejs';
/** Public machine callback: authentication is the RSA2 signature, not a browser session. */
export async function POST(request: Request) {
  const config = alipayConfig();
  if (!config) return new Response('failure', { status: 503 });
  try {
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
      return new Response('failure', { status: 400 });
    const raw = await request.text();
    if (raw.length > 65536) return new Response('failure', { status: 413 });
    const form = new URLSearchParams(raw);
    const data: Record<string, string> = {};
    for (const [key, value] of form) {
      if (Object.hasOwn(data, key)) return new Response('failure', { status: 400 });
      data[key] = value;
    }
    await receiveAlipayNotification(await openSaasDb(), data, config);
    return new Response('success');
  } catch {
    return new Response('failure', { status: 400 });
  }
}
