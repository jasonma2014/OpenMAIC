import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ensureSaasSchema, registerOrgAdmin, type SaasDb } from '@/lib/saas/accounts';
import {
  registerFromBody,
  loginFromBody,
  schoolActionFromBody,
  currentSession,
} from '@/lib/saas/http';
import { POST as legacyJoin } from '@/app/api/saas/join/route';
import { guardSaasAction } from '@/lib/saas/guard';
import { SAAS_SESSION_COOKIE } from '@/lib/saas/cookie';
import { lessonDocumentAccess } from '@/lib/saas/lessons';
import { NextRequest } from 'next/server';
import { POST as publishLesson } from '@/app/api/stages/[id]/publish/route';
import { GET as lessonMeta } from '@/app/api/stage-meta/[stageId]/route';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { GET as legacyClassroom, POST as legacySaveClassroom } from '@/app/api/classroom/route';
import { GET as legacyMedia } from '@/app/api/classroom-media/[classroomId]/[...path]/route';
import { STAGE_META_SCHEMA } from '@/lib/persistence/stage-meta';

const state = vi.hoisted(() => ({ db: null as SaasDb | null, token: '' }));
vi.mock('@/lib/saas/db', () => ({ openSaasDb: async () => state.db }));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ pool: state.db }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (state.token ? { value: state.token } : undefined),
    set: (_name: string, value: string) => {
      state.token = value;
    },
  }),
}));
const database = new PGlite();
beforeAll(async () => {
  const adapt = (connection: Pick<PGlite, 'query'>): SaasDb => ({
    query: async <T>(sql: string, params?: readonly unknown[]) =>
      connection.query<T>(sql, params ? [...params] : []),
    transaction: (fn) =>
      connection === database ? database.transaction((tx) => fn(adapt(tx))) : fn(adapt(connection)),
  });
  state.db = adapt(database);
  await ensureSaasSchema(state.db);
  await database.exec(
    'CREATE TABLE document_stages (id text PRIMARY KEY, name text, owner_id text)',
  );
  await database.exec(STAGE_META_SCHEMA);
  vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
  vi.stubEnv('DATABASE_URL', 'postgres://test');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await database.close();
});

it('lets a teacher correct an invalid school name without losing their email', async () => {
  const account = {
    email: 'retry@school.test',
    password: 'classroom-pass',
    name: '王老师',
    kind: 'teacher',
    action: 'create',
  };
  expect((await registerFromBody({ ...account, orgName: '' })).status).toBe(400);
  const retry = await registerFromBody({ ...account, orgName: '第一中学' });
  expect(retry.status).toBe(201);
  expect(await retry.json()).toMatchObject({
    email: account.email,
    role: 'org_admin',
    orgName: '第一中学',
  });
  expect((await loginFromBody({ email: account.email, password: account.password })).status).toBe(
    200,
  );
});

it('retires the unauthenticated class-code shortcut to membership', async () => {
  const response = await legacyJoin(
    new Request('http://localhost/api/saas/join', {
      method: 'POST',
      body: JSON.stringify({
        code: 'OLDCODE',
        email: 'student@school.test',
        password: 'classroom-pass',
      }),
    }),
  );
  expect(response.status).toBe(410);
});

