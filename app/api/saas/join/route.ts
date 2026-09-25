import { isSaasEnabled } from '@/lib/config/feature-flags';
import { joinClass } from '@/lib/saas/classes';
import { openSaasDb } from '@/lib/saas/db';
import {
  principalBody,
  saasDisabled,
  saasErrorResponse,
  writeSessionCookie,
} from '@/lib/saas/http';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSaasEnabled()) return saasDisabled();
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const record = typeof body === 'object' && body !== null ? body : {};
  try {
    const joined = await joinClass(
      await openSaasDb(),
      record as { code: unknown; email: unknown; password: unknown },
    );
    if (!joined) return apiError('INVALID_CREDENTIALS', 401, 'Class code or password is incorrect');
    await writeSessionCookie(joined.token);
    return apiSuccess({ ...principalBody(joined.principal), stageId: joined.stageId });
  } catch (error) {
    return saasErrorResponse(error);
  }
}
