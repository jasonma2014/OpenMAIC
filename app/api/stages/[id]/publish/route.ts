/**
 * POST /api/stages/[id]/publish — make a document-backed course public.
 *
 * Owner-only; anonymous owners are refused with the reference's
 * `login_required` (a published course is a durable public artifact, so it
 * needs a real account, not an anonymous cookie partition).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isSaasEnabled } from '@/lib/config/feature-flags';
import { openSaasDb } from '@/lib/saas/db';
import { manageableClass } from '@/lib/saas/lessons';
import { SchoolError, issueCourseCode } from '@/lib/saas/school';
import { schoolRepository } from '@/lib/saas/school-store';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { canPerform } from '@/lib/saas/roles';
import { setStagePublished } from '@/lib/persistence/stage-meta';
import { getStageAccessDb, resolveStageAccess } from '@/lib/server/stage-access';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

async function ensureCourseCode(
  orgId: string,
  stageId: string,
  title: string,
  req: NextRequest,
): Promise<string | null> {
  const db = await openSaasDb();
  const lesson = await db.query<{ class_group_id: string }>(
    'SELECT class_group_id FROM saas_lessons WHERE org_id = $1 AND stage_id = $2',
    [orgId, stageId],
  );
  const classGroupId = lesson.rows[0]?.class_group_id;
  if (!classGroupId) return null;
  const principal = await saasPrincipalFromHeaders(req.headers);
  if (!principal || principal.orgId !== orgId) throw new SchoolError('forbidden');
  await manageableClass(db, principal.userId, orgId, classGroupId);
  const existing = await db.query<{ code: string }>(
    'SELECT code FROM saas_course_codes WHERE org_id = $1 AND stage_id = $2',
    [orgId, stageId],
  );
  if (existing.rows[0]?.code) return existing.rows[0].code;
  const issued = await issueCourseCode({
    actorUserId: principal.userId,
    classGroupId,
    stageId,
    title,
    schools: schoolRepository(db),
  });
  return issued.code;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isAgentRuntimeConfigured() && !isSaasEnabled())
    return new Response('Not found', { status: 404 });

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    const { id: stageId } = await params;
    try {
      if (ownerId.startsWith('anon:')) {
        return NextResponse.json(
          { error: 'login_required' },
          { status: 401, headers: responseHeaders },
        );
      }

      if (isSaasEnabled()) {
        const principal = await saasPrincipalFromHeaders(req.headers);
        if (!principal || principal.orgId !== ownerId || !canPerform(principal.role, 'publish')) {
          return NextResponse.json(
            { error: 'forbidden' },
            { status: 403, headers: responseHeaders },
          );
        }
      }

      const access = await resolveStageAccess(stageId);
      if (!access) {
        return NextResponse.json({ error: 'not_found' }, { status: 404, headers: responseHeaders });
      }
      if (access.ownerId !== ownerId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: responseHeaders });
      }

      if (access.isPublic) {
        const courseCode = isSaasEnabled()
          ? await ensureCourseCode(ownerId, stageId, access.name, req)
          : undefined;
        if (isSaasEnabled() && !courseCode) {
          return NextResponse.json(
            { error: 'need_class' },
            { status: 400, headers: responseHeaders },
          );
        }
        return NextResponse.json(
          {
            success: true,
            publishedAt: access.publishedAt,
            name: access.name,
            ...(courseCode ? { courseCode } : {}),
          },
          { status: 200, headers: responseHeaders },
        );
      }

      const courseCode = isSaasEnabled()
        ? await ensureCourseCode(ownerId, stageId, access.name, req)
        : undefined;
      if (isSaasEnabled() && !courseCode) {
        return NextResponse.json(
          { error: 'need_class' },
          { status: 400, headers: responseHeaders },
        );
      }
      const publishedAt = Date.now();
      const db = await getStageAccessDb();
      await setStagePublished(db, stageId, true, publishedAt);
      console.info('Stage published', { stageId, ownerId });
      return NextResponse.json(
        { success: true, publishedAt, name: access.name, ...(courseCode ? { courseCode } : {}) },
        { status: 200, headers: responseHeaders },
      );
    } catch (error) {
      if (error instanceof SchoolError) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: responseHeaders });
      }
      console.error('Failed to publish stage', {
        stageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: responseHeaders },
      );
    }
  });
}
