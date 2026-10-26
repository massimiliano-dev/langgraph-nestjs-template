import type pg from 'pg';

export type Release = () => Promise<void>;

/**
 * One run at a time per thread. Two concurrent "approve" requests on the same checkpoint would otherwise both
 * resume it and execute the side effect twice. Returns `null` when the thread is busy.
 */
export interface RunLock {
  tryAcquire(key: string): Promise<Release | null>;
}

/** Single-process lock. Use {@link PgAdvisoryRunLock} (or Redis) with more than one replica. */
export class InMemoryRunLock implements RunLock {
  private readonly held = new Set<string>();

  async tryAcquire(key: string): Promise<Release | null> {
    if (this.held.has(key)) return null;
    this.held.add(key);
    return async () => void this.held.delete(key);
  }
}

/**
 * Cross-replica lock with a PostgreSQL session advisory lock. Holds one pooled connection for the duration of
 * the run: size `DB_POOL_MAX` for your expected concurrent runs.
 */
export class PgAdvisoryRunLock implements RunLock {
  constructor(private readonly pool: pg.Pool) {}

  async tryAcquire(key: string): Promise<Release | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [key],
      );
      if (!rows[0]?.locked) {
        client.release();
        return null;
      }
    } catch (error) {
      client.release();
      throw error;
    }
    return async () => {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        client.release();
      } catch (error) {
        // Destroy the connection so a session lock can never leak back into the pool.
        client.release(error instanceof Error ? error : true);
      }
    };
  }
}
