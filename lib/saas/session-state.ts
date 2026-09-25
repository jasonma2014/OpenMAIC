import type { SaasRole } from '@/lib/saas/roles';

export interface SaasAccount {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: SaasRole;
  balanceMilliYuan: number;
}

export type SaasSession =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; account: SaasAccount };

const ROLES: readonly SaasRole[] = ['org_admin', 'teacher', 'student'];

export function parseSaasSession(status: number, body: unknown): SaasSession {
  if (status === 404) return { status: 'off' };
  if (status !== 200 || !body || typeof body !== 'object') return { status: 'signed-out' };
  const record = body as Record<string, unknown>;
  const role = record.role;
  const balance = record.balanceMilliYuan;
  if (
    typeof record.userId !== 'string' ||
    typeof record.email !== 'string' ||
    typeof record.orgId !== 'string' ||
    typeof record.orgName !== 'string' ||
    typeof role !== 'string' ||
    !ROLES.includes(role as SaasRole) ||
    typeof balance !== 'number' ||
    !Number.isFinite(balance)
  ) {
    return { status: 'signed-out' };
  }
  return {
    status: 'signed-in',
    account: {
      userId: record.userId,
      email: record.email,
      orgId: record.orgId,
      orgName: record.orgName,
      role: role as SaasRole,
      balanceMilliYuan: balance,
    },
  };
}

export function formatBalanceYuan(milliYuan: number): string {
  return (milliYuan / 1000).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}