it('allows only the school administrator to replace a class administrator with a school teacher', async () => {
  const admin = await (
    await registerFromBody({
      email: 'admin@school.test',
      password: 'classroom-pass',
      name: '管理员',
      kind: 'teacher',
      action: 'create',
      orgName: '班级学校',
    })
  ).json();
  const adminToken = state.token;
  const teacher = await (
    await registerFromBody({
      email: 'teacher@school.test',
      password: 'classroom-pass',
      name: '老师',
      kind: 'teacher',
      joinCode: admin.joinCode,
    })
  ).json();
  const teacherToken = state.token;
  state.token = adminToken;
  const desk = await (await currentSession()).json();
  expect(
    (
      await schoolActionFromBody({
        action: 'decide',
        requestId: desk.requests[0].id,
        decision: 'approve',
      })
    ).status,
  ).toBe(200);
  const created = await (
    await schoolActionFromBody({ action: 'class', name: '一年级', adminUserId: admin.userId })
  ).json();
  const classGroupId = created.classes[0].id;
  const changed = await schoolActionFromBody({
    action: 'class-admin',
    classGroupId,
    adminUserId: teacher.userId,
  });
  expect(changed.status).toBe(200);
  expect((await changed.json()).classes[0]).toMatchObject({ adminUserId: teacher.userId });
  state.token = teacherToken;
  expect(
    (await schoolActionFromBody({ action: 'class-admin', classGroupId, adminUserId: admin.userId }))
      .status,
  ).toBe(400);
});

it('keeps only approved schools current after the student is removed from one school', async () => {
  const admin = await (
    await registerFromBody({
      email: 'remove-admin@school.test',
      password: 'classroom-pass',
      name: '管理员',
      kind: 'teacher',
      action: 'create',
      orgName: '学校甲',
    })
  ).json();
  const adminToken = state.token;
  const other = await (await schoolActionFromBody({ action: 'create', orgName: '学校乙' })).json();
  const student = await (
    await registerFromBody({
      email: 'remove-student@school.test',
      password: 'classroom-pass',
      name: '学生',
      kind: 'student',
      joinCode: admin.joinCode,
    })
  ).json();
  const studentToken = state.token;
  await schoolActionFromBody({ action: 'apply', joinCode: other.joinCode });
  state.token = adminToken;
  for (const orgId of [admin.orgId, other.orgId]) {
    const desk = await (await schoolActionFromBody({ action: 'switch', orgId })).json();
    await schoolActionFromBody({
      action: 'decide',
      requestId: desk.requests[0].id,
      decision: 'approve',
    });
  }
  state.token = studentToken;
  await schoolActionFromBody({ action: 'switch', orgId: admin.orgId });
  state.token = adminToken;
  await schoolActionFromBody({ action: 'switch', orgId: admin.orgId });
  expect((await schoolActionFromBody({ action: 'remove', userId: student.userId })).status).toBe(
    200,
  );
  state.token = studentToken;
  const remaining = await (await currentSession()).json();
  expect(remaining.orgId).toBe(other.orgId);
  expect(remaining.orgs).toHaveLength(1);
});

it('requires a class in the current school before reserving a lesson for generation', async () => {
  const admin = await (
    await registerFromBody({
      email: 'lesson-admin@school.test',
      password: 'classroom-pass',
      name: '备课老师',
      kind: 'teacher',
      action: 'create',
      orgName: '备课学校',
    })
  ).json();
  expect((await schoolActionFromBody({ action: 'prepare-lesson', title: '分数' })).status).toBe(
    400,
  );
  const desk = await (
    await schoolActionFromBody({ action: 'class', name: '三年级', adminUserId: admin.userId })
  ).json();
  const prepared = await schoolActionFromBody({
    action: 'prepare-lesson',
    classGroupId: desk.classes[0].id,
    title: '分数',
  });
  expect(prepared.status).toBe(201);
  expect(await prepared.json()).toMatchObject({
    orgId: admin.orgId,
    classGroupId: desk.classes[0].id,
    stageId: expect.any(String),
  });
  await schoolActionFromBody({ action: 'create', orgName: '另一所备课学校' });
  expect(
    (
      await schoolActionFromBody({
        action: 'prepare-lesson',
        classGroupId: desk.classes[0].id,
        title: '分数',
      })
    ).status,
  ).toBe(400);
});

