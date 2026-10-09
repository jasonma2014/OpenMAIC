import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { openSaasDb } from '@/lib/saas/db';
import {
  lessonResults,
  recordAttendance,
  reviewLessonAnswer,
  submitLessonQuiz,
} from '@/lib/saas/learning-results';
import { saasErrorResponse } from '@/lib/saas/http';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
const identifier = z.string().min(1).max(128);
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attend') }),
  z.object({
    action: z.literal('submit'),
    sceneId: identifier,
    attemptId: identifier,
    answers: z.record(
      z.string().max(128),
      z.union([z.string().max(10_000), z.array(z.string().max(128)).max(100)]),
    ),
  }),
  z.object({
    action: z.literal('review'),
    studentId: identifier,
    sceneId: identifier,
    attemptId: identifier,
    questionId: identifier,
    correct: z.boolean(),
  }),
]);

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const actor = await saasPrincipalFromHeaders(req.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const { id } = await params;
    const report = await lessonResults(await openSaasDb(), actor, id);
    const document = await (await getOwnerScopedDocumentStore(actor.orgId)).loadDocument(id);
    const totalQuestions =
      document?.scenes.reduce(
        (total, scene) =>
          total + (scene.content.type === 'quiz' ? scene.content.questions.length : 0),
        0,
      ) ?? 0;
    return apiSuccess({ ...report, totalQuestions });
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await saasPrincipalFromHeaders(req.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError('INVALID_REQUEST', 400, '上课结果格式不正确');
    const db = await openSaasDb();
    if (parsed.data.action === 'attend') await recordAttendance(db, actor, id);
    else if (parsed.data.action === 'review') await reviewLessonAnswer(db, actor, id, parsed.data);
    else {
      const store = await getOwnerScopedDocumentStore(actor.orgId);
      return apiSuccess(
        await submitLessonQuiz(db, actor, id, parsed.data, (stageId, sceneId) =>
          store.getScene(stageId, sceneId),
        ),
      );
    }
    return apiSuccess({ recorded: true });
  } catch (error) {
    return saasErrorResponse(error);
  }
}
