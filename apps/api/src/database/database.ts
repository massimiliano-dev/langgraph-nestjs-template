import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import { SQL_IDENTIFIER, type AppConfig } from '../config/config.js';

/**
 * One shared pool for the checkpointer and the application tables. Everything lives in a dedicated schema
 * (`DB_SCHEMA`, default "agent"), so the app role does not need rights on `public`.
 */
export function createPool(config: AppConfig['database']): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'langgraph-agent-api',
  });
  // Without a listener an idle-client error would crash the process.
  pool.on('error', () => {});
  return pool;
}

export function createCheckpointer(pool: pg.Pool, schema: string): PostgresSaver {
  if (!SQL_IDENTIFIER.test(schema)) throw new Error('Invalid schema name');
  return new PostgresSaver(pool, undefined, { schema });
}

/**
 * Idempotent DDL for the application tables. Run at boot when DB_AUTO_MIGRATE=true. In production you may
 * prefer to run it from a migration job with a privileged role and give the app a role without DDL rights.
 */
export async function migrate(pool: pg.Pool, checkpointer: PostgresSaver, schema: string): Promise<void> {
  if (!SQL_IDENTIFIER.test(schema)) throw new Error('Invalid schema name');
  await checkpointer.setup();
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS "${schema}";
    CREATE TABLE IF NOT EXISTS "${schema}".threads (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS threads_tenant_created_idx ON "${schema}".threads (tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS "${schema}".tenant_usage (
      tenant_id text NOT NULL,
      month text NOT NULL,
      input_tokens bigint NOT NULL DEFAULT 0,
      output_tokens bigint NOT NULL DEFAULT 0,
      cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, month)
    );
  `);
}
