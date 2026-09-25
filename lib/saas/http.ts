import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isSaasEnabled } from '@/lib/config/feature-flags';
import {
  SaasConflictError,
  SaasInputError,
  deleteSession,
  loginWithPassword,
  principalForToken,
  registerOrgAdmin,
  signupCreditMilliYuan,
  type SaasPrincipal,
} from '@/lib/saas/accounts';
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
  return apiError('INTERNAL_ERROR', 503, 'SaaS database is unavailable');
}

export async function registerFromBody(body: unknown): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  const record = typeof body === 'object' && body !== null ? body : {};
  try {
    const db = await openSaasDb();
    const created = await registerOrgAdmin(
      db,
      record as { email: unknown; password: unknown; orgName: unknown },
      signupCreditMilliYuan(process.env.OPENMAIC_SAAS_SIGNUP_CREDIT_MILLI_YUAN),
    );
    await writeSessionCookie(created.token);
    return apiSuccess(principalBody(created.principal), 201);
  } catch (error) {
    return saasErrorResponse(error);
  }
}

export async function loginFromBody(body: unknown): Promise<NextResponse> {
  if (!isSaasEnabled()) return saasDisabled();
  const record = typeof body === 'object' && body !== null ? body : {};
  try {
    const db = await openSaasDb();
    const signedIn = await loginWithPassword(db, record as { email: unknown; password: unknown });
    if (!signedIn) return apiError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect');
    await writeSessionCookie(signedIn.token);
    return apiSuccess(principalBody(signedIn.principal));
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
    const principal = token ? await principalForToken(await openSaasDb(), token) : undefined;
    if (!principal) return apiError('UNAUTHENTICATED', 401, 'Sign in required');
    return apiSuccess(principalBody(principal));
  } catch (error) {
    return saasErrorResponse(error);
  }
}
