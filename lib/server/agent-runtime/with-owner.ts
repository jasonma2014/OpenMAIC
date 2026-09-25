import { isSaasEnabled } from '@/lib/config/feature-flags';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';

import { resolveRequestOwnerId } from './owner';

/**
 * Resolve the anonymous owner identity and run a handler with its response
 * headers.
 *
 * The Set-Cookie minted by resolveRequestOwnerId must ride every response,
 * including 4xx and 5xx: a client that retries after an error keeps the same
 * owner partition, while a 500 that dropped the cookie would silently make
 * the retry a different anonymous owner.
 */
export async function withRequestOwnerId(
  req: Pick<Request, 'headers'>,
  handler: (ownerId: string, responseHeaders: Headers) => Promise<Response>,
): Promise<Response> {
  const responseHeaders = new Headers();
  if (isSaasEnabled()) {
    try {
      const principal = await saasPrincipalFromHeaders(req.headers);
      if (!principal) {
        return new Response(JSON.stringify({ error: 'login_required' }), {
          status: 401,
          headers: responseHeaders,
        });
      }
      return await handler(principal.orgId, responseHeaders);
    } catch (error) {
      console.error('[saas] request failed under the organization session', error);
      return new Response('Internal Server Error', { status: 500, headers: responseHeaders });
    }
  }
  const ownerId = resolveRequestOwnerId(req, responseHeaders);
  try {
    return await handler(ownerId, responseHeaders);
  } catch (error) {
    console.error('[agent-runtime] request failed under an anonymous owner', error);
    return new Response('Internal Server Error', { status: 500, headers: responseHeaders });
  }
}
