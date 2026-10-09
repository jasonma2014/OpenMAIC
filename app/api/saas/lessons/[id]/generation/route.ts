import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { openSaasDb } from '@/lib/saas/db';
import { readSchoolGeneration, startSchoolGeneration } from '@/lib/saas/generation-jobs';
import { generateSchoolLesson } from '@/lib/saas/generation-runner';
import { guardSaasAction } from '@/lib/saas/guard';
import { saasErrorResponse } from '@/lib/saas/http';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const maxDuration = 800;
const inputSchema = z.object({
  requirement: z.string().trim().min(1).max(20_000),
  lessonBrief: z.object({
    grade: z.string().trim().min(1),
    textbook: z.string().trim().default(''),
    periods: z.string().trim().default(''),
    objectives: z.string().trim().min(1),
    baseline: z.string().trim().default(''),
  }),
  pdfContent: z
    .object({ text: z.string().max(2_000_000), images: z.array(z.string()).max(200) })
    .optional(),
  enableWebSearch: z.boolean().optional(),
  enableImageGeneration: z.boolean().optional(),
  enableVideoGeneration: z.boolean().optional(),
  enableTTS: z.boolean().optional(),
  agentMode: z.enum(['default', 'generate']).optional(),
});
type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const actor = await saasPrincipalFromHeaders(req.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const { id } = await params;
    return apiSuccess({ job: await readSchoolGeneration(await openSaasDb(), actor, id) });
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await saasPrincipalFromHeaders(req.headers);
    if (!actor) return apiError('UNAUTHENTICATED', 401, '请先登录');
    const { id } = await params;
    const db = await openSaasDb();
    const existing = await readSchoolGeneration(db, actor, id);
    if (existing) return apiSuccess({ job: existing });
    const gate = await guardSaasAction(req.headers, 'generate');
    if (gate instanceof Response) return gate;
    const parsed = inputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError('INVALID_REQUEST', 400, '备课内容格式不正确');
    const started = await startSchoolGeneration(db, actor, id, parsed.data);
    if (started.created) after(() => generateSchoolLesson(id, actor.orgId, req.nextUrl.origin));
    return apiSuccess({ job: started.job }, 202);
  } catch (error) {
    return saasErrorResponse(error);
  }
}
