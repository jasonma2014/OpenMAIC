import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;

/** Store a password so the database never holds the original. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${key.toString('base64url')}`;
}

/** Check a password against a value produced by {@link hashPassword}. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, encoded] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const actual = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(encoded, 'base64url');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