it('blocks paid generation before a school has a manageable class', async () => {
  vi.stubEnv('OPENMAIC_SAAS_SIGNUP_CREDIT_MILLI_YUAN', '10000');
  const admin = await (
    await registerFromBody({
      email: 'generation-admin@school.test',
      password: 'classroom-pass',
      name: '老师',
      kind: 'teacher',
      action: 'create',
      orgName: '生成学校',
    })
  ).json();
  const headers = new Headers({ cookie: `${SAAS_SESSION_COOKIE}=${state.token}` });
  const blocked = await guardSaasAction(headers, 'generate');
  expect(blocked).toBeInstanceOf(Response);
  expect((blocked as Response).status).toBe(403);
  await schoolActionFromBody({ action: 'class', name: '四年级', adminUserId: admin.userId });
  expect(await guardSaasAction(headers, 'generate')).toEqual({ orgId: admin.orgId });
});

it('allows a teacher to edit only their class while keeping other schools private', async () => {
  const admin = await (
    await registerFromBody({
      email: 'edit-admin@school.test',
      password: 'classroom-pass',
      name: '校长',
      kind: 'teacher',
      action: 'create',
      orgName: '编辑学校',
    })
  ).json();
  const adminToken = state.token;
  const desk = await (
    await schoolActionFromBody({ action: 'class', name: '五年级', adminUserId: admin.userId })
  ).json();
  const lesson = await (
    await schoolActionFromBody({
      action: 'prepare-lesson',
      classGroupId: desk.classes[0].id,
      title: '小数',
    })
  ).json();
  const teacher = await (
    await registerFromBody({
      email: 'edit-teacher@school.test',
      password: 'classroom-pass',
      name: '老师',
      kind: 'teacher',
      joinCode: admin.joinCode,
    })
  ).json();
  state.token = adminToken;
  const pending = await (await currentSession()).json();
  await schoolActionFromBody({
    action: 'decide',
    requestId: pending.requests[0].id,
    decision: 'approve',
  });
  const actor = { ...admin, userId: teacher.userId, role: 'teacher' as const };
  const meta = { ownerId: admin.orgId, isPublic: false };
  expect(
    await lessonDocumentAccess(state.db!, actor, { kind: 'write', stageId: lesson.stageId }, meta),
  ).toBe('forbid');
  await schoolActionFromBody({
    action: 'class-admin',
    classGroupId: desk.classes[0].id,
    adminUserId: teacher.userId,
  });
  expect(
    await lessonDocumentAccess(state.db!, actor, { kind: 'write', stageId: lesson.stageId }, meta),
  ).toBe('allow');
  expect(
    await lessonDocumentAccess(
      state.db!,
      actor,
      { kind: 'read', stageId: lesson.stageId },
      { ownerId: 'other-school', isPublic: true },
    ),
  ).toBe('forbid');
});

it('keeps a lesson private when publication is rejected for missing class placement', async () => {
  const admin = await (
    await registerFromBody({
      email: 'publish-admin@school.test',
      password: 'classroom-pass',
      name: '老师',
      kind: 'teacher',
      action: 'create',
      orgName: '发布学校',
    })
  ).json();
  await database.query('INSERT INTO document_stages (id, name, owner_id) VALUES ($1, $2, $3)', [
    'unplaced',
    '未归班课程',
    admin.orgId,
  ]);
  await database.query('INSERT INTO stage_meta (stage_id, owner_id) VALUES ($1, $2)', [
    'unplaced',
    admin.orgId,
  ]);
  const headers = { cookie: `${SAAS_SESSION_COOKIE}=${state.token}` };
  expect(
    (
      await publishLesson(
        new NextRequest('http://localhost/api/stages/unplaced/publish', {
          method: 'POST',
          headers,
        }),
        { params: Promise.resolve({ id: 'unplaced' }) },
      )
    ).status,
  ).toBe(400);
  const meta = await lessonMeta(
    new NextRequest('http://localhost/api/stage-meta/unplaced', { headers }),
    { params: Promise.resolve({ stageId: 'unplaced' }) },
  );
  expect(await meta.json()).toMatchObject({ isPublic: false });
});

