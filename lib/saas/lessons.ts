import { randomUUID } from 'node:crypto';
import { SaasInputError, type SaasDb, type SaasPrincipal } from './accounts';
import { SchoolError, type ClassGroup } from './school';
import type { DocumentAction, DocumentAccess } from '@/lib/persistence/document-access';

/** Re-check membership at the boundary; a stale session is not authority. */
export async function manageableClass(
  db: SaasDb,
  userId: string,
  orgId: string,
  classGroupId?: string,
): Promise<ClassGroup> {
  const result = await db.query<ClassGroup>(
    `SELECT g.id, g.org_id AS "orgId", g.name, g.admin_user_id AS "adminUserId"
     FROM saas_class_groups g JOIN saas_memberships m ON m.org_id = g.org_id AND m.user_id = $1
     WHERE g.org_id = $2 AND ($3::text IS NULL OR g.id = $3)
       AND (m.role = 'org_admin' OR (m.role = 'teacher' AND g.admin_user_id = $1))
     ORDER BY g.created_at, g.id LIMIT 1`,
    [userId, orgId, classGroupId ?? null],
  );
  if (!result.rows[0]) throw new SchoolError('forbidden');
  return result.rows[0];
}

export async function prepareLesson(
  db: SaasDb,
  input: {
    userId: string;
    orgId: string;
    classGroupId: unknown;
    title: unknown;
    grade?: unknown;
    subject?: unknown;
  },
) {
  if (typeof input.classGroupId !== 'string' || !input.classGroupId)
    throw new SaasInputError('请选择班级');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200)
    throw new SaasInputError('请填写课程名（最多 200 字）');
  const grade = lessonCategory(input.grade);
  const subject = lessonCategory(input.subject);
  const group = await manageableClass(db, input.userId, input.orgId, input.classGroupId);
  const lesson = {
    stageId: randomUUID(),
    orgId: group.orgId,
    classGroupId: group.id,
    title: input.title.trim(),
    grade,
    subject,
  };
  await db.query(
    `INSERT INTO saas_lessons (stage_id, org_id, class_group_id, title, created_by, grade, subject) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [lesson.stageId, lesson.orgId, lesson.classGroupId, lesson.title, input.userId, grade, subject],
  );
  return lesson;
}

/** School privacy and class write permissions supplement document ownership. */
export async function lessonDocumentAccess(
  db: SaasDb,
  actor: SaasPrincipal,
  action: DocumentAction,
  meta: { ownerId: string; isPublic: boolean } | null,
): Promise<DocumentAccess> {
  if (meta && meta.ownerId !== actor.orgId) return 'forbid';
  if (action.kind === 'read')
    return actor.role === 'student' && !meta?.isPublic ? 'forbid' : 'allow';
  if (action.kind === 'list' || action.kind === 'unknown' || actor.role === 'student')
    return 'forbid';
  const result = await db.query<{ class_group_id: string }>(
    'SELECT class_group_id FROM saas_lessons WHERE stage_id = $1 AND org_id = $2',
    [action.stageId, actor.orgId],
  );
  if (!result.rows[0]) return 'forbid';
  try {
    await manageableClass(db, actor.userId, actor.orgId, result.rows[0].class_group_id);
    return 'allow';
  } catch (error) {
    if (error instanceof SchoolError) return 'forbid';
    throw error;
  }
}

export function lessonCategory(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > 40)
    throw new SaasInputError('年级和科目最多 40 字');
  return value.trim();
}
