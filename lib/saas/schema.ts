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
`;
