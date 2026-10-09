import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { openSaasDb } from '@/lib/saas/db';
import { alipayConfig } from '@/lib/saas/alipay-config';
import { createAlipayOrder, readAlipayOrder } from '@/lib/saas/alipay';
import { saasErrorResponse } from '@/lib/saas/http';
import { apiError, apiSuccess } from '@/lib/server/api-response';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const actor = await saasPrincipalFromHeaders(request.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const config = alipayConfig();
    if (!config) return apiError('INVALID_REQUEST', 503, '支付宝支付尚未开通');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return apiError('INVALID_REQUEST', 400, '充值请求格式无效');
    return apiSuccess(
      await createAlipayOrder(
        await openSaasDb(),
        { ...actor, amountMilliYuan: body.amountMilliYuan, requestId: body.requestId },
        config,
      ),
      201,
    );
  } catch (error) {
    return saasErrorResponse(error);
  }
}
export async function GET(request: Request) {
  try {
    const actor = await saasPrincipalFromHeaders(request.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const orderId = new URL(request.url).searchParams.get('orderId') ?? '';
    return apiSuccess(await readAlipayOrder(await openSaasDb(), actor, orderId));
  } catch (error) {
    return saasErrorResponse(error);
  }
}
