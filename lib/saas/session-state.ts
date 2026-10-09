import type { SaasRole } from '@/lib/saas/roles';

export interface SaasOrgChoice {
  orgId: string;
  orgName: string;
  role: SaasRole;
}

export interface SaasAccount {
  userId: string;
  email: string;
  orgId: string | null;
  orgName: string;
  role: SaasRole | null;
  balanceMilliYuan: number;
  phone?: string;
  name?: string;
  kind?: 'teacher' | 'student';
  lessonBrief?: {
    grade: string;
    textbook: string;
    periods: string;
    objectives: string;
    baseline: string;
  };
  orgs?: SaasOrgChoice[];
}

export type SaasSession =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; account: SaasAccount };

const ROLES: readonly SaasRole[] = ['org_admin', 'teacher', 'student'];

function readLessonBrief(value: unknown): SaasAccount['lessonBrief'] {
  if (!value || typeof value !== 'object') return undefined;
  const brief = value as Record<string, unknown>;
  if (typeof brief.grade !== 'string' || typeof brief.objectives !== 'string') return undefined;
  return {
    grade: brief.grade,
    textbook: typeof brief.textbook === 'string' ? brief.textbook : '',
    periods: typeof brief.periods === 'string' ? brief.periods : '',
    objectives: brief.objectives,
    baseline: typeof brief.baseline === 'string' ? brief.baseline : '',
  };
}

export function parseSaasSession(status: number, body: unknown): SaasSession {
  if (status === 404) return { status: 'off' };
  if (status !== 200 || !body || typeof body !== 'object') return { status: 'signed-out' };
  const record = body as Record<string, unknown>;
  const role = record.role;
  const balance = record.balanceMilliYuan;
  const orgId = record.orgId === null ? null : record.orgId;
  if (
    typeof record.userId !== 'string' ||
    (typeof record.email !== 'string' && typeof record.phone !== 'string')
  ) {
    return { status: 'signed-out' };
  }
  if (orgId === null) {
    return {
      status: 'signed-in',
      account: {
        userId: record.userId,
        email: typeof record.email === 'string' ? record.email : String(record.phone),
        orgId: null,
        orgName: '',
        role: null,
        balanceMilliYuan: typeof balance === 'number' && Number.isFinite(balance) ? balance : 0,
        ...(typeof record.phone === 'string' ? { phone: record.phone } : {}),
        ...(typeof record.name === 'string' ? { name: record.name } : {}),
        ...(record.kind === 'teacher' || record.kind === 'student' ? { kind: record.kind } : {}),
        ...(readLessonBrief(record.lessonBrief) ? { lessonBrief: readLessonBrief(record.lessonBrief) } : {}),
      },
    };
  }
  if (
    typeof orgId !== 'string' ||
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
      email: typeof record.email === 'string' ? record.email : String(record.phone),
      orgId,
      orgName: record.orgName,
      role: role as SaasRole,
      balanceMilliYuan: balance,
      ...(typeof record.phone === 'string' ? { phone: record.phone } : {}),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(record.kind === 'teacher' || record.kind === 'student' ? { kind: record.kind } : {}),
      ...(readLessonBrief(record.lessonBrief) ? { lessonBrief: readLessonBrief(record.lessonBrief) } : {}),
      ...(Array.isArray(record.orgs) ? { orgs: record.orgs as SaasAccount['orgs'] } : {}),
    },
  };
}

export function formatBalanceYuan(milliYuan: number): string {
  return (milliYuan / 1000).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}
