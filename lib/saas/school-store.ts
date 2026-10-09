import type { SaasDb } from '@/lib/saas/accounts';
import type { PhoneCodeRecord, PhoneCodeRepository } from '@/lib/saas/phone-code';
import type {
  ClassGroup,
  CoursePass,
  JoinRequest,
  Membership,
  SchoolOrg,
  SchoolRepository,
  SchoolUser,
} from '@/lib/saas/school';

export function phoneCodeRepository(db: SaasDb): PhoneCodeRepository {
  return {
    async insert(record: PhoneCodeRecord) {
      await db.query(
        `INSERT INTO saas_phone_codes (id, phone, purpose, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
        [record.id, record.phone, record.purpose, record.codeHash, record.expiresAt],
      );
    },
    async findLatest(phone, purpose) {
      const found = await db.query<{
        id: string;
        phone: string;
        purpose: PhoneCodeRecord['purpose'];
        code_hash: string;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT id, phone, purpose, code_hash, expires_at, used_at
           FROM saas_phone_codes
          WHERE phone = $1 AND purpose = $2
          ORDER BY expires_at DESC
          LIMIT 1`,
        [phone, purpose],
      );
      const row = found.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        phone: row.phone,
        purpose: row.purpose,
        codeHash: row.code_hash,
        expiresAt: new Date(row.expires_at).getTime(),
        usedAt: row.used_at ? new Date(row.used_at).getTime() : null,
      };
    },
    async markUsed(id, usedAt) {
      await db.query(
        `UPDATE saas_phone_codes
            SET used_at = to_timestamp($2 / 1000.0)
          WHERE id = $1 AND used_at IS NULL`,
        [id, usedAt],
      );
    },
  };
}

export function schoolRepository(db: SaasDb): SchoolRepository {
  return {
    async findUserByEmail(email) {
      const found = await db.query<UserRow>(
        'SELECT id, email, password_hash, display_name, kind FROM saas_users WHERE email = $1',
        [email],
      );
      return mapUser(found.rows[0]);
    },
    async findUser(id) {
      const found = await db.query<UserRow>(
        'SELECT id, email, password_hash, display_name, kind FROM saas_users WHERE id = $1',
        [id],
      );
      return mapUser(found.rows[0]);
    },
    async insertUser(user) {
      await db.query(
        `INSERT INTO saas_users (id, email, password_hash, display_name, kind)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.email, user.passwordHash, user.name, user.kind],
      );
    },
    async insertOrg(org, adminUserId, credit) {
      await db.transaction(async (tx) => {
        await tx.query('INSERT INTO saas_orgs (id, name, join_code) VALUES ($1, $2, $3)', [
          org.id,
          org.name,
          org.joinCode,
        ]);
        await tx.query(
          `INSERT INTO saas_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')`,
          [org.id, adminUserId],
        );
        await tx.query('INSERT INTO saas_wallets (org_id, balance_milli_yuan) VALUES ($1, $2)', [
          org.id,
          credit,
        ]);
      });
    },
    async findOrgByJoinCode(code) {
      const found = await db.query<OrgRow>(
        'SELECT id, name, join_code FROM saas_orgs WHERE join_code = $1',
        [code],
      );
      return mapOrg(found.rows[0]);
    },
    async findOrg(orgId) {
      const found = await db.query<OrgRow>(
        'SELECT id, name, join_code FROM saas_orgs WHERE id = $1',
        [orgId],
      );
      return mapOrg(found.rows[0]);
    },
    async findMembership(orgId, userId) {
      const found = await db.query<Membership>(
        'SELECT org_id AS "orgId", user_id AS "userId", role FROM saas_memberships WHERE org_id = $1 AND user_id = $2',
        [orgId, userId],
      );
      return found.rows[0] ?? null;
    },
    async insertMembership(membership) {
      await db.query('INSERT INTO saas_memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [
        membership.orgId,
        membership.userId,
        membership.role,
      ]);
    },
    async deleteMembership(orgId, userId) {
      await db.query('DELETE FROM saas_memberships WHERE org_id = $1 AND user_id = $2', [
        orgId,
        userId,
      ]);
    },
    async pendingRequest(orgId, userId) {
      const found = await db.query<RequestRow>(
        `SELECT id, org_id, user_id, role, status, created_at
           FROM saas_join_requests
          WHERE org_id = $1 AND user_id = $2 AND status = 'pending'`,
        [orgId, userId],
      );
      return mapRequest(found.rows[0]);
    },
    async insertRequest(request) {
      await db.query(
        `INSERT INTO saas_join_requests (id, org_id, user_id, role, status, created_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
         ON CONFLICT (org_id, user_id) WHERE status = 'pending' DO NOTHING`,
        [
          request.id,
          request.orgId,
          request.userId,
          request.role,
          request.status,
          request.createdAt,
        ],
      );
    },
    async findRequest(id) {
      const found = await db.query<RequestRow>(
        `SELECT id, org_id, user_id, role, status, created_at
           FROM saas_join_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      return mapRequest(found.rows[0]);
    },
    async setRequestStatus(id, status) {
      await db.query('UPDATE saas_join_requests SET status = $2 WHERE id = $1', [id, status]);
    },
    async insertClass(group) {
      await db.query(
        `INSERT INTO saas_class_groups (id, org_id, name, admin_user_id)
         VALUES ($1, $2, $3, $4)`,
        [group.id, group.orgId, group.name, group.adminUserId],
      );
    },
    async findClass(id) {
      const found = await db.query<ClassGroup>(
        `SELECT id, org_id AS "orgId", name, admin_user_id AS "adminUserId"
           FROM saas_class_groups WHERE id = $1`,
        [id],
      );
      return found.rows[0] ?? null;
    },
    async insertCourse(course) {
      await db.query(
        `INSERT INTO saas_course_codes (code, org_id, class_group_id, stage_id, title)
         VALUES ($1, $2, $3, $4, $5)`,
        [course.code, course.orgId, course.classGroupId, course.stageId, course.title],
      );
    },
    async findCourseByCode(code) {
      const found = await db.query<CoursePass>(
        `SELECT code, org_id AS "orgId", class_group_id AS "classGroupId",
                stage_id AS "stageId", title
           FROM saas_course_codes WHERE code = $1`,
        [code],
      );
      return found.rows[0] ?? null;
    },
  };
}

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string | null;
  kind: SchoolUser['kind'] | null;
}

interface OrgRow {
  id: string;
  name: string;
  join_code: string | null;
}

interface RequestRow {
  id: string;
  org_id: string;
  user_id: string;
  role: JoinRequest['role'];
  status: JoinRequest['status'];
  created_at: Date;
}

function mapUser(row: UserRow | undefined): SchoolUser | null {
  if (
    !row?.email ||
    !row.password_hash ||
    !row.display_name ||
    (row.kind !== 'teacher' && row.kind !== 'student')
  ) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    kind: row.kind,
    passwordHash: row.password_hash,
  };
}

function mapOrg(row: OrgRow | undefined): SchoolOrg | null {
  if (!row?.join_code) return null;
  return { id: row.id, name: row.name, joinCode: row.join_code };
}

function mapRequest(row: RequestRow | undefined): JoinRequest | null {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  };
}
