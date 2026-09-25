import { principalForToken, type SaasPrincipal } from '@/lib/saas/accounts';
import { SAAS_SESSION_COOKIE, readRequestCookie } from '@/lib/saas/cookie';
import { openSaasDb } from '@/lib/saas/db';

/** The signed-in organization, or nothing when the cookie is missing or expired. */
export async function saasPrincipalFromHeaders(
  headers: Headers,
): Promise<SaasPrincipal | undefined> {
  const token = readRequestCookie(headers, SAAS_SESSION_COOKIE);
  if (!token) return undefined;
  return principalForToken(await openSaasDb(), token);
}
