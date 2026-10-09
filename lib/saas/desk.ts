import { hashSessionToken, newSessionToken, type SaasDb } from '@/lib/saas/accounts';
import { SAAS_SESSION_MAX_AGE_SECONDS } from '@/lib/saas/cookie';
import type { SaasRole } from '@/lib/saas/roles';
import type { PersonKind } from '@/lib/saas/school';
import { latestLessonBrief } from '@/lib/saas/lesson-brief';
import type { LessonBrief } from '@/lib/saas/lesson-craft';

export interface DeskOrg {
  orgId: string;
  orgName: string;
  role: SaasRole;
}

export interface DeskAccount {
  userId: string;
  name: string;
  kind: PersonKind;
  email: string;
  orgId: string | null;
  orgName: string;
  role: SaasRole | null;
  balanceMilliYuan: number;
  joinCode: string | null;
  lessonBrief?: LessonBrief;
  orgs: DeskOrg[];
  pending: Array<{ id: string; orgName: string; role: PersonKind }>;
  classes: Array<{ id: string; name: string; adminUserId: string; adminName: string }>;
  members: Array<{ userId: string; name: string; email: string; role: SaasRole }>;
  requests: Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    role: PersonKind;
    createdAt: number;
  }>;
  generations: Array<{ stageId: string; title: string; status: string }>;
}

export async function startAccountSession(
  db: SaasDb,
  userId: string,
  orgId: string | null,
): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SAAS_SESSION_MAX_AGE_SECONDS * 1000);
  await db.query(
    'INSERT INTO saas_sessions (token_hash, user_id, org_id, expires_at) VALUES ($1, $2, $3, $4)',
    [hashSessionToken(token), userId, orgId, expiresAt],
  );
  return token;
}

export async function switchAccountOrg(db: SaasDb, token: string, orgId: string): Promise<boolean> {
  const updated = await db.query<{ user_id: string }>(
    `UPDATE saas_sessions s
        SET org_id = $2
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND EXISTS (
          SELECT 1 FROM saas_memberships m
           WHERE m.user_id = s.user_id AND m.org_id = $2
        )
      RETURNING s.user_id`,
    [hashSessionToken(token), orgId],
  );
  return updated.rows.length === 1;
}

export async function loadDesk(db: SaasDb, token: string): Promise<DeskAccount | null> {
  if (!token) return null;
  const sessions = await db.query<{
    user_id: string;
    org_id: string | null;
    email: string | null;
    display_name: string | null;
    kind: PersonKind | null;
  }>(
    `SELECT s.user_id, s.org_id, u.email, u.display_name, u.kind
       FROM saas_sessions s
       JOIN saas_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  const session = sessions.rows[0];
  if (!session?.email || !session.display_name || !session.kind) return null;

  const orgRows = await db.query<DeskOrg & { join_code: string | null }>(
    `SELECT o.id AS "orgId", o.name AS "orgName", m.role, o.join_code
       FROM saas_memberships m
       JOIN saas_orgs o ON o.id = m.org_id
      WHERE m.user_id = $1
      ORDER BY o.name`,
    [session.user_id],
  );
  let orgId = session.org_id;
  if (!orgRows.rows.some((org) => org.orgId === orgId)) {
    orgId = orgRows.rows[0]?.orgId ?? null;
    await db.query('UPDATE saas_sessions SET org_id = $2 WHERE token_hash = $1', [
      hashSessionToken(token),
      orgId,
    ]);
  }
  const current = orgRows.rows.find((org) => org.orgId === orgId) ?? null;
  const wallet = current
    ? await db.query<{ balance_milli_yuan: string | number }>(
        'SELECT balance_milli_yuan FROM saas_wallets WHERE org_id = $1',
        [current.orgId],
      )
    : { rows: [] };
  const balance = Number(wallet.rows[0]?.balance_milli_yuan ?? 0);

  const pending = await db.query<{ id: string; org_name: string; role: PersonKind }>(
    `SELECT r.id, o.name AS org_name, r.role
       FROM saas_join_requests r
       JOIN saas_orgs o ON o.id = r.org_id
      WHERE r.user_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at`,
    [session.user_id],
  );

  const savedBrief = await latestLessonBrief(db, current?.orgId ?? orgRows.rows[0]?.orgId ?? '');
  const desk: DeskAccount = {
    userId: session.user_id,
    name: session.display_name,
    kind: session.kind,
    email: session.email,
    orgId: current?.orgId ?? null,
    orgName: current?.orgName ?? '',
    role: current?.role ?? null,
    balanceMilliYuan: Number.isSafeInteger(balance) ? balance : 0,
    joinCode: current?.role === 'org_admin' ? (current.join_code ?? null) : null,
    ...(savedBrief ? { lessonBrief: savedBrief } : {}),
    orgs: orgRows.rows.map((org) => ({
      orgId: org.orgId,
      orgName: org.orgName,
      role: org.role,
    })),
    pending: pending.rows.map((row) => ({
      id: row.id,
      orgName: row.org_name,
      role: row.role,
    })),
    classes: [],
    members: [],
    requests: [],
    generations: [],
  };

  if (!current || current.role === 'student') return desk;

  const jobs = await db.query<{ stageId: string; title: string; status: string }>(
    `SELECT l.stage_id AS "stageId", l.title, j.status FROM saas_lessons l
     JOIN saas_generation_jobs j ON j.stage_id = l.stage_id
     JOIN saas_class_groups g ON g.id = l.class_group_id
     WHERE l.org_id = $1 AND ($3 = 'org_admin' OR g.admin_user_id = $2)
     ORDER BY j.updated_at DESC LIMIT 50`,
    [current.orgId, session.user_id, current.role],
  );
  desk.generations = jobs.rows;

  const classes = await db.query<{
    id: string;
    name: string;
    admin_user_id: string;
    admin_name: string;
  }>(
    `SELECT g.id, g.name, g.admin_user_id, u.display_name AS admin_name
       FROM saas_class_groups g
       JOIN saas_users u ON u.id = g.admin_user_id
      WHERE g.org_id = $1
      ORDER BY g.created_at`,
    [current.orgId],
  );
  desk.classes = classes.rows.map((row) => ({
    id: row.id,
    name: row.name,
    adminUserId: row.admin_user_id,
    adminName: row.admin_name,
  }));
  if (current.role !== 'org_admin') return desk;

  const members = await db.query<{
    user_id: string;
    display_name: string;
    email: string;
    role: SaasRole;
  }>(
    `SELECT u.id AS user_id, u.display_name, u.email, m.role
       FROM saas_memberships m
       JOIN saas_users u ON u.id = m.user_id
      WHERE m.org_id = $1
      ORDER BY m.role, u.display_name`,
    [current.orgId],
  );
  desk.members = members.rows.map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    email: row.email,
    role: row.role,
  }));
  const requests = await db.query<{
    id: string;
    user_id: string;
    display_name: string;
    email: string;
    role: PersonKind;
    created_at: Date;
  }>(
    `SELECT r.id, r.user_id, u.display_name, u.email, r.role, r.created_at
       FROM saas_join_requests r
       JOIN saas_users u ON u.id = r.user_id
      WHERE r.org_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at`,
    [current.orgId],
  );
  desk.requests = requests.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.display_name,
    email: row.email,
    role: row.role,
    createdAt: new Date(row.created_at).getTime(),
  }));
  return desk;
}
