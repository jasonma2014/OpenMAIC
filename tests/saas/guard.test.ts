import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentSaasOrgId } from '@/lib/saas/context';
import { holdSaasOrg } from '@/lib/saas/guard';
import type { SaasPrincipal } from '@/lib/saas/accounts';

const principal = vi.hoisted(() => ({
  current: undefined as SaasPrincipal | undefined,
}));

vi.mock('@/lib/saas/principal', () => ({
  saasPrincipalFromHeaders: vi.fn(async () => principal.current),
}));

function teacher(balance: number): SaasPrincipal {
  return {
    userId: 'user-1',
    email: 'teacher@school.test',
    orgId: 'org-1',
    orgName: '第一中学',
    role: 'teacher',
    balanceMilliYuan: balance,
  };
}

describe('SaaS generation guard', () => {
  beforeEach(() => {
    principal.current = undefined;
    vi.unstubAllEnvs();
  });

  it('does nothing while SaaS mode is off', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', '');
    const { guardSaasAction } = await import('@/lib/saas/guard');
    expect(await guardSaasAction(new Headers(), 'generate')).toBeNull();
  });

  it('rejects a signed-out caller, a student, and an empty wallet', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    const { guardSaasAction } = await import('@/lib/saas/guard');

    principal.current = undefined;
    expect((await guardSaasAction(new Headers(), 'generate'))?.status).toBe(401);

    principal.current = { ...teacher(1_000), role: 'student' };
    expect((await guardSaasAction(new Headers(), 'generate'))?.status).toBe(403);
    expect(holdSaasOrg(await guardSaasAction(new Headers(), 'play'))).toBeNull();

    principal.current = teacher(0);
    expect((await guardSaasAction(new Headers(), 'generate'))?.status).toBe(402);

    principal.current = teacher(500);
    expect(holdSaasOrg(await guardSaasAction(new Headers(), 'generate'))).toBeNull();
    expect(currentSaasOrgId()).toBe('org-1');

    principal.current = teacher(1_000);
    expect((await guardSaasAction(new Headers(), 'generate', 1_001))?.status).toBe(402);
    expect(await guardSaasAction(new Headers(), 'generate', 1_000)).toEqual({ orgId: 'org-1' });
  });
});

describe('generate-classroom under SaaS', () => {
  beforeEach(() => {
    vi.resetModules();
    principal.current = undefined;
    vi.unstubAllEnvs();
  });

  it('asks for sign-in before it reads the lesson request', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    const { POST } = await import('@/app/api/generate-classroom/route');
    const response = await POST(
      new Request('http://localhost/api/generate-classroom', {
        method: 'POST',
        body: JSON.stringify({ requirement: '光合作用' }),
      }) as never,
    );
    expect(response.status).toBe(401);
  });
});
