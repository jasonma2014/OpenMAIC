import { randomUUID } from 'node:crypto';

import { assertOrgName, assertPassword, normalizeEmail } from '@/lib/saas/accounts';
import { newClassCode } from '@/lib/saas/classes';
import { hashPassword, verifyPassword } from '@/lib/saas/password';
import type { SaasRole } from '@/lib/saas/roles';

export type PersonKind = 'teacher' | 'student';
export type JoinRole = 'teacher' | 'student';

export class SchoolError extends Error {
  constructor(
    readonly reason: 'email-taken' | 'forbidden' | 'not-found' | 'already-member' | 'invalid-name',
  ) {
    super(reason);
    this.name = 'SchoolError';
  }
}

export interface SchoolUser {
  id: string;
  email: string;
  name: string;
  kind: PersonKind;
  passwordHash: string;
}

export interface SchoolOrg {
  id: string;
  name: string;
  joinCode: string;
}

export interface Membership {
  orgId: string;
  userId: string;
  role: SaasRole;
}

export interface JoinRequest {
  id: string;
  orgId: string;
  userId: string;
  role: JoinRole;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export interface ClassGroup {
  id: string;
  orgId: string;
  name: string;
  adminUserId: string;
}

export interface CoursePass {
  code: string;
  orgId: string;
  classGroupId: string;
  stageId: string;
  title: string;
}

export interface SchoolRepository {
  findUserByEmail(email: string): Promise<SchoolUser | null>;
  findUser(id: string): Promise<SchoolUser | null>;
  insertUser(user: SchoolUser): Promise<void>;
  insertOrg(org: SchoolOrg, adminUserId: string, credit: number): Promise<void>;
  findOrgByJoinCode(code: string): Promise<SchoolOrg | null>;
  findOrg(orgId: string): Promise<SchoolOrg | null>;
  findMembership(orgId: string, userId: string): Promise<Membership | null>;
  insertMembership(membership: Membership): Promise<void>;
  deleteMembership(orgId: string, userId: string): Promise<void>;
  pendingRequest(orgId: string, userId: string): Promise<JoinRequest | null>;
  insertRequest(request: JoinRequest): Promise<void>;
  findRequest(id: string): Promise<JoinRequest | null>;
  setRequestStatus(id: string, status: 'approved' | 'rejected'): Promise<void>;
  insertClass(group: ClassGroup): Promise<void>;
  findClass(id: string): Promise<ClassGroup | null>;
  insertCourse(course: CoursePass): Promise<void>;
  findCourseByCode(code: string): Promise<CoursePass | null>;
}

function assertPersonName(value: unknown): string {
  if (typeof value !== 'string') throw new SchoolError('invalid-name');
  const name = value.trim();
  if (name.length < 1 || name.length > 40) throw new SchoolError('invalid-name');
  return name;
}

function assertKind(value: unknown): PersonKind {
  if (value !== 'teacher' && value !== 'student') throw new SchoolError('forbidden');
  return value;
}

export async function registerEmailAccount(input: {
  email: unknown;
  password: unknown;
  name: unknown;
  kind: unknown;
  schools: SchoolRepository;
  createId?: () => string;
}): Promise<SchoolUser> {
  const email = normalizeEmail(input.email);
  const password = assertPassword(input.password);
  const name = assertPersonName(input.name);
  const kind = assertKind(input.kind);
  if (await input.schools.findUserByEmail(email)) throw new SchoolError('email-taken');
  const user: SchoolUser = {
    id: (input.createId ?? randomUUID)(),
    email,
    name,
    kind,
    passwordHash: await hashPassword(password),
  };
  try {
    await input.schools.insertUser(user);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new SchoolError('email-taken');
    }
    throw error;
  }
  return user;
}

export async function loginWithEmail(input: {
  email: unknown;
  password: unknown;
  schools: SchoolRepository;
}): Promise<SchoolUser | null> {
  const email = normalizeEmail(input.email);
  const password = assertPassword(input.password);
  const user = await input.schools.findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  return user;
}

export async function createSchool(input: {
  userId: string;
  orgName: unknown;
  now: number;
  schools: SchoolRepository;
  createId?: () => string;
  createCode?: () => string;
  signupCredit: number;
}): Promise<SchoolOrg> {
  const user = await input.schools.findUser(input.userId);
  if (!user || user.kind !== 'teacher') throw new SchoolError('forbidden');
  const org: SchoolOrg = {
    id: (input.createId ?? randomUUID)(),
    name: assertOrgName(input.orgName),
    joinCode: (input.createCode ?? newClassCode)(),
  };
  await input.schools.insertOrg(org, user.id, input.signupCredit);
  return org;
}

