import { SaasInputError, type SaasDb } from './accounts';
import { manageableClass } from './lessons';
import { SchoolError } from './school';
import { gradeChoiceQuestions } from '@/lib/quiz/grading';
import { masteryFromAnswers, reviewOpenAnswer } from './lesson-craft';
import type { Scene } from '@/lib/types/stage';

type Actor = { userId: string; orgId: string };
export interface RecordedAnswer {
  questionId: string;
  question: string;
  answer: string | string[];
  answered: boolean;
  correct: boolean | null;
  comment?: string;
  followUp?: { lessonId: string; prompt: string };
}

export async function submitLessonQuiz(
  db: SaasDb,
  actor: Actor,
  stageId: string,
  input: { sceneId: string; attemptId: string; answers: Record<string, string | string[]> },
  loadScene: (stageId: string, sceneId: string) => Promise<Scene | null>,
) {
  await requireStudentLesson(db, actor, stageId);
  if (
    !input.attemptId ||
    input.attemptId.length > 128 ||
    !input.answers ||
    typeof input.answers !== 'object'
  )
    throw new SaasInputError('练习提交格式不正确');
  const scene = await loadScene(stageId, input.sceneId);
  if (!scene || scene.stageId !== stageId || scene.content.type !== 'quiz')
    throw new SchoolError('not-found');
  for (const value of Object.values(input.answers)) {
    if (
      typeof value !== 'string' &&
      !(Array.isArray(value) && value.every((part) => typeof part === 'string'))
    )
      throw new SaasInputError('答案格式不正确');
  }
  const grades = gradeChoiceQuestions(scene.content.questions, input.answers);
  const answers: RecordedAnswer[] = scene.content.questions.map((question) => {
    const answer = input.answers[question.id] ?? '';
    const answered = Array.isArray(answer) ? answer.length > 0 : answer.trim().length > 0;
    const grade = grades.find((result) => result.questionId === question.id);
    const written =
      question.type === 'short_answer' && question.analysis
        ? reviewOpenAnswer({
            lessonId: stageId,
            correct: typeof answer === 'string' && answer.includes(question.analysis),
            covered: [question.analysis],
            missed: [question.analysis],
            similarPrompt: question.question,
          })
        : null;
    return {
      questionId: question.id,
      question: question.question,
      answer,
      answered,
      correct: !answered
        ? false
        : written
          ? written.followUp
            ? false
            : true
          : question.type === 'short_answer'
            ? null
            : (grade?.correct ?? false),
      ...(written ? { comment: written.comment, ...(written.followUp ? { followUp: written.followUp } : {}) } : {}),
    };
  });
  await db.transaction(async (tx) => {
    await recordAttendance(tx, actor, stageId);
    await tx.query(
      `INSERT INTO saas_quiz_submissions (stage_id, org_id, user_id, scene_id, attempt_id, answers)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (stage_id, user_id, scene_id, attempt_id) DO NOTHING`,
      [stageId, actor.orgId, actor.userId, input.sceneId, input.attemptId, JSON.stringify(answers)],
    );
  });
  const stored = await db.query<{ answers: RecordedAnswer[] }>(
    'SELECT answers FROM saas_quiz_submissions WHERE stage_id = $1 AND user_id = $2 AND scene_id = $3 AND attempt_id = $4',
    [stageId, actor.userId, input.sceneId, input.attemptId],
  );
  return { answers: stored.rows[0].answers };
}

async function requireStudentLesson(db: SaasDb, actor: Actor, stageId: string) {
  const allowed = await db.query(
    `SELECT 1 FROM saas_memberships m JOIN stage_meta s ON s.owner_id = m.org_id
     JOIN saas_lessons l ON l.stage_id = s.stage_id AND l.org_id = m.org_id
     WHERE m.org_id = $1 AND m.user_id = $2 AND m.role = 'student'
       AND s.stage_id = $3 AND s.is_public = true AND s.deleted_at IS NULL`,
    [actor.orgId, actor.userId, stageId],
  );
  if (!allowed.rows.length) throw new SchoolError('forbidden');
}

