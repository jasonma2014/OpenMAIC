import { isSaasEnabled } from '@/lib/config/feature-flags';
import type { SaasAction } from '@/lib/saas/roles';
import { canPerform } from '@/lib/saas/roles';
import { enterSaasOrg } from '@/lib/saas/context';
import { saasPrincipalFromHeaders } from '@/lib/saas/principal';
import { apiError } from '@/lib/server/api-response';

export type SaasGate = Response | { orgId: string } | null;

/**
 * When SaaS mode is off, generation keeps today's behavior.
 * When it is on, the caller must belong to an organization that can do the
 * action and still has credit. {@link holdSaasOrg} must run in the request
 * handler itself so later usage recording still sees the organization.
 */
export async function guardSaasAction(
  headers: Headers,
  action: SaasAction,
  minimumBalanceMilliYuan = 1,
): Promise<SaasGate> {
  if (!isSaasEnabled()) return null;
  const principal = await saasPrincipalFromHeaders(headers);
  if (!principal) return apiError('UNAUTHENTICATED', 401, 'Sign in required');
  if (!canPerform(principal.role, action)) {
    return apiError('INVALID_REQUEST', 403, 'Not allowed');
  }
  if (principal.balanceMilliYuan < minimumBalanceMilliYuan) {
    return apiError('INVALID_REQUEST', 402, 'Insufficient credit');
  }
  return { orgId: principal.orgId };
}

export function holdSaasOrg(gate: SaasGate): Response | null {
  if (!gate) return null;
  if (gate instanceof Response) return gate;
  enterSaasOrg(gate.orgId);
  return null;
}
