import { SaasInputError, type SaasDb } from './accounts';
import { manageableClass } from './lessons';
import { SchoolError } from './school';
import { assertLessonBrief, composeLessonRequirement, LessonCraftError } from './lesson-craft';
import { rememberLessonBrief } from './lesson-brief';
import type { GenerateClassroomInput } from '@/lib/server/classroom-generation';

type Actor = { userId: string; orgId: string };
export interface SchoolGenerationProgress {
  itemsCompleted?: number;
  itemsTotal?: number;
  mediaFailed?: number;
  ttsFailed?: number;
  step: string;
  progress: number;
  scenesGenerated: number;
  totalScenes?: number;
}
export interface SchoolGenerationJob extends SchoolGenerationProgress {
  stageId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error?: string;
}

async function authorize(db: SaasDb, actor: Actor, stageId: string) {
  const lesson = await db.query<{ class_group_id: string }>(
    'SELECT class_group_id FROM saas_lessons WHERE stage_id = $1 AND org_id = $2',
    [stageId, actor.orgId],
  );
  if (!lesson.rows[0]) throw new SchoolError('forbidden');
  await manageableClass(db, actor.userId, actor.orgId, lesson.rows[0].class_group_id);
}

export async function startSchoolGeneration(
  db: SaasDb,
  actor: Actor,
  stageId: string,
  input: GenerateClassroomInput,
) {
  await authorize(db, actor, stageId);
  let prepared = input;
  try {
    const brief = assertLessonBrief(input.lessonBrief);
    prepared = {
      ...input,
      lessonBrief: brief,
      requirement: composeLessonRequirement(brief, input.requirement),
    };
    await rememberLessonBrief(db, stageId, brief);
  } catch (error) {
    if (error instanceof LessonCraftError) throw new SaasInputError('请填写年级和教学目标');
    throw error;
  }
  if (!prepared.requirement.trim()) throw new SaasInputError('请填写备课要求');
  const inserted = await db.query<{ stage_id: string }>(
    `INSERT INTO saas_generation_jobs (stage_id, org_id, input, status, progress)
     VALUES ($1, $2, $3::jsonb, 'queued', $4::jsonb) ON CONFLICT (stage_id) DO NOTHING RETURNING stage_id`,
    [
      stageId,
      actor.orgId,
      JSON.stringify(prepared),
      JSON.stringify({ step: 'queued', progress: 0, scenesGenerated: 0 }),
    ],
  );
  return {
    created: inserted.rows.length === 1,
    job: await readSchoolGeneration(db, actor, stageId),
  };
}

export async function readSchoolGeneration(
  db: SaasDb,
  actor: Actor,
  stageId: string,
): Promise<SchoolGenerationJob | null> {
  await authorize(db, actor, stageId);
  const found = await db.query<{
    status: SchoolGenerationJob['status'];
    progress: SchoolGenerationProgress;
    error: string | null;
  }>(
    'SELECT status, progress, error FROM saas_generation_jobs WHERE stage_id = $1 AND org_id = $2',
    [stageId, actor.orgId],
  );
  const row = found.rows[0];
  return row
    ? { stageId, status: row.status, ...row.progress, ...(row.error ? { error: row.error } : {}) }
    : null;
}

export async function runSchoolGeneration(
  db: SaasDb,
  stageId: string,
  produce: (
    input: GenerateClassroomInput,
    onProgress: (progress: SchoolGenerationProgress) => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const claimed = await db.query<{ input: GenerateClassroomInput }>(
    `UPDATE saas_generation_jobs SET status = 'running', updated_at = now() WHERE stage_id = $1 AND status = 'queued' RETURNING input`,
    [stageId],
  );
  if (!claimed.rows[0]) return;
  try {
    await produce(claimed.rows[0].input, async (progress) => {
      await db.query(
        'UPDATE saas_generation_jobs SET progress = progress || $2::jsonb, updated_at = now() WHERE stage_id = $1',
        [stageId, JSON.stringify(progress)],
      );
    });
    await db.query(
      `UPDATE saas_generation_jobs SET status = 'succeeded', progress = progress || '{"step":"completed","progress":100}'::jsonb, updated_at = now() WHERE stage_id = $1`,
      [stageId],
    );
  } catch (error) {
    console.error('School generation failed', { stageId, error });
    await db.query(
      `UPDATE saas_generation_jobs SET status = 'failed', error = $2, updated_at = now() WHERE stage_id = $1`,
      [stageId, '生成未完成，请联系管理员查看原因。重复打开页面不会重新扣费。'],
    );
  }
}