it('publishes in the reserved class and refuses another teacher even when a course code exists', async () => {
  const admin = await (
    await registerFromBody({
      email: 'class-publisher@school.test',
      password: 'classroom-pass',
      name: '校长',
      kind: 'teacher',
      action: 'create',
      orgName: '发布班级学校',
    })
  ).json();
  const adminToken = state.token;
  await schoolActionFromBody({ action: 'class', name: '校长的班', adminUserId: admin.userId });
  const teacher = await (
    await registerFromBody({
      email: 'class-teacher@school.test',
      password: 'classroom-pass',
      name: '班主任',
      kind: 'teacher',
      joinCode: admin.joinCode,
    })
  ).json();
  const teacherToken = state.token;
  state.token = adminToken;
  const pending = await (await currentSession()).json();
  await schoolActionFromBody({
    action: 'decide',
    requestId: pending.requests[0].id,
    decision: 'approve',
  });
  const desk = await (
    await schoolActionFromBody({ action: 'class', name: '老师的班', adminUserId: teacher.userId })
  ).json();
  const group = desk.classes.find(
    (item: { adminUserId: string }) => item.adminUserId === teacher.userId,
  );
  state.token = teacherToken;
  const lesson = await (
    await schoolActionFromBody({
      action: 'prepare-lesson',
      classGroupId: group.id,
      title: '小数乘法',
    })
  ).json();
  await database.query('INSERT INTO document_stages (id, name, owner_id) VALUES ($1, $2, $3)', [
    lesson.stageId,
    '小数乘法',
    admin.orgId,
  ]);
  await database.query('INSERT INTO stage_meta (stage_id, owner_id) VALUES ($1, $2)', [
    lesson.stageId,
    admin.orgId,
  ]);
  const publish = () =>
    publishLesson(
      new NextRequest(`http://localhost/api/stages/${lesson.stageId}/publish`, {
        method: 'POST',
        headers: { cookie: `${SAAS_SESSION_COOKIE}=${teacherToken}` },
      }),
      { params: Promise.resolve({ id: lesson.stageId }) },
    );
  const published = await publish();
  expect(published.status).toBe(200);
  expect(await published.json()).toMatchObject({ courseCode: expect.any(String) });
  state.token = adminToken;
  await schoolActionFromBody({
    action: 'class-admin',
    classGroupId: group.id,
    adminUserId: admin.userId,
  });
  expect((await publish()).status).toBe(403);
  const meta = await lessonMeta(
    new NextRequest(`http://localhost/api/stage-meta/${lesson.stageId}`, {
      headers: { cookie: `${SAAS_SESSION_COOKIE}=${teacherToken}` },
    }),
    { params: Promise.resolve({ stageId: lesson.stageId }) },
  );
  expect(await meta.json()).toMatchObject({ isOwner: false });
});

it('treats simultaneous school applications as one pending application', async () => {
  const admin = await (
    await registerFromBody({
      email: 'race-admin@school.test',
      password: 'classroom-pass',
      name: '校长',
      kind: 'teacher',
      action: 'create',
      orgName: '申请学校',
    })
  ).json();
  await registerFromBody({
    email: 'race-student@school.test',
    password: 'classroom-pass',
    name: '同学',
    kind: 'student',
  });
  const responses = await Promise.all(
    [1, 2].map(() => schoolActionFromBody({ action: 'apply', joinCode: admin.joinCode })),
  );
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const desk = await (await currentSession()).json();
  expect(desk.pending).toHaveLength(1);
  expect(desk.orgs).toHaveLength(0);
});

