import { describe, expect, it } from 'vitest';

import {
  PhoneCodeError,
  consumePhoneCode,
  issuePhoneCode,
  type PhoneCodeRecord,
  type PhoneCodeRepository,
} from '@/lib/saas/phone-code';

const NOW = 1_700_000_000_000;

describe('phone verification codes', () => {
  it('sends a code to the phone and accepts that code once', async () => {
    const repo = memoryCodes();
    const sent: Array<{ phone: string; code: string }> = [];
    await issuePhoneCode({
      phone: ' 138-0013-8000 ',
      purpose: 'register',
      now: NOW,
      repo,
      sender: {
        send: async (phone, code) => {
          sent.push({ phone, code });
        },
      },
      createCode: () => '482913',
    });

    expect(sent).toEqual([{ phone: '13800138000', code: '482913' }]);
    await expect(
      consumePhoneCode({
        phone: '13800138000',
        purpose: 'register',
        code: '482913',
        now: NOW + 1000,
        repo,
      }),
    ).resolves.toBeUndefined();
    await expect(
      consumePhoneCode({
        phone: '13800138000',
        purpose: 'register',
        code: '482913',
        now: NOW + 1000,
        repo,
      }),
    ).rejects.toMatchObject({ reason: 'used' });
  });

  it('does not keep a code when the sms platform fails', async () => {
    const repo = memoryCodes();
    await expect(
      issuePhoneCode({
        phone: '13800138000',
        purpose: 'login',
        now: NOW,
        repo,
        sender: {
          send: async () => {
            throw new Error('platform down');
          },
        },
        createCode: () => '111111',
      }),
    ).rejects.toMatchObject({ reason: 'send-failed' });
    expect(repo.records).toEqual([]);
  });

  it('rejects a wrong code and an expired code', async () => {
    const repo = memoryCodes();
    await issuePhoneCode({
      phone: '13800138000',
      purpose: 'login',
      now: NOW,
      repo,
      sender: { send: async () => undefined },
      createCode: () => '222222',
      ttlMs: 1000,
    });
    await expect(
      consumePhoneCode({
        phone: '13800138000',
        purpose: 'login',
        code: '000000',
        now: NOW + 10,
        repo,
      }),
    ).rejects.toMatchObject({ reason: 'incorrect' });
    await expect(
      consumePhoneCode({
        phone: '13800138000',
        purpose: 'login',
        code: '222222',
        now: NOW + 1000,
        repo,
      }),
    ).rejects.toMatchObject({ reason: 'expired' });
  });

  it('uses the same send and check for teacher and student registration', async () => {
    const repo = memoryCodes();
    await issuePhoneCode({
      phone: '13900139000',
      purpose: 'register',
      now: NOW,
      repo,
      sender: { send: async () => undefined },
      createCode: () => '333333',
    });
    await expect(
      consumePhoneCode({
        phone: '13900139000',
        purpose: 'register',
        code: '333333',
        now: NOW,
        repo,
      }),
    ).resolves.toBeUndefined();
  });
});

function memoryCodes(): PhoneCodeRepository & { records: PhoneCodeRecord[] } {
  const records: PhoneCodeRecord[] = [];
  return {
    records,
    async insert(record) {
      records.push(record);
    },
    async findLatest(phone, purpose) {
      return (
        records.filter((record) => record.phone === phone && record.purpose === purpose).at(-1) ??
        null
      );
    },
    async markUsed(id, usedAt) {
      const record = records.find((item) => item.id === id);
      if (!record || record.usedAt !== null) throw new PhoneCodeError('used');
      record.usedAt = usedAt;
    },
  };
}
