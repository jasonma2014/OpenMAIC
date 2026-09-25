import { Pool, type PoolClient } from 'pg';

import { ensureSaasSchema, type SaasDb } from '@/lib/saas/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

function queryable(client: Pool | PoolClient): SaasDb['query'] {
  return (sql, params) => client.query(sql, params as unknown[] | undefined);
}

/** One pooled connection per transaction. Nested transactions are not used. */
export function saasDbFromPool(pool: Pool): SaasDb {
  const database: SaasDb = {
    query: queryable(pool),
    transaction: async (fn) => {
      const client = await pool.connect();
      const scoped: SaasDb = {
        query: queryable(client),
        transaction: (inner) => inner(scoped),
      };
      try {
        await client.query('BEGIN');
        const result = await fn(scoped);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return database;
}

/** Opens the app database and creates the SaaS tables if they are missing. */
export async function openSaasDb(): Promise<SaasDb> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when OPENMAIC_SAAS_ENABLED is on');
  }
  const provider = await getServerPersistenceProvider(connectionString);
  const db = saasDbFromPool(provider.pool);
  await ensureSaasSchema(db);
  return db;
}
