import { describe, expect, it } from 'vitest';

import {
  applyToSchool,
  confirmCourseEntry,
  createClassGroup,
  createSchool,
  decideJoinRequest,
  issueCourseCode,
  loginWithEmail,
  registerEmailAccount,
  removeMember,
  type JoinRequest,
  type SchoolRepository,
  type SchoolUser,
} from '@/lib/saas/school';

const NOW = 1_700_000_000_000;

describe('email registration and school membership', () => {
  it('registers a teacher by email and lets that teacher create a school', async () => {
    const schools = memorySchool();
    const teacher = await registerEmailAccount({
      email: ' Teacher@School.com ',
      password: 'classroom-pass',
      name: ' 王老师 ',
      kind: 'teacher',
      schools,
      createId: () => 'user-teacher',
    });
    expect(teacher).toMatchObject({ email: 'teacher@school.com', name: '王老师', kind: 'teacher' });
    expect(teacher.passwordHash).not.toContain('classroom-pass');

    const school = await createSchool({
      userId: teacher.id,
      orgName: '第一中学',
      now: NOW,
      schools,
      createId: () => 'org-1',
      createCode: () => 'JOINCODE',
      signupCredit: 0,
    });
    expect(school.joinCode).toBe('JOINCODE');
    expect(await schools.findMembership('org-1', teacher.id)).toMatchObject({ role: 'org_admin' });
    expect(
      await loginWithEmail({ email: 'teacher@school.com', password: 'classroom-pass', schools }),
    ).toMatchObject({ id: 'user-teacher' });
    expect(
      await loginWithEmail({ email: 'teacher@school.com', password: 'wrong-pass', schools }),
    ).toBeNull();
  });

  it('keeps one email on one identity', async () => {
    const schools = memorySchool();
    await registerEmailAccount({
      email: 'teacher@school.com',
      password: 'classroom-pass',
      name: '王老师',
      kind: 'teacher',
      schools,
      createId: () => 'user-teacher',
    });
    await expect(
      registerEmailAccount({
        email: 'teacher@school.com',
        password: 'classroom-pass',
        name: '王同学',
        kind: 'student',
        schools,
      }),
    ).rejects.toMatchObject({ reason: 'email-taken' });
  });

  it('lets a student apply with the school code and waits for approval', async () => {
    const schools = memorySchool();
    const teacher = user('user-teacher', 'teacher@school.com', '王老师', 'teacher');
    const student = user('user-student', 'student@school.com', '李同学', 'student');
    schools.users.push(teacher, student);
    await createSchool({
      userId: teacher.id,
      orgName: '第一中学',
      now: NOW,
      schools,
      createId: () => 'org-1',
      createCode: () => 'JOINCODE',
      signupCredit: 0,
    });

    const first = await applyToSchool({
      userId: student.id,
      joinCode: 'joincode',
      now: NOW,
      schools,
      createId: () => 'req-1',
    });
    const second = await applyToSchool({
      userId: student.id,
      joinCode: 'JOINCODE',
      now: NOW + 1,
      schools,
      createId: () => 'req-2',
    });
    expect(second.id).toBe(first.id);
    expect(await schools.findMembership('org-1', student.id)).toBeNull();

    await decideJoinRequest({
      requestId: first.id,
      actorUserId: teacher.id,
      decision: 'approve',
      schools,
    });
    expect(await schools.findMembership('org-1', student.id)).toMatchObject({ role: 'student' });
  });

  it('rejects without membership and allows a new application after rejection or removal', async () => {
    const schools = memorySchool();
    const teacher = user('user-teacher', 'teacher@school.com', '王老师', 'teacher');
    const student = user('user-student', 'student@school.com', '李同学', 'student');
    schools.users.push(teacher, student);
    await createSchool({
      userId: teacher.id,
      orgName: '第一中学',
      now: NOW,
      schools,
      createId: () => 'org-1',
      createCode: () => 'JOINCODE',
      signupCredit: 0,
    });
    const pending = await applyToSchool({
      userId: student.id,
      joinCode: 'JOINCODE',
      now: NOW,
      schools,
      createId: () => 'req-1',
    });
    await decideJoinRequest({
      requestId: pending.id,
      actorUserId: teacher.id,
      decision: 'reject',
      schools,
    });
    expect(await schools.findMembership('org-1', student.id)).toBeNull();

    const again = await applyToSchool({
      userId: student.id,
      joinCode: 'JOINCODE',
      now: NOW + 2,
      schools,
      createId: () => 'req-2',
    });
    expect(again.id).toBe('req-2');
    await decideJoinRequest({
      requestId: again.id,
      actorUserId: teacher.id,
      decision: 'approve',
      schools,
    });
    await removeMember({ orgId: 'org-1', actorUserId: teacher.id, userId: student.id, schools });
    expect(await schools.findMembership('org-1', student.id)).toBeNull();
    const afterRemoval = await applyToSchool({
      userId: student.id,
      joinCode: 'JOINCODE',
      now: NOW + 3,
      schools,
      createId: () => 'req-3',
    });
    expect(afterRemoval.status).toBe('pending');
  });

  it('refuses a class admin deciding an application', async () => {
    const schools = memorySchool();
    const admin = user('admin', 'admin@school.com', '王老师', 'teacher');
    const classAdmin = user('class-admin', 'class-admin@school.com', '赵老师', 'teacher');
    const student = user('student', 'student@school.com', '李同学', 'student');
    schools.users.push(admin, classAdmin, student);
    await createSchool({
      userId: admin.id,
      orgName: '第一中学',
      now: NOW,
      schools,
      createId: () => 'org-1',
      createCode: () => 'JOINCODE',
      signupCredit: 0,
    });
    await applyToSchool({
      userId: classAdmin.id,
      joinCode: 'JOINCODE',
      now: NOW,
      schools,
      createId: () => 'req-teacher',
    });
    await decideJoinRequest({
      requestId: 'req-teacher',
      actorUserId: admin.id,
      decision: 'approve',
      schools,
    });
    await createClassGroup({
      actorUserId: admin.id,
      orgId: 'org-1',
      name: '七年级',
      adminUserId: classAdmin.id,
      schools,
      createId: () => 'class-1',
    });
    const studentRequest = await applyToSchool({
      userId: student.id,
      joinCode: 'JOINCODE',
      now: NOW,
      schools,
      createId: () => 'req-student',
    });
    await expect(
      decideJoinRequest({
        requestId: studentRequest.id,
        actorUserId: classAdmin.id,
        decision: 'approve',
        schools,
      }),
    ).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('issues a course code inside a class and does not join the school', async () => {
    const schools = memorySchool();
    const admin = user('admin', 'admin@school.com', '王老师', 'teacher');
    const student = user('student', 'student@school.com', '李同学', 'student');
    const outsider = user('outsider', 'outsider@school.com', '外来同学', 'student');
    schools.users.push(admin, student, outsider);
    await createSchool({
      userId: admin.id,
      orgName: '第一中学',
      now: NOW,
      schools,
      createId: () => 'org-1',
      createCode: () => 'JOINCODE',
      signupCredit: 0,
    });
    await applyToSchool({
      userId: student.id,
      joinCode: 'JOINCODE',
      now: NOW,
      schools,
      createId: () => 'req-student',
    });
    await decideJoinRequest({
      requestId: 'req-student',
      actorUserId: admin.id,
      decision: 'approve',
      schools,
    });
    await createClassGroup({
      actorUserId: admin.id,
      orgId: 'org-1',
      name: '七年级',
      adminUserId: admin.id,
      schools,
      createId: () => 'class-1',
    });
    const issued = await issueCourseCode({
      actorUserId: admin.id,
      classGroupId: 'class-1',
      stageId: 'stage-1',
      title: '什么是分数',
      schools,
      createCode: () => 'COURSE01',
    });
    expect(issued.code).toBe('COURSE01');

    await schools.deleteMembership('org-1', admin.id);
    await expect(
      issueCourseCode({
        actorUserId: admin.id,
        classGroupId: 'class-1',
        stageId: 'stage-2',
        title: '移出后不能发课',
        schools,
      }),
    ).rejects.toMatchObject({ reason: 'forbidden' });

    const outsiderEntry = await confirmCourseEntry({
      userId: outsider.id,
      currentOrgId: null,
      code: 'COURSE01',
      schools,
    });
    expect(outsiderEntry).toEqual({ status: 'join-required', orgName: '第一中学' });
    expect(await schools.findMembership('org-1', outsider.id)).toBeNull();

    const entry = await confirmCourseEntry({
      userId: student.id,
      currentOrgId: 'org-1',
      code: 'COURSE01',
      schools,
    });
    expect(entry).toEqual({
      status: 'confirm',
      orgName: '第一中学',
      title: '什么是分数',
      stageId: 'stage-1',
    });
  });
});

function user(id: string, email: string, name: string, kind: SchoolUser['kind']): SchoolUser {
  return { id, email, name, kind, passwordHash: 'stored-hash' };
}

function memorySchool(): SchoolRepository & {
  users: SchoolUser[];
  requests: JoinRequest[];
} {
  const users: SchoolUser[] = [];
  const orgs: Array<{ id: string; name: string; joinCode: string }> = [];
  const memberships: Array<{
    orgId: string;
    userId: string;
    role: 'org_admin' | 'teacher' | 'student';
  }> = [];
  const requests: JoinRequest[] = [];
  const classes: Array<{ id: string; orgId: string; name: string; adminUserId: string }> = [];
  const courses: Array<{
    code: string;
    orgId: string;
    classGroupId: string;
    stageId: string;
    title: string;
  }> = [];

  return {
    users,
    requests,
    async findUserByEmail(email) {
      return users.find((item) => item.email === email) ?? null;
    },
    async insertUser(next) {
      if (users.some((item) => item.email === next.email)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      users.push(next);
    },
    async insertOrg(org, adminUserId) {
      orgs.push(org);
      memberships.push({ orgId: org.id, userId: adminUserId, role: 'org_admin' });
    },
    async findOrgByJoinCode(code) {
      return orgs.find((org) => org.joinCode === code) ?? null;
    },
    async findOrg(orgId) {
      return orgs.find((org) => org.id === orgId) ?? null;
    },
    async findMembership(orgId, userId) {
      return memberships.find((item) => item.orgId === orgId && item.userId === userId) ?? null;
    },
    async insertMembership(membership) {
      memberships.push(membership);
    },
    async deleteMembership(orgId, userId) {
      const index = memberships.findIndex((item) => item.orgId === orgId && item.userId === userId);
      if (index >= 0) memberships.splice(index, 1);
    },
    async pendingRequest(orgId, userId) {
      return (
        requests.find(
          (item) => item.orgId === orgId && item.userId === userId && item.status === 'pending',
        ) ?? null
      );
    },
    async insertRequest(request) {
      requests.push(request);
    },
    async findRequest(id) {
      return requests.find((item) => item.id === id) ?? null;
    },
    async setRequestStatus(id, status) {
      const request = requests.find((item) => item.id === id);
      if (request) request.status = status;
    },
    async findUser(id) {
      return users.find((item) => item.id === id) ?? null;
    },
    async insertClass(group) {
      classes.push(group);
    },
    async findClass(id) {
      return classes.find((item) => item.id === id) ?? null;
    },
    async insertCourse(course) {
      courses.push(course);
    },
    async findCourseByCode(code) {
      return courses.find((item) => item.code === code) ?? null;
    },
  };
}
