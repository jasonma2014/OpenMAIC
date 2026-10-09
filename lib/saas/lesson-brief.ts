import type { SaasDb } from './accounts';
import type { LessonBrief } from './lesson-craft';

export async function rememberLessonBrief(
  db: SaasDb,
  stageId: string,
  brief: LessonBrief,
): Promise<void> {
  await db.query(
    `UPDATE saas_lessons
        SET grade = $2, textbook = $3, periods = $4, objectives = $5, baseline = $6
      WHERE stage_id = $1`,
    [stageId, brief.grade, brief.textbook, brief.periods, brief.objectives, brief.baseline],
  );
}

export async function latestLessonBrief(db: SaasDb, orgId: string): Promise<LessonBrief | null> {
  const found = await db.query<LessonBrief>(
    `SELECT grade, textbook, periods, objectives, baseline
       FROM saas_lessons
      WHERE org_id = $1 AND objectives <> ''
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId],
  );
  return found.rows[0] ?? null;
}
