import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface ThreadRecord {
  id: string;
  tenantId: string;
  createdAt: Date;
}

/**
 * Thread ownership. Every read takes the tenant id: there is deliberately no "find by id" without a tenant,
 * so a cross-tenant lookup cannot be written by accident.
 */
export interface ThreadsRepository {
  create(tenantId: string): Promise<ThreadRecord>;
  findForTenant(id: string, tenantId: string): Promise<ThreadRecord | null>;
}

export class InMemoryThreadsRepository implements ThreadsRepository {
  private readonly threads = new Map<string, ThreadRecord>();

  async create(tenantId: string): Promise<ThreadRecord> {
    const thread = { id: randomUUID(), tenantId, createdAt: new Date() };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async findForTenant(id: string, tenantId: string): Promise<ThreadRecord | null> {
    const thread = this.threads.get(id);
    return thread && thread.tenantId === tenantId ? thread : null;
  }
}

export class PgThreadsRepository implements ThreadsRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly schema: string,
  ) {}

  async create(tenantId: string): Promise<ThreadRecord> {
    const { rows } = await this.pool.query<{ id: string; tenant_id: string; created_at: Date }>(
      `INSERT INTO "${this.schema}".threads (id, tenant_id) VALUES ($1, $2) RETURNING id, tenant_id, created_at`,
      [randomUUID(), tenantId],
    );
    const row = rows[0]!;
    return { id: row.id, tenantId: row.tenant_id, createdAt: row.created_at };
  }

  async findForTenant(id: string, tenantId: string): Promise<ThreadRecord | null> {
    const { rows } = await this.pool.query<{ id: string; tenant_id: string; created_at: Date }>(
      `SELECT id, tenant_id, created_at FROM "${this.schema}".threads WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const row = rows[0];
    return row ? { id: row.id, tenantId: row.tenant_id, createdAt: row.created_at } : null;
  }
}
