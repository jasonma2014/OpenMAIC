import { isSaasEnabled } from '@/lib/config/feature-flags';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { openSaasDb } from '@/lib/saas/db';
import { lessonDocumentAccess } from '@/lib/saas/lessons';
import { readStageMeta } from '@/lib/persistence/stage-meta';

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
  req: Pick<Request, 'headers'> & Partial<Pick<Request, 'url' | 'method'>>,
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
      if (req.url) {
        const pathname = new URL(req.url).pathname;
        // The old workbench has organization-wide mutation powers. School
        // courses use class-bound generation, editing, and the library instead.
        if (
          pathname.startsWith('/api/agent/') ||
          pathname.startsWith('/api/folders') ||
          (pathname === '/api/stages' && req.method !== 'GET')
        ) {
          return Response.json({ error: '请从学校首页备课和管理课程' }, { status: 403 });
        }
        const stage = pathname.match(/^\/api\/stages\/([^/]+)(?:\/|$)/);
        if (stage && !pathname.endsWith('/publish')) {
          const stageId = decodeURIComponent(stage[1]);
          const db = await openSaasDb();
          const meta = await readStageMeta(db, stageId);
          const access = await lessonDocumentAccess(
            db,
            principal,
            {
              kind: req.method === 'GET' ? 'read' : 'write',
              stageId,
            },
            meta,
          );
          if (access !== 'allow') return Response.json({ error: 'forbidden' }, { status: 403 });
        }
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
