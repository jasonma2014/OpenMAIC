import { apiError } from '@/lib/server/api-response';

export const runtime = 'nodejs';

/** Class codes no longer create accounts or memberships. */
export async function POST(_request: Request) {
  return apiError(
    'INVALID_REQUEST',
    410,
    '请先注册并登录，再用机构码申请加入学校，等待管理员通过。',
  );
}
