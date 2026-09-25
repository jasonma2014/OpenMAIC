import { isSaasEnabled } from '@/lib/config/feature-flags';
import { principalForToken } from '@/lib/saas/accounts';
import { markupBps } from '@/lib/saas/billing';
import { openSaasDb } from '@/lib/saas/db';
import { principalBody, readSessionToken, saasDisabled, saasErrorResponse } from '@/lib/saas/http';
import { quoteLessonRetail } from '@/lib/saas/quote';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

export async function GET() {
  if (!isSaasEnabled()) return saasDisabled();
  try {
    const token = await readSessionToken();
    const principal = token ? await principalForToken(await openSaasDb(), token) : undefined;
    if (!principal) return apiError('UNAUTHENTICATED', 401, 'Sign in required');
    const retailMilliYuan = quoteLessonRetail(
      new Date(),
      markupBps(process.env.OPENMAIC_SAAS_MARKUP_BPS),
    );
    return apiSuccess({
      ...principalBody(principal),
      retailMilliYuan,
      sufficient: principal.balanceMilliYuan >= retailMilliYuan,
    });
  } catch (error) {
    return saasErrorResponse(error);
  }
}
