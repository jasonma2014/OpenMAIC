import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isSaasEnabled } from '@/lib/config/feature-flags';
import {
  SaasConflictError,
  SaasInputError,
  deleteSession,
  principalForToken,
  signupCreditMilliYuan,
  type SaasPrincipal,
} from '@/lib/saas/accounts';
import { loadDesk, startAccountSession, switchAccountOrg } from '@/lib/saas/desk';
import {
  SchoolError,
  applyToSchool,
  confirmCourseEntry,
  createClassGroup,
  createSchool,
  decideJoinRequest,
  loginWithEmail,
  registerEmailAccount,
  removeMember,
} from '@/lib/saas/school';
import { schoolRepository } from '@/lib/saas/school-store';
import { prepareLesson } from '@/lib/saas/lessons';
import { readWallet, rechargeTrialWallet } from '@/lib/saas/wallet';
import { SAAS_SESSION_COOKIE, sessionCookieOptions } from '@/lib/saas/cookie';
import { openSaasDb } from '@/lib/saas/db';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export function saasDisabled(): NextResponse {
  return apiError('INVALID_REQUEST', 404, 'Not found');
}

export function principalBody(principal: SaasPrincipal): Record<string, unknown> {
  return {
    userId: principal.userId,
    email: principal.email,
    orgId: principal.orgId,
    orgName: principal.orgName,
    role: principal.role,
    balanceMilliYuan: principal.balanceMilliYuan,
  };
}

export async function readSessionToken(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get(SAAS_SESSION_COOKIE)?.value ?? '';
}

export async function writeSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SAAS_SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SAAS_SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
}

export function saasErrorResponse(error: unknown): NextResponse {
  if (error instanceof SaasInputError) return apiError('INVALID_REQUEST', 400, error.message);
  if (error instanceof SaasConflictError) return apiError('INVALID_REQUEST', 409, error.message);
  if (error instanceof SchoolError)
    return apiError('INVALID_REQUEST', 400, schoolMessage(error.reason));
  return apiError('INTERNAL_ERROR', 503, 'SaaS database is unavailable');
}

