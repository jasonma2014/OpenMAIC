import { PhoneCodeError, type SmsSender } from '@/lib/saas/phone-code';

/**
 * Sends a verification code through an HTTP SMS platform.
 *
 * `SMS_HTTP_URL` receives `{ phone, code }`. `SMS_HTTP_TOKEN` is sent as a
 * bearer token when set. With no URL, sending fails and registration stops.
 */
export function smsSenderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): SmsSender {
  const url = env.SMS_HTTP_URL?.trim() ?? '';
  const token = env.SMS_HTTP_TOKEN?.trim() ?? '';
  return {
    async send(phone, code) {
      if (!url) throw new PhoneCodeError('send-failed');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, code }),
      });
      if (!response.ok) throw new PhoneCodeError('send-failed');
    },
  };
}
