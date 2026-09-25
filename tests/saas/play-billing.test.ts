import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as gradeQuiz } from '@/app/api/quiz-grade/route';
import { enterSaasOrg, currentSaasOrgId } from '@/lib/saas/context';
import { createSSEResponse } from '@/lib/pbl/v2/api/sse';

describe('class-time billing', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the organization on a class stream after the request moves on', async () => {
    enterSaasOrg('org-class');
    const response = createSSEResponse(
      (async function* () {
        yield { type: 'token' as const, delta: currentSaasOrgId() ?? 'missing' };
      })(),
    );
    enterSaasOrg('org-later');
    const text = await response.text();
    expect(text).toContain('org-class');
    expect(text).not.toContain('org-later');
  });

  it('refuses quiz grading without a session while SaaS mode is on', async () => {
    vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
    const response = await gradeQuiz(
      new NextRequest('http://localhost/api/quiz-grade', {
        method: 'POST',
        body: JSON.stringify({ question: '2+2', userAnswer: '4', points: 1 }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
