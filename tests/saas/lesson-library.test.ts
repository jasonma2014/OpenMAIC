import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ensureDocumentSchema } from '@openmaic/storage/document/pg';
import { ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { ensureStageMetaSchema, markStageGenerationComplete } from '@/lib/persistence/stage-meta';
import { createOwnerBoundDocumentStore } from '@/lib/persistence/owner-bound-document-store';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import type { AppScene } from '@/lib/types/stage';
import { ensureSaasSchema, type SaasDb } from '@/lib/saas/accounts';
import { schoolRepository } from '@/lib/saas/school-store';
import { registerEmailAccount, createSchool, createClassGroup } from '@/lib/saas/school';
import { prepareLesson } from '@/lib/saas/lessons';
import {
  listSchoolLessons,
  reuseSchoolLesson,
  classifySchoolLesson,
} from '@/lib/saas/lesson-library';

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
let classGroupId: string;
const storeFor = (orgId: string) =>
  createOwnerBoundDocumentStore<AppScene>({
    pool: {
      connect: async () => ({
        query: (sql: string, params?: unknown[]) => database.query(sql, params),
        release() {},
      }),
    },
    ownerId: orgId,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
beforeAll(async () => {
  await ensureSaasSchema(db);
  await ensureDocumentSchema(database);
  await ensureStageMetaSchema(database);
  await ensureAssetSchema(database);
  const schools = schoolRepository(db);
  const user = await registerEmailAccount({
    schools,
    email: 'library@school.test',
    password: 'classroom-pass',
    name: '老师',
    kind: 'teacher',
  });
  const org = await createSchool({
    schools,
    userId: user.id,
    orgName: '课程库学校',
    now: Date.now(),
    signupCredit: 0,
  });
  actor = { userId: user.id, orgId: org.id };
  const group = await createClassGroup({
    schools,
    actorUserId: user.id,
    orgId: org.id,
    name: '三年级',
    adminUserId: user.id,
  });
  classGroupId = group.id;
  stageId = (
    await prepareLesson(db, {
      ...actor,
      classGroupId,
      title: '分数',
      grade: '三年级',
      subject: '数学',
    })
  ).stageId;
  await storeFor(org.id).saveDocument({
    stage: { id: stageId, name: '分数', createdAt: 1, updatedAt: 1 },
    scenes: [
      {
        id: 'quiz-1',
        stageId,
        type: 'quiz',
        title: '分数练习',
        order: 0,
        content: {
          type: 'quiz',
          questions: [
            {
              id: 'q1',
              type: 'single',
              question: '一半怎么表示？',
              options: [{ value: 'A', label: '1/2' }],
              answer: ['A'],
            },
          ],
        },
      },
    ],
    outline: { generationComplete: true },
  });
  await markStageGenerationComplete(database, stageId);
});
afterAll(() => database.close());

it('finds school lessons by grade and subject without exposing another school', async () => {
  expect(await listSchoolLessons(db, actor, { grade: '三年级', subject: '数学' })).toEqual([
    expect.objectContaining({ stageId, title: '分数', grade: '三年级', subject: '数学' }),
  ]);
  expect(await listSchoolLessons(db, actor, { subject: '语文' })).toEqual([]);
  await expect(
    listSchoolLessons(db, { ...actor, orgId: 'another-school' }, {}),
  ).rejects.toMatchObject({ reason: 'forbidden' });
});

it('copies a lesson into a managed class as an independent unpublished draft', async () => {
  const store = storeFor(actor.orgId);
  const copy = await reuseSchoolLesson(db, actor, stageId, classGroupId, store);
  expect(copy.stageId).not.toBe(stageId);
  const original = await store.loadDocument(stageId);
  const duplicated = await store.loadDocument(copy.stageId);
  expect(duplicated?.stage.name).toBe('分数');
  expect(duplicated?.scenes[0].stageId).toBe(copy.stageId);
  expect(duplicated?.scenes[0].id).not.toBe(original?.scenes[0].id);
  expect(duplicated?.scenes[0].content).toEqual(original?.scenes[0].content);
  expect(await listSchoolLessons(db, actor, {})).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stageId: copy.stageId,
        grade: '三年级',
        subject: '数学',
        isPublic: false,
      }),
    ]),
  );
  await store.putScene(copy.stageId, { ...duplicated!.scenes[0], title: '修改副本' });
  expect((await store.loadDocument(stageId))?.scenes[0].title).toBe('分数练习');
  await expect(
    reuseSchoolLesson(db, { ...actor, orgId: 'another-school' }, stageId, classGroupId, store),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  await expect(reuseSchoolLesson(db, actor, stageId, 'foreign-class', store)).rejects.toMatchObject(
    { reason: 'forbidden' },
  );
});

it('lets the class manager classify a completed course', async () => {
  await classifySchoolLesson(db, actor, stageId, { grade: '四年级', subject: '数学' });
  expect(await listSchoolLessons(db, actor, { grade: '四年级' })).toEqual([
    expect.objectContaining({ stageId }),
  ]);
  await expect(
    classifySchoolLesson(db, { ...actor, userId: 'outsider' }, stageId, {
      grade: '五年级',
      subject: '语文',
    }),
  ).rejects.toMatchObject({ reason: 'forbidden' });
});
