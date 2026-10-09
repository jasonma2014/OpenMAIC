import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { openSaasDb } from '@/lib/saas/db';
import {
  listSchoolLessons,
  reuseSchoolLesson,
  classifySchoolLesson,
} from '@/lib/saas/lesson-library';
import { saasErrorResponse } from '@/lib/saas/http';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';

export const runtime = 'nodejs';
const id = z.string().min(1).max(128);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reuse'), stageId: id, classGroupId: id }),
  z.object({
    action: z.literal('classify'),
    stageId: id,
    grade: z.string().max(40),
    subject: z.string().max(40),
  }),
]);

export async function GET(req: NextRequest) {
  try {
    const actor = await saasPrincipalFromHeaders(req.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const lessons = await listSchoolLessons(await openSaasDb(), actor, {
      grade: req.nextUrl.searchParams.get('grade') ?? '',
      subject: req.nextUrl.searchParams.get('subject') ?? '',
    });
    return apiSuccess({ lessons });
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await saasPrincipalFromHeaders(req.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError('INVALID_REQUEST', 400, '课程库操作格式不正确');
    const db = await openSaasDb();
    const input = parsed.data;
    if (input.action === 'classify') {
      await classifySchoolLesson(db, actor, input.stageId, input);
      return apiSuccess({ saved: true });
    }
    const lesson = await reuseSchoolLesson(
      db,
      actor,
      input.stageId,
      input.classGroupId,
      await getOwnerScopedDocumentStore(actor.orgId),
    );
    return apiSuccess(lesson, 201);
  } catch (error) {
    return saasErrorResponse(error);
  }
}
