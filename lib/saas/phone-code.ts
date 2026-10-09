import { createHash, randomInt, randomUUID } from 'node:crypto';

export const PHONE_CODE_TTL_MS = 5 * 60 * 1000;

export type PhoneCodePurpose = 'register' | 'login';

export type PhoneCodeFailure = 'invalid-phone' | 'send-failed' | 'incorrect' | 'expired' | 'used';

export class PhoneCodeError extends Error {
  constructor(readonly reason: PhoneCodeFailure) {
    super(reason);
    this.name = 'PhoneCodeError';
  }
}

export interface PhoneCodeRecord {
  id: string;
  phone: string;
  purpose: PhoneCodePurpose;
  codeHash: string;
  expiresAt: number;
  usedAt: number | null;
}

export interface PhoneCodeRepository {
  insert(record: PhoneCodeRecord): Promise<void>;
  findLatest(phone: string, purpose: PhoneCodePurpose): Promise<PhoneCodeRecord | null>;
  markUsed(id: string, usedAt: number): Promise<void>;
}

export interface SmsSender {
  send(phone: string, code: string): Promise<void>;
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') throw new PhoneCodeError('invalid-phone');
  const phone = value.replace(/[\s-]/g, '');
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new PhoneCodeError('invalid-phone');
  return phone;
}

export function hashPhoneCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function createPhoneCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function issuePhoneCode(input: {
  phone: unknown;
  purpose: PhoneCodePurpose;
  now: number;
  repo: PhoneCodeRepository;
  sender: SmsSender;
  createCode?: () => string;
  createId?: () => string;
  ttlMs?: number;
}): Promise<void> {
  const phone = normalizePhone(input.phone);
  const code = (input.createCode ?? createPhoneCode)();
  try {
    await input.sender.send(phone, code);
  } catch {
    throw new PhoneCodeError('send-failed');
  }
  const ttlMs = input.ttlMs ?? PHONE_CODE_TTL_MS;
  await input.repo.insert({
    id: (input.createId ?? randomUUID)(),
    phone,
    purpose: input.purpose,
    codeHash: hashPhoneCode(code),
    expiresAt: input.now + ttlMs,
    usedAt: null,
  });
}

export async function consumePhoneCode(input: {
  phone: unknown;
  purpose: PhoneCodePurpose;
  code: unknown;
  now: number;
  repo: PhoneCodeRepository;
}): Promise<void> {
  const phone = normalizePhone(input.phone);
  if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) {
    throw new PhoneCodeError('incorrect');
  }
  const record = await input.repo.findLatest(phone, input.purpose);
  if (!record) throw new PhoneCodeError('incorrect');
  if (record.usedAt !== null) throw new PhoneCodeError('used');
  if (input.now >= record.expiresAt) throw new PhoneCodeError('expired');
  if (record.codeHash !== hashPhoneCode(input.code)) throw new PhoneCodeError('incorrect');
  await input.repo.markUsed(record.id, input.now);
}