export async function recordAttendance(db: SaasDb, actor: Actor, stageId: string) {
  await requireStudentLesson(db, actor, stageId);
  await db.query(
    `INSERT INTO saas_attendance (stage_id, org_id, user_id) VALUES ($1, $2, $3)
    ON CONFLICT (stage_id, user_id) DO UPDATE SET last_seen_at = now()`,
    [stageId, actor.orgId, actor.userId],
  );
}

export async function reviewLessonAnswer(
  db: SaasDb,
  actor: Actor,
  stageId: string,
  input: {
    studentId: string;
    sceneId: string;
    attemptId: string;
    questionId: string;
    correct: boolean;
  },
) {
  if (typeof input.correct !== 'boolean') throw new SaasInputError('请选择对或错');
  await lessonResults(db, actor, stageId);
  await db.transaction(async (tx) => {
    const found = await tx.query<{ answers: RecordedAnswer[] }>(
      'SELECT answers FROM saas_quiz_submissions WHERE stage_id = $1 AND org_id = $2 AND user_id = $3 AND scene_id = $4 AND attempt_id = $5 FOR UPDATE',
      [stageId, actor.orgId, input.studentId, input.sceneId, input.attemptId],
    );
    if (!found.rows[0]?.answers.some((answer) => answer.questionId === input.questionId))
      throw new SchoolError('not-found');
    const answers = found.rows[0].answers.map((answer) =>
      answer.questionId === input.questionId ? { ...answer, correct: input.correct } : answer,
    );
    await tx.query(
      'UPDATE saas_quiz_submissions SET answers = $6::jsonb WHERE stage_id = $1 AND org_id = $2 AND user_id = $3 AND scene_id = $4 AND attempt_id = $5',
      [
        stageId,
        actor.orgId,
        input.studentId,
        input.sceneId,
        input.attemptId,
        JSON.stringify(answers),
      ],
    );
  });
}

export async function lessonResults(db: SaasDb, actor: Actor, stageId: string) {
  const lesson = await db.query<{ class_group_id: string }>(
    'SELECT class_group_id FROM saas_lessons WHERE stage_id = $1 AND org_id = $2',
    [stageId, actor.orgId],
  );
  if (!lesson.rows[0]) throw new SchoolError('forbidden');
  await manageableClass(db, actor.userId, actor.orgId, lesson.rows[0].class_group_id);
  const attendance = await db.query<{
    userId: string;
    name: string;
    email: string;
    first_seen_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT u.id AS "userId", u.display_name AS name, u.email, a.first_seen_at, a.last_seen_at
     FROM saas_attendance a JOIN saas_users u ON u.id = a.user_id
     WHERE a.stage_id = $1 AND a.org_id = $2 ORDER BY a.first_seen_at`,
    [stageId, actor.orgId],
  );
  const submissions = await db.query<{
    user_id: string;
    scene_id: string;
    attempt_id: string;
    answers: RecordedAnswer[];
  }>(
    `SELECT DISTINCT ON (user_id, scene_id) user_id, scene_id, attempt_id, answers
     FROM saas_quiz_submissions WHERE stage_id = $1 AND org_id = $2 ORDER BY user_id, scene_id, submitted_at DESC, attempt_id DESC`,
    [stageId, actor.orgId],
  );
  const students = attendance.rows.map((row) => {
    const answers = submissions.rows
      .filter((submission) => submission.user_id === row.userId)
      .flatMap((submission) =>
        submission.answers.map((answer) => ({
          ...answer,
          sceneId: submission.scene_id,
          attemptId: submission.attempt_id,
        })),
      );
    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      firstSeenAt: new Date(row.first_seen_at).getTime(),
      lastSeenAt: new Date(row.last_seen_at).getTime(),
      completed: answers.filter((answer) => answer.answered).length,
      correct: answers.filter((answer) => answer.correct === true).length,
      incorrect: answers.filter((answer) => answer.correct === false).length,
      pendingReview: answers.filter((answer) => answer.correct === null).length,
      answers,
    };
  });
  return {
    stageId,
    mastery: masteryFromAnswers(
      students.flatMap((student) =>
        student.answers
          .filter((answer) => answer.correct !== null)
          .map((answer) => ({
            studentId: student.userId,
            studentName: student.name,
            point: answer.question,
            correct: answer.correct === true,
          })),
      ),
    ),
    students,
  };
}
