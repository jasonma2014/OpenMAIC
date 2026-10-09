import { describe, expect, it, vi } from 'vitest';

import { PhoneCodeError } from '@/lib/saas/phone-code';
import { smsSenderFromEnv } from '@/lib/saas/sms';

describe('sms platform', () => {
  it('refuses to send when the platform url is missing', async () => {
    const sender = smsSenderFromEnv({} as NodeJS.ProcessEnv);
    await expect(sender.send('13800138000', '123456')).rejects.toBeInstanceOf(PhoneCodeError);
  });

  it('posts the phone and code to the configured platform', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sender = smsSenderFromEnv(
      {
        NODE_ENV: 'test',
        SMS_HTTP_URL: 'https://sms.example/send',
        SMS_HTTP_TOKEN: 'token',
      } as NodeJS.ProcessEnv,
      fetchImpl,
    );
    await sender.send('13800138000', '123456');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://sms.example/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', code: '123456' }),
      }),
    );
  });

  it('stops when the platform answers with an error', async () => {
    const sender = smsSenderFromEnv(
      { NODE_ENV: 'test', SMS_HTTP_URL: 'https://sms.example/send' } as NodeJS.ProcessEnv,
      vi.fn(async () => new Response('no', { status: 500 })),
    );
    await expect(sender.send('13800138000', '123456')).rejects.toBeInstanceOf(PhoneCodeError);
  });
});