export async function applyToSchool(input: {
  userId: string;
  joinCode: unknown;
  now: number;
  schools: SchoolRepository;
  createId?: () => string;
}): Promise<JoinRequest> {
  if (typeof input.joinCode !== 'string') throw new SchoolError('not-found');
  const code = input.joinCode.trim().toUpperCase();
  const org = await input.schools.findOrgByJoinCode(code);
  const user = await input.schools.findUser(input.userId);
  if (!org || !user) throw new SchoolError('not-found');
  if (await input.schools.findMembership(org.id, user.id)) throw new SchoolError('already-member');
  const pending = await input.schools.pendingRequest(org.id, user.id);
  if (pending) return pending;
  const request: JoinRequest = {
    id: (input.createId ?? randomUUID)(),
    orgId: org.id,
    userId: user.id,
    role: user.kind,
    status: 'pending',
    createdAt: input.now,
  };
  await input.schools.insertRequest(request);
  return (await input.schools.pendingRequest(org.id, user.id)) ?? request;
}

export async function decideJoinRequest(input: {
  requestId: string;
  actorUserId: string;
  decision: 'approve' | 'reject';
  schools: SchoolRepository;
}): Promise<void> {
  const request = await input.schools.findRequest(input.requestId);
  if (!request || request.status !== 'pending') throw new SchoolError('not-found');
  const actor = await input.schools.findMembership(request.orgId, input.actorUserId);
  if (!actor || actor.role !== 'org_admin') throw new SchoolError('forbidden');
  if (input.decision === 'reject') {
    await input.schools.setRequestStatus(request.id, 'rejected');
    return;
  }
  await input.schools.setRequestStatus(request.id, 'approved');
  await input.schools.insertMembership({
    orgId: request.orgId,
    userId: request.userId,
    role: request.role,
  });
}

export async function removeMember(input: {
  orgId: string;
  actorUserId: string;
  userId: string;
  schools: SchoolRepository;
}): Promise<void> {
  const actor = await input.schools.findMembership(input.orgId, input.actorUserId);
  if (!actor || actor.role !== 'org_admin') throw new SchoolError('forbidden');
  const target = await input.schools.findMembership(input.orgId, input.userId);
  if (!target) throw new SchoolError('not-found');
  if (target.role === 'org_admin') throw new SchoolError('forbidden');
  await input.schools.deleteMembership(input.orgId, input.userId);
}

export async function createClassGroup(input: {
  actorUserId: string;
  orgId: string;
  name: unknown;
  adminUserId: string;
  schools: SchoolRepository;
  createId?: () => string;
}): Promise<ClassGroup> {
  const actor = await input.schools.findMembership(input.orgId, input.actorUserId);
  if (!actor || actor.role !== 'org_admin') throw new SchoolError('forbidden');
  const admin = await input.schools.findMembership(input.orgId, input.adminUserId);
  if (!admin || admin.role === 'student') throw new SchoolError('forbidden');
  const name = assertPersonName(input.name);
  const group: ClassGroup = {
    id: (input.createId ?? randomUUID)(),
    orgId: input.orgId,
    name,
    adminUserId: input.adminUserId,
  };
  await input.schools.insertClass(group);
  return group;
}

export async function issueCourseCode(input: {
  actorUserId: string;
  classGroupId: string;
  stageId: string;
  title: unknown;
  schools: SchoolRepository;
  createCode?: () => string;
}): Promise<CoursePass> {
  const group = await input.schools.findClass(input.classGroupId);
  if (!group) throw new SchoolError('not-found');
  const actor = await input.schools.findMembership(group.orgId, input.actorUserId);
  const isAdmin = actor?.role === 'org_admin';
  const isClassAdmin = group.adminUserId === input.actorUserId && actor?.role === 'teacher';
  if (!isAdmin && !isClassAdmin) throw new SchoolError('forbidden');
  const course: CoursePass = {
    code: (input.createCode ?? newClassCode)(),
    orgId: group.orgId,
    classGroupId: group.id,
    stageId: input.stageId,
    title: assertPersonName(input.title),
  };
  await input.schools.insertCourse(course);
  return course;
}

export async function confirmCourseEntry(input: {
  userId: string;
  currentOrgId: string | null;
  code: unknown;
  schools: SchoolRepository;
}): Promise<
  | { status: 'join-required'; orgName: string }
  | { status: 'switch-school'; orgId: string; orgName: string }
  | { status: 'confirm'; orgName: string; title: string; stageId: string }
> {
  if (typeof input.code !== 'string') throw new SchoolError('not-found');
  const course = await input.schools.findCourseByCode(input.code.trim().toUpperCase());
  if (!course) throw new SchoolError('not-found');
  const org = await input.schools.findOrg(course.orgId);
  if (!org) throw new SchoolError('not-found');
  const membership = await input.schools.findMembership(course.orgId, input.userId);
  if (!membership) return { status: 'join-required', orgName: org.name };
  if (input.currentOrgId !== course.orgId) {
    return { status: 'switch-school', orgId: course.orgId, orgName: org.name };
  }
  return { status: 'confirm', orgName: org.name, title: course.title, stageId: course.stageId };
}
