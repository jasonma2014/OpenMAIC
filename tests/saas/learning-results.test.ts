import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ensureSaasSchema, type SaasDb } from '@/lib/saas/accounts';
import { schoolRepository } from '@/lib/saas/school-store';
import {
  registerEmailAccount,
  createSchool,
  createClassGroup,
  applyToSchool,
  decideJoinRequest,
} from '@/lib/saas/school';
import { prepareLesson } from '@/lib/saas/lessons';
import {
  recordAttendance,
  lessonResults,
  submitLessonQuiz,
  reviewLessonAnswer,
} from '@/lib/saas/learning-results';
import type { Scene } from '@/lib/types/stage';

const database = new PGlite();
const adapt = (connection: Pick<PGlite, 'query'>): SaasDb => ({
  query: async <T>(sql: string, params?: readonly unknown[]) =>
    connection.query<T>(sql, params ? [...params] : []),
  transaction: (fn) =>
    connection === database ? database.transaction((tx) => fn(adapt(tx))) : fn(adapt(connection)),
});
const db = adapt(database);
let teacher: { userId: string; orgId: string };
let student: { userId: string; orgId: string };
let stageId: string;
beforeAll(async () => {
  await ensureSaasSchema(db);
  await database.exec(
    'CREATE TABLE stage_meta (stage_id text PRIMARY KEY, owner_id text, is_public boolean, deleted_at timestamptz)',
  );
  const schools = schoolRepository(db);
  const admin = await registerEmailAccount({
    schools,
    email: 'teacher@results.test',
    password: 'classroom-pass',
    name: '老师',
    kind: 'teacher',
  });
  const pupil = await registerEmailAccount({
    schools,
    email: 'student@results.test',
    password: 'classroom-pass',
    name: '小明',
    kind: 'student',
  });
  const org = await createSchool({
    schools,
    userId: admin.id,
    orgName: '上课学校',
    now: Date.now(),
    signupCredit: 0,
  });
  teacher = { userId: admin.id, orgId: org.id };
  student = { userId: pupil.id, orgId: org.id };
  const request = await applyToSchool({
    schools,
    userId: pupil.id,
    joinCode: org.joinCode,
    now: Date.now(),
  });
  await decideJoinRequest({
    schools,
    actorUserId: admin.id,
    requestId: request.id,
    decision: 'approve',
  });
  const group = await createClassGroup({
    schools,
    actorUserId: admin.id,
    orgId: org.id,
    name: '一年级',
    adminUserId: admin.id,
  });
  stageId = (await prepareLesson(db, { ...teacher, classGroupId: group.id, title: '认识数字' }))
    .stageId;
  await database.query('INSERT INTO stage_meta VALUES ($1, $2, true, NULL)', [stageId, org.id]);
});
afterAll(() => database.close());

it('shows a student once when they attend a published lesson repeatedly', async () => {
  await recordAttendance(db, student, stageId);
  await recordAttendance(db, student, stageId);
  expect(await lessonResults(db, teacher, stageId)).toMatchObject({
    students: [{ userId: student.userId, name: '小明', completed: 0, correct: 0 }],
  });
  await expect(lessonResults(db, student, stageId)).rejects.toMatchObject({ reason: 'forbidden' });
  await expect(
    recordAttendance(db, { ...student, orgId: 'another-school' }, stageId),
  ).rejects.toMatchObject({ reason: 'forbidden' });
});

it('grades stored choice questions on the server and keeps submission retries idempotent', async () => {
  const scene: Scene = {
    id: 'quiz-1',
    stageId,
    type: 'quiz',
    title: '练习',
    order: 1,
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '1 + 1',
          options: [
            { value: 'A', label: '1' },
            { value: 'B', label: '2' },
          ],
          answer: ['B'],
        },
        {
          id: 'q2',
          type: 'multiple',
          question: '偶数',
          options: [
            { value: 'A', label: '1' },
            { value: 'B', label: '2' },
            { value: 'C', label: '4' },
          ],
          answer: ['B', 'C'],
        },
        { id: 'q3', type: 'short_answer', question: '说说解题方法' },
      ],
    },
  };
  const submission = {
    sceneId: scene.id,
    attemptId: 'attempt-1',
    answers: { q1: 'B', q2: ['A'], q3: '我数了两遍' },
  };
  await submitLessonQuiz(db, student, stageId, submission, async () => scene);
  await submitLessonQuiz(
    db,
    student,
    stageId,
    { ...submission, answers: { q1: 'A', q2: ['B', 'C'] } },
    async () => scene,
  );
  const report = await lessonResults(db, teacher, stageId);
  expect(report.students[0]).toMatchObject({
    completed: 3,
    correct: 1,
    incorrect: 1,
    pendingReview: 1,
  });
  expect(report.students[0].answers).toContainEqual(
    expect.objectContaining({ questionId: 'q1', correct: true, answer: 'B' }),
  );
  expect(report.mastery).toEqual({
    unmastered: ['偶数'],
    studentsNeedingHelp: [{ studentId: student.userId, studentName: '小明', points: ['偶数'] }],
  });
});

it('keeps a wrong written answer in the same lesson and explains what was missed', async () => {
  const scene: Scene = {
    id: 'quiz-open',
    stageId,
    type: 'quiz',
    title: '开放题',
    order: 2,
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'open-1',
          type: 'short_answer',
          question: '分数是什么',
          analysis: '平均分以后的几份',
        },
      ],
    },
  };
  const wrong = await submitLessonQuiz(
    db,
    student,
    stageId,
    { sceneId: scene.id, attemptId: 'open-wrong', answers: { 'open-1': '就是一个数字' } },
    async () => scene,
  );
  expect(wrong.answers[0]).toMatchObject({
    correct: false,
    comment: expect.stringContaining('平均分以后的几份'),
    followUp: { lessonId: stageId, prompt: '分数是什么' },
  });
  const right = await submitLessonQuiz(
    db,
    student,
    stageId,
    { sceneId: scene.id, attemptId: 'open-right', answers: { 'open-1': '平均分以后的几份' } },
    async () => scene,
  );
  expect(right.answers[0]).toMatchObject({
    correct: true,
    comment: '平均分以后的几份',
  });
  expect(right.answers[0].followUp).toBeUndefined();
});

it('lets the class teacher review a written answer while students cannot change their own marks', async () => {
  const review = {
    studentId: student.userId,
    sceneId: 'quiz-1',
    attemptId: 'attempt-1',
    questionId: 'q3',
    correct: true,
  };
  await expect(reviewLessonAnswer(db, student, stageId, review)).rejects.toMatchObject({
    reason: 'forbidden',
  });
  await reviewLessonAnswer(db, teacher, stageId, review);
  expect((await lessonResults(db, teacher, stageId)).students[0]).toMatchObject({
    correct: 3,
    pendingReview: 0,
  });
});
