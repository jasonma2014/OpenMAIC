import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ensureDocumentSchema } from '@openmaic/storage/document/pg';
import { PgAssetStore, ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import { ensureStageMetaSchema, readStageMeta } from '@/lib/persistence/stage-meta';
import { createOwnerBoundDocumentStore } from '@/lib/persistence/owner-bound-document-store';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import type { AppScene } from '@/lib/types/stage';
import { ensureSaasSchema, type SaasDb } from '@/lib/saas/accounts';
import { schoolRepository } from '@/lib/saas/school-store';
import { registerEmailAccount, createSchool, createClassGroup } from '@/lib/saas/school';
import { prepareLesson } from '@/lib/saas/lessons';
import { startSchoolGeneration, readSchoolGeneration } from '@/lib/saas/generation-jobs';
import { generateSchoolLesson } from '@/lib/saas/generation-runner';
import { currentSaasOrgId } from '@/lib/saas/context';

const mocks = vi.hoisted(() => ({
  dir: '',
  db: null as SaasDb | null,
  provider: {},
  store: {},
  generate: vi.fn(),
}));
vi.mock('@/lib/server/classroom-generation', () => ({ generateClassroom: mocks.generate }));
vi.mock('@/lib/server/classroom-storage', () => ({
  get CLASSROOMS_DIR() {
    return mocks.dir;
  },
}));
vi.mock('@/lib/saas/db', () => ({ openSaasDb: async () => mocks.db }));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => mocks.provider,
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: async () => mocks.store,
}));

const database = new PGlite();
const db: SaasDb = {
  query: (sql, params) => database.query(sql, params ? [...params] : []),
  transaction: (fn) => fn(db),
};
beforeAll(async () => {
  mocks.db = db;
  mocks.dir = await mkdtemp(path.join(tmpdir(), 'mingke-generation-'));
  await ensureSaasSchema(db);
  await ensureDocumentSchema(database);
  await ensureStageMetaSchema(database);
  await ensureAssetSchema(database);
});
afterAll(async () => {
  await database.close();
  await rm(mocks.dir, { recursive: true, force: true });
});

it('persists a playable school lesson and imports its narration once across repeated starts', async () => {
  const schools = schoolRepository(db);
  const user = await registerEmailAccount({
    schools,
    email: 'runner@school.test',
    password: 'classroom-pass',
    name: '老师',
    kind: 'teacher',
  });
  const school = await createSchool({
    schools,
    userId: user.id,
    orgName: '后台生成学校',
    now: Date.now(),
    signupCredit: 1000,
  });
  const actor = { orgId: school.id, userId: user.id };
  const group = await createClassGroup({
    schools,
    actorUserId: user.id,
    orgId: school.id,
    name: '一班',
    adminUserId: user.id,
  });
  const lesson = await prepareLesson(db, { ...actor, classGroupId: group.id, title: '分数' });
  const store = createOwnerBoundDocumentStore<AppScene>({
    pool: {
      connect: async () => ({ query: (sql, params) => database.query(sql, params), release() {} }),
    },
    ownerId: school.id,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
  const assets = new PgAssetStore(database, {
    byteStore: new PgAssetByteStore(database),
    withTransaction: (fn) => database.transaction(fn),
  });
  mocks.store = store;
  mocks.provider = { pool: database, assetStore: assets };
  await mkdir(path.join(mocks.dir, lesson.stageId, 'audio'), { recursive: true });
  await writeFile(path.join(mocks.dir, lesson.stageId, 'audio', 'speech.mp3'), 'audio');
  mocks.generate.mockImplementation(async (_input, options) => {
    expect(currentSaasOrgId()).toBe(school.id);
    expect(options.stageId).toBe(lesson.stageId);
    await options.onProgress({
      step: 'generating_tts',
      progress: 96,
      scenesGenerated: 1,
      totalScenes: 1,
    });
    return {
      stage: { id: lesson.stageId, name: '分数', createdAt: 1, updatedAt: 1 },
      scenes: [
        {
          id: 'scene',
          stageId: lesson.stageId,
          title: '练习',
          type: 'quiz',
          order: 0,
          content: { type: 'quiz', questions: [] },
          actions: [
            {
              id: 'speech',
              type: 'speech',
              text: '认识分数',
              audioId: 'transport',
              audioUrl: `http://localhost/api/classroom-media/${lesson.stageId}/audio/speech.mp3`,
            },
          ],
        },
      ],
    };
  });
  await startSchoolGeneration(db, actor, lesson.stageId, {
    requirement: '分数',
    lessonBrief: {
      grade: '三年级',
      textbook: '数学',
      periods: '1课时',
      objectives: '能说出分数表示平均分后的几份',
      baseline: '会平均分',
    },
  });
  await generateSchoolLesson(lesson.stageId, school.id, 'http://localhost');
  await generateSchoolLesson(lesson.stageId, school.id, 'http://localhost');
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(await readSchoolGeneration(db, actor, lesson.stageId)).toMatchObject({
    status: 'succeeded',
    progress: 100,
  });
  expect(await readStageMeta(database, lesson.stageId)).toMatchObject({
    ownerId: school.id,
    isPublic: false,
    generationComplete: true,
  });
  const saved = await store.loadDocument(lesson.stageId);
  const speech = saved!.scenes[0].actions![0];
  expect(speech).not.toHaveProperty('audioUrl');
  expect(speech.type).toBe('speech');
  if (speech.type !== 'speech') throw new Error('Missing narration');
  const audio = await assets.resolve({ key: school.id }, speech.audioId!);
  expect(new TextDecoder().decode(audio?.bytes)).toBe('audio');
  expect(await assets.resolve({ key: 'another-school' }, speech.audioId!)).toBeNull();
});
