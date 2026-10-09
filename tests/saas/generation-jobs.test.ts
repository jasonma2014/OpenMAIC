import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ensureSaasSchema, SaasInputError, type SaasDb } from '@/lib/saas/accounts';
import { schoolRepository } from '@/lib/saas/school-store';
import { registerEmailAccount, createSchool, createClassGroup } from '@/lib/saas/school';
import { prepareLesson } from '@/lib/saas/lessons';
import {
  startSchoolGeneration,
  readSchoolGeneration,
  runSchoolGeneration,
} from '@/lib/saas/generation-jobs';
import { latestLessonBrief } from '@/lib/saas/lesson-brief';
import { loadDesk, startAccountSession } from '@/lib/saas/desk';

const database = new PGlite();
const adapt = (connection: Pick<PGlite, 'query'>): SaasDb => ({
  query: async <T>(sql: string, params?: readonly unknown[]) =>
    connection.query<T>(sql, params ? [...params] : []),
  transaction: (fn) =>
    connection === database ? database.transaction((tx) => fn(adapt(tx))) : fn(adapt(connection)),
});
const db = adapt(database);
let actor: { userId: string; orgId: string };
let stageId: string;
beforeAll(async () => {
  await ensureSaasSchema(db);
  const schools = schoolRepository(db);
  const user = await registerEmailAccount({
    schools,
    email: 'jobs@school.test',
    password: 'classroom-pass',
    name: '老师',
    kind: 'teacher',
  });
  const org = await createSchool({
    schools,
    userId: user.id,
    orgName: '任务学校',
    now: Date.now(),
    signupCredit: 50_000,
  });
  actor = { userId: user.id, orgId: org.id };
  const group = await createClassGroup({
    schools,
    actorUserId: user.id,
    orgId: org.id,
    name: '一年级',
    adminUserId: user.id,
  });
  stageId = (await prepareLesson(db, { ...actor, classGroupId: group.id, title: '认识数字' }))
    .stageId;
});
afterAll(() => database.close());

const ready = {
  requirement: '认识数字',
  lessonBrief: {
    grade: '一年级',
    textbook: '数学',
    periods: '1课时',
    objectives: '能认出1到10',
    baseline: '会数数',
  },
};

it('refuses to generate until the grade and objective are filled in', async () => {
  await expect(
    startSchoolGeneration(db, actor, stageId, { requirement: '认识数字' }),
  ).rejects.toBeInstanceOf(SaasInputError);
});

it('starts one durable generation per lesson and can read its progress after leaving the page', async () => {
  const requests = await Promise.all(
    [1, 2].map(() => startSchoolGeneration(db, actor, stageId, ready)),
  );
  expect(requests.map((request) => request.created).sort()).toEqual([false, true]);
  let runs = 0;
  const produce = async (
    _input: unknown,
    progress: (value: {
      step: string;
      scenesGenerated: number;
      totalScenes: number;
      progress: number;
    }) => Promise<void>,
  ) => {
    runs++;
    await progress({ step: 'generating_scenes', scenesGenerated: 2, totalScenes: 5, progress: 45 });
    const observed = await readSchoolGeneration(db, actor, stageId);
    expect(observed).toMatchObject({
      status: 'running',
      step: 'generating_scenes',
      scenesGenerated: 2,
      totalScenes: 5,
    });
  };
  await Promise.all([
    runSchoolGeneration(db, stageId, produce),
    runSchoolGeneration(db, stageId, produce),
  ]);
  expect(runs).toBe(1);
  expect(await readSchoolGeneration(db, actor, stageId)).toMatchObject({
    status: 'succeeded',
    step: 'completed',
    progress: 100,
  });
  expect(await latestLessonBrief(db, actor.orgId)).toEqual(ready.lessonBrief);
  expect(
    (await startSchoolGeneration(db, actor, stageId, { ...ready, requirement: '重复点击' })).created,
  ).toBe(false);
  await expect(
    readSchoolGeneration(db, { ...actor, orgId: 'another-school' }, stageId),
  ).rejects.toMatchObject({ reason: 'forbidden' });
});

it('lists the saved generation on the teacher school desk so it can be reopened', async () => {
  const token = await startAccountSession(db, actor.userId, actor.orgId);
  const desk = await loadDesk(db, token);
  expect(desk?.generations).toEqual([
    expect.objectContaining({ stageId, title: '认识数字', status: 'succeeded' }),
  ]);
});
