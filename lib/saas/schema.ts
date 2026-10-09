/**
 * Organization, membership, session, and wallet tables for SaaS mode.
 *
 * These sit beside the existing stage owner column. An organization id becomes
 * the document owner. The development persistence token is not used once
 * `OPENMAIC_SAAS_ENABLED` is on.
 *
 * Money is milli-yuan, matching `lib/saas/pricing.ts`.
 */
export const SAAS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS saas_orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_memberships (
  org_id text NOT NULL REFERENCES saas_orgs(id),
  user_id text NOT NULL REFERENCES saas_users(id),
  role text NOT NULL CHECK (role IN ('org_admin', 'teacher', 'student')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS saas_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES saas_users(id),
  org_id text NOT NULL REFERENCES saas_orgs(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS saas_wallets (
  org_id text PRIMARY KEY REFERENCES saas_orgs(id),
  balance_milli_yuan bigint NOT NULL CHECK (balance_milli_yuan >= 0)
);

CREATE TABLE IF NOT EXISTS saas_ledger (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  kind text NOT NULL,
  cost_milli_yuan bigint NOT NULL,
  retail_milli_yuan bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_classes (
  code text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  stage_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, stage_id)
);

ALTER TABLE saas_users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE saas_users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE saas_users ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE saas_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE saas_users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saas_users_phone_key ON saas_users (phone);

ALTER TABLE saas_orgs ADD COLUMN IF NOT EXISTS join_code text;
CREATE UNIQUE INDEX IF NOT EXISTS saas_orgs_join_code_key ON saas_orgs (join_code);

ALTER TABLE saas_sessions ALTER COLUMN org_id DROP NOT NULL;

UPDATE saas_users u SET
  display_name = COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)),
  kind = COALESCE(u.kind, CASE WHEN EXISTS (
    SELECT 1 FROM saas_memberships m WHERE m.user_id = u.id AND m.role IN ('teacher', 'org_admin')
  ) THEN 'teacher' ELSE 'student' END)
WHERE u.email IS NOT NULL AND (u.display_name IS NULL OR u.display_name = '' OR u.kind IS NULL);

UPDATE saas_orgs SET join_code = upper(substr(md5(id), 1, 12)) WHERE join_code IS NULL;


CREATE TABLE IF NOT EXISTS saas_phone_codes (
  id text PRIMARY KEY,
  phone text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS saas_join_requests (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  user_id text NOT NULL REFERENCES saas_users(id),
  role text NOT NULL CHECK (role IN ('teacher', 'student')),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_join_requests_one_pending
  ON saas_join_requests (org_id, user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS saas_class_groups (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  name text NOT NULL,
  admin_user_id text NOT NULL REFERENCES saas_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_course_codes (
  code text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  class_group_id text NOT NULL REFERENCES saas_class_groups(id),
  stage_id text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, stage_id)
);

CREATE TABLE IF NOT EXISTS saas_lessons (
  stage_id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  class_group_id text NOT NULL REFERENCES saas_class_groups(id),
  title text NOT NULL,
  created_by text NOT NULL REFERENCES saas_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saas_lessons ADD COLUMN IF NOT EXISTS grade text NOT NULL DEFAULT '';
ALTER TABLE saas_lessons ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '';
ALTER TABLE saas_lessons ADD COLUMN IF NOT EXISTS textbook text NOT NULL DEFAULT '';
ALTER TABLE saas_lessons ADD COLUMN IF NOT EXISTS periods text NOT NULL DEFAULT '';
ALTER TABLE saas_lessons ADD COLUMN IF NOT EXISTS objectives text NOT NULL DEFAULT '';
ALTER TABLE saas_lessons ADD COLUMN IF NOT EXISTS baseline text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS saas_wallet_topups (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  user_id text NOT NULL REFERENCES saas_users(id),
  request_id text NOT NULL,
  amount_milli_yuan bigint NOT NULL CHECK (amount_milli_yuan > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, request_id)
);

CREATE TABLE IF NOT EXISTS saas_generation_jobs (
  stage_id text PRIMARY KEY REFERENCES saas_lessons(stage_id),
  org_id text NOT NULL REFERENCES saas_orgs(id),
  input jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress jsonb NOT NULL,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_attendance (
  stage_id text NOT NULL REFERENCES saas_lessons(stage_id),
  org_id text NOT NULL REFERENCES saas_orgs(id),
  user_id text NOT NULL REFERENCES saas_users(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, user_id)
);

CREATE TABLE IF NOT EXISTS saas_quiz_submissions (
  stage_id text NOT NULL REFERENCES saas_lessons(stage_id),
  org_id text NOT NULL REFERENCES saas_orgs(id),
  user_id text NOT NULL REFERENCES saas_users(id),
  scene_id text NOT NULL,
  attempt_id text NOT NULL,
  answers jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, user_id, scene_id, attempt_id)
);
CREATE TABLE IF NOT EXISTS saas_payment_orders (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES saas_orgs(id),
  user_id text NOT NULL REFERENCES saas_users(id),
  request_id text NOT NULL,
  amount_milli_yuan bigint NOT NULL CHECK (amount_milli_yuan > 0),
  app_id text NOT NULL,
  seller_id text NOT NULL,
  sandbox boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  trade_no text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE (org_id, request_id)
);
`;
