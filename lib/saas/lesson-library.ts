import type { SaasDb } from './accounts';
import { SchoolError } from './school';
import { lessonCategory, manageableClass, prepareLesson } from './lessons';
import { randomUUID } from 'node:crypto';
import type { DocumentStore } from '@openmaic/storage';
import type { AppScene } from '@/lib/types/stage';
import { markStageGenerationComplete } from '@/lib/persistence/stage-meta';

type Actor = { userId: string; orgId: string };
export interface SchoolLibraryLesson {
  stageId: string;
  title: string;
  grade: string;
  subject: string;
  classGroupId: string;
  className: string;
  isPublic: boolean;
  canEdit: boolean;
}

export async function listSchoolLessons(
  db: SaasDb,
  actor: Actor,
  filters: { grade?: unknown; subject?: unknown },
) {
  const member = await db.query<{ role: string }>(
    `SELECT role FROM saas_memberships WHERE org_id = $1 AND user_id = $2 AND role IN ('org_admin', 'teacher')`,
    [actor.orgId, actor.userId],
  );
  if (!member.rows[0]) throw new SchoolError('forbidden');
  const result = await db.query<SchoolLibraryLesson>(
    `SELECT l.stage_id AS "stageId", l.title, l.grade, l.subject, l.class_group_id AS "classGroupId",
       g.name AS "className", m.is_public AS "isPublic", ($3::boolean OR g.admin_user_id = $2) AS "canEdit"
     FROM saas_lessons l JOIN saas_class_groups g ON g.id = l.class_group_id
       JOIN stage_meta m ON m.stage_id = l.stage_id AND m.owner_id = l.org_id
     WHERE l.org_id = $1 AND m.deleted_at IS NULL AND m.generation_complete
       AND ($4 = '' OR l.grade = $4) AND ($5 = '' OR l.subject = $5)
     ORDER BY l.created_at DESC, l.stage_id`,
    [
      actor.orgId,
      actor.userId,
      member.rows[0].role === 'org_admin',
      lessonCategory(filters.grade),
      lessonCategory(filters.subject),
    ],
  );
  return result.rows;
}

export async function classifySchoolLesson(
  db: SaasDb,
  actor: Actor,
  stageId: string,
  categories: { grade: unknown; subject: unknown },
) {
  const lesson = (await listSchoolLessons(db, actor, {})).find((item) => item.stageId === stageId);
  if (!lesson) throw new SchoolError('forbidden');
  await manageableClass(db, actor.userId, actor.orgId, lesson.classGroupId);
  await db.query(
    'UPDATE saas_lessons SET grade = $3, subject = $4 WHERE stage_id = $1 AND org_id = $2',
    [stageId, actor.orgId, lessonCategory(categories.grade), lessonCategory(categories.subject)],
  );
}

export async function reuseSchoolLesson(
  db: SaasDb,
  actor: Actor,
  stageId: string,
  classGroupId: string,
  store: Pick<DocumentStore<AppScene>, 'loadDocument' | 'saveDocument'>,
) {
  const source = (await listSchoolLessons(db, actor, {})).find((item) => item.stageId === stageId);
  if (!source) throw new SchoolError('forbidden');
  await manageableClass(db, actor.userId, actor.orgId, classGroupId);
  const document = await store.loadDocument(stageId);
  if (!document) throw new SchoolError('forbidden');
  const lesson = await prepareLesson(db, {
    ...actor,
    classGroupId,
    title: source.title,
    grade: source.grade,
    subject: source.subject,
  });
  const ids = new Map([
    [stageId, lesson.stageId],
    ...document.scenes.map((scene) => [scene.id, randomUUID()] as [string, string]),
  ]);
  // Remap internal scene links as well as their top-level identifiers. Assets
  // stay in this school's namespace and gain references from the new document.
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
  };
  const copy = remap(document) as typeof document;
  copy.stage.createdAt = Date.now();
  copy.stage.updatedAt = copy.stage.createdAt;
  const outline =
    copy.outline && typeof copy.outline === 'object' && !Array.isArray(copy.outline)
      ? ({ ...copy.outline } as Record<string, unknown>)
      : {};
  delete outline.producerRef;
  copy.outline = { ...outline, generationComplete: true, producer: 'client' };
  await store.saveDocument(copy);
  await markStageGenerationComplete(db, lesson.stageId);
  return lesson;
}
