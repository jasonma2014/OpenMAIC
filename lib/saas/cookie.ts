export function readRequestCookie(headers: Headers, name: string): string {
  const encoded = headers.get('cookie');
  if (!encoded) return '';
  for (const item of encoded.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/** HttpOnly cookie that carries the raw session token. The database stores only its hash. */
export const SAAS_SESSION_COOKIE = 'openmaic_saas_session';

/** Thirty days. The row's expires_at is the real limit; the cookie just matches it. */
export const SAAS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SAAS_SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  };
}