function schoolMessage(reason: SchoolError['reason']): string {
  if (reason === 'email-taken') return '这个邮箱已经注册过';
  if (reason === 'already-member') return '你已经在这所学校里';
  if (reason === 'forbidden') return '没有权限做这件事';
  if (reason === 'invalid-name') return '请填写姓名';
  return '没有找到这所学校或这节课';
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

export async function registerFromBody(body: unknown): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  const record = asRecord(body);
  try {
    const db = await openSaasDb();
    const { token, user } = await db.transaction(async (tx) => {
      const schools = schoolRepository(tx);
      const user = await registerEmailAccount({
        email: record.email,
        password: record.password,
        name: record.name,
        kind: record.kind,
        schools,
      });
      let orgId: string | null = null;
      if (record.kind === 'teacher' && record.action === 'create') {
        const school = await createSchool({
          userId: user.id,
          orgName: record.orgName,
          now: Date.now(),
          schools,
          signupCredit: signupCreditMilliYuan(process.env.OPENMAIC_SAAS_SIGNUP_CREDIT_MILLI_YUAN),
        });
        orgId = school.id;
      } else if (typeof record.joinCode === 'string' && record.joinCode.trim() !== '') {
        await applyToSchool({
          userId: user.id,
          joinCode: record.joinCode,
          now: Date.now(),
          schools,
        });
      }
      return { token: await startAccountSession(tx, user.id, orgId), user };
    });
    await writeSessionCookie(token);
    const desk = await loadDesk(db, token);
    return apiSuccess(desk ? { ...desk } : { userId: user.id }, 201);
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function loginFromBody(body: unknown): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  const record = asRecord(body);
  try {
    const db = await openSaasDb();
    const schools = schoolRepository(db);
    const user = await loginWithEmail({
      email: record.email,
      password: record.password,
      schools,
    });
    if (!user) return apiError('INVALID_CREDENTIALS', 401, '邮箱或密码不正确');
    const token = await startAccountSession(db, user.id, null);
    await writeSessionCookie(token);
    const desk = await loadDesk(db, token);
    return apiSuccess(desk ? { ...desk } : { userId: user.id });
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function logoutCurrentSession(): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  try {
    const token = await readSessionToken();
    if (token) await deleteSession(await openSaasDb(), token);
    await clearSessionCookie();
    return apiSuccess({ signedOut: true });
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function currentSession(): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  try {
    const token = await readSessionToken();
    const db = await openSaasDb();
    const desk = token ? await loadDesk(db, token) : null;
    if (desk) return apiSuccess({ ...desk });
    const principal = token ? await principalForToken(db, token) : undefined;
    if (!principal) return apiError('UNAUTHENTICATED', 401, 'Sign in required');
    return apiSuccess(principalBody(principal));
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function schoolActionFromBody(body: unknown): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  const record = asRecord(body);
  try {
    const token = await readSessionToken();
    const database = await openSaasDb();
    return await database.transaction(async (db) => {
      const desk = token ? await loadDesk(db, token) : null;
      if (!desk) return apiError('UNAUTHENTICATED', 401, 'Sign in required');
      const schools = schoolRepository(db);
      const action = record.action;
      if (action === 'wallet' || action === 'top-up') {
        if (!desk.orgId) throw new SchoolError('forbidden');
        return apiSuccess(
          action === 'wallet'
            ? await readWallet(db, desk.orgId, desk.userId)
            : await rechargeTrialWallet(db, {
                orgId: desk.orgId,
                userId: desk.userId,
                amountMilliYuan: record.amountMilliYuan,
                requestId: record.requestId,
              }),
        );
      } else if (action === 'create') {
        const school = await createSchool({
          userId: desk.userId,
          orgName: record.orgName,
          now: Date.now(),
          schools,
          signupCredit: signupCreditMilliYuan(process.env.OPENMAIC_SAAS_SIGNUP_CREDIT_MILLI_YUAN),
        });
        await switchAccountOrg(db, token, school.id);
      } else if (action === 'apply') {
        await applyToSchool({
          userId: desk.userId,
          joinCode: record.joinCode,
          now: Date.now(),
          schools,
        });
      } else if (action === 'decide') {
        if (record.decision !== 'approve' && record.decision !== 'reject') {
          return apiError('INVALID_REQUEST', 400, '请选择通过或拒绝');
        }
        if (typeof record.requestId !== 'string')
          return apiError('INVALID_REQUEST', 400, '缺少申请');
        const request = await schools.findRequest(record.requestId);
        if (!request || request.orgId !== desk.orgId) throw new SchoolError('forbidden');
        await decideJoinRequest({
          requestId: record.requestId,
          actorUserId: desk.userId,
          decision: record.decision,
          schools,
        });
      } else if (action === 'remove') {
        if (!desk.orgId || typeof record.userId !== 'string') {
          return apiError('INVALID_REQUEST', 400, '缺少要移出的人');
        }
        await removeMember({
          orgId: desk.orgId,
          actorUserId: desk.userId,
          userId: record.userId,
          schools,
        });
      } else if (action === 'class') {
        if (!desk.orgId || typeof record.adminUserId !== 'string') {
          return apiError('INVALID_REQUEST', 400, '请选择班级管理员');
        }
        await createClassGroup({
          actorUserId: desk.userId,
          orgId: desk.orgId,
          name: record.name,
          adminUserId: record.adminUserId,
          schools,
        });
      } else if (action === 'prepare-lesson') {
        if (!desk.orgId) throw new SchoolError('forbidden');
        return apiSuccess(
          await prepareLesson(db, {
            userId: desk.userId,
            orgId: desk.orgId,
            classGroupId: record.classGroupId,
            title: record.title,
            grade: record.grade,
            subject: record.subject,
          }),
          201,
        );
      } else if (action === 'class-admin') {
        if (
          desk.role !== 'org_admin' ||
          !desk.orgId ||
          typeof record.classGroupId !== 'string' ||
          typeof record.adminUserId !== 'string'
        ) {
          throw new SchoolError('forbidden');
        }
        const updated = await db.query<{ id: string }>(
          `UPDATE saas_class_groups SET admin_user_id = $3
         WHERE id = $1 AND org_id = $2
           AND EXISTS (SELECT 1 FROM saas_memberships WHERE org_id = $2 AND user_id = $3 AND role IN ('org_admin', 'teacher'))
         RETURNING id`,
          [record.classGroupId, desk.orgId, record.adminUserId],
        );
        if (!updated.rows.length) throw new SchoolError('forbidden');
      } else if (action === 'course-entry') {
        const entry = await confirmCourseEntry({
          userId: desk.userId,
          currentOrgId: desk.orgId,
          code: record.code,
          schools,
        });
        return apiSuccess(entry);
      } else if (action === 'switch') {
        if (typeof record.orgId !== 'string') return apiError('INVALID_REQUEST', 400, '请选择学校');
        const switched = await switchAccountOrg(db, token, record.orgId);
        if (!switched) return apiError('INVALID_REQUEST', 400, '你还不是这所学校的成员');
      } else {
        return apiError('INVALID_REQUEST', 400, '无法识别的操作');
      }
      const next = await loadDesk(db, token);
      return apiSuccess(next ? { ...next } : { userId: desk.userId });
    });
  } catch (error) {
    return saasErrorResponse(error);
  }
}