it('serializes duplicate approval clicks without a database error or duplicate membership', async () => {
  const admin = await (
    await registerFromBody({
      email: 'approval-admin@school.test',
      password: 'classroom-pass',
      name: '校长',
      kind: 'teacher',
      action: 'create',
      orgName: '审批学校',
    })
  ).json();
  const adminToken = state.token;
  await registerFromBody({
    email: 'approval-student@school.test',
    password: 'classroom-pass',
    name: '同学',
    kind: 'student',
    joinCode: admin.joinCode,
  });
  state.token = adminToken;
  const desk = await (await currentSession()).json();
  const responses = await Promise.all(
    [1, 2].map(() =>
      schoolActionFromBody({
        action: 'decide',
        requestId: desk.requests[0].id,
        decision: 'approve',
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  expect(
    (await (await currentSession()).json()).members.filter(
      (member: { role: string }) => member.role === 'student',
    ),
  ).toHaveLength(1);
});

it('credits a trial wallet once per recharge request and makes that balance available to generation', async () => {
  vi.stubEnv('OPENMAIC_SAAS_SIGNUP_CREDIT_MILLI_YUAN', '0');
  vi.stubEnv('OPENMAIC_TRIAL_TOPUP_ENABLED', 'true');
  const admin = await (
    await registerFromBody({
      email: 'wallet-admin@school.test',
      password: 'classroom-pass',
      name: '管理员',
      kind: 'teacher',
      action: 'create',
      orgName: '钱包学校',
    })
  ).json();
  await schoolActionFromBody({ action: 'class', name: '一年级', adminUserId: admin.userId });
  const payload = { action: 'top-up', amountMilliYuan: 20_000, requestId: 'trial-recharge-1' };
  const responses = await Promise.all([1, 2].map(() => schoolActionFromBody(payload)));
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const wallet = await (await schoolActionFromBody({ action: 'wallet' })).json();
  expect(wallet).toMatchObject({ balanceMilliYuan: 20_000, trialTopupEnabled: true });
  expect(wallet.entries).toHaveLength(1);
  expect(
    await guardSaasAction(
      new Headers({ cookie: `${SAAS_SESSION_COOKIE}=${state.token}` }),
      'generate',
      20_000,
    ),
  ).toEqual({ orgId: admin.orgId });
  expect((await schoolActionFromBody({ ...payload, amountMilliYuan: 30_000 })).status).toBe(409);
  expect(
    (await schoolActionFromBody({ ...payload, requestId: 'negative-amount', amountMilliYuan: -1 }))
      .status,
  ).toBe(400);
  vi.stubEnv('OPENMAIC_TRIAL_TOPUP_ENABLED', 'false');
  expect((await schoolActionFromBody({ ...payload, requestId: 'disabled-recharge' })).status).toBe(
    400,
  );
  await registerFromBody({
    email: 'wallet-student@school.test',
    password: 'classroom-pass',
    name: '同学',
    kind: 'student',
    joinCode: admin.joinCode,
  });
  expect((await schoolActionFromBody({ action: 'wallet' })).status).toBe(400);
  expect((await schoolActionFromBody(payload)).status).toBe(400);
});

it('blocks student writes and unpublished reads through every legacy stage route', async () => {
  const admin = await (
    await registerFromBody({
      email: 'legacy-admin@school.test',
      password: 'classroom-pass',
      name: '校长',
      kind: 'teacher',
      action: 'create',
      orgName: '旧入口学校',
    })
  ).json();
  const token = state.token;
  const desk = await (
    await schoolActionFromBody({ action: 'class', name: '班级', adminUserId: admin.userId })
  ).json();
  const lesson = await (
    await schoolActionFromBody({
      action: 'prepare-lesson',
      classGroupId: desk.classes[0].id,
      title: '课程',
    })
  ).json();
  await database.query('INSERT INTO document_stages (id, name, owner_id) VALUES ($1, $2, $3)', [
    lesson.stageId,
    '课程',
    admin.orgId,
  ]);
  await database.query('INSERT INTO stage_meta (stage_id, owner_id) VALUES ($1, $2)', [
    lesson.stageId,
    admin.orgId,
  ]);
  await registerFromBody({
    email: 'legacy-student@school.test',
    password: 'classroom-pass',
    name: '学生',
    kind: 'student',
    joinCode: admin.joinCode,
  });
  const studentToken = state.token;
  state.token = token;
  const pending = await (await currentSession()).json();
  await schoolActionFromBody({
    action: 'decide',
    requestId: pending.requests[0].id,
    decision: 'approve',
  });
  state.token = studentToken;
  await currentSession();
  const handler = vi.fn(async () => new Response('leaked'));
  for (const [pathname, method] of [
    [`/api/stages/${lesson.stageId}`, 'GET'],
    [`/api/stages/${lesson.stageId}`, 'PUT'],
    [`/api/stages/${lesson.stageId}`, 'DELETE'],
    [`/api/stages/${lesson.stageId}/unpublish`, 'POST'],
    [`/api/stages/${lesson.stageId}/generation-complete`, 'POST'],
    ['/api/stages', 'POST'],
    ['/api/agent/sessions', 'POST'],
  ]) {
    const response = await withRequestOwnerId(
      new NextRequest(`http://localhost${pathname}`, {
        method,
        headers: { cookie: `${SAAS_SESSION_COOKIE}=${studentToken}` },
      }),
      handler,
    );
    expect(response.status, pathname).toBe(403);
  }
  expect(handler).not.toHaveBeenCalled();
});

it('retires anonymous filesystem classroom and media endpoints in school mode', async () => {
  const request = new NextRequest('http://localhost/api/classroom?id=stage-test');
  expect((await legacyClassroom(request)).status).toBe(404);
  expect(
    (
      await legacySaveClassroom(
        new NextRequest('http://localhost/api/classroom', { method: 'POST', body: '{}' }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await legacyMedia(
        new NextRequest('http://localhost/api/classroom-media/stage-test/audio/test.mp3'),
        { params: Promise.resolve({ classroomId: 'stage-test', path: ['audio', 'test.mp3'] }) },
      )
    ).status,
  ).toBe(404);
});

it('migrates existing email accounts and schools without changing credentials or money', async () => {
  const previous = await registerOrgAdmin(
    state.db!,
    { email: 'previous@school.test', password: 'classroom-pass', orgName: '已有学校' },
    1234,
  );
  await ensureSaasSchema(state.db!);
  const login = await loginFromBody({ email: 'previous@school.test', password: 'classroom-pass' });
  expect(login.status).toBe(200);
  expect(await login.json()).toMatchObject({
    orgId: previous.principal.orgId,
    role: 'org_admin',
    kind: 'teacher',
    balanceMilliYuan: 1234,
    joinCode: expect.any(String),
  });
  const first = await (await currentSession()).json();
  await ensureSaasSchema(state.db!);
  expect((await (await currentSession()).json()).joinCode).toBe(first.joinCode);
});

it('does not process an application from a different current school', async () => {
  const admin = await (
    await registerFromBody({
      email: 'scope-admin@school.test',
      password: 'classroom-pass',
      name: '校长',
      kind: 'teacher',
      action: 'create',
      orgName: '当前学校甲',
    })
  ).json();
  const token = state.token;
  const other = await (
    await schoolActionFromBody({ action: 'create', orgName: '当前学校乙' })
  ).json();
  await registerFromBody({
    email: 'scope-student@school.test',
    password: 'classroom-pass',
    name: '学生',
    kind: 'student',
    joinCode: admin.joinCode,
  });
  state.token = token;
  const pending = await (
    await schoolActionFromBody({ action: 'switch', orgId: admin.orgId })
  ).json();
  await schoolActionFromBody({ action: 'switch', orgId: other.orgId });
  expect(
    (
      await schoolActionFromBody({
        action: 'decide',
        requestId: pending.requests[0].id,
        decision: 'approve',
      })
    ).status,
  ).toBe(400);
  expect(
    (await (await schoolActionFromBody({ action: 'switch', orgId: admin.orgId })).json()).requests,
  ).toHaveLength(1);
});
