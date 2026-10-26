import type pg from 'pg';
import type { TokenUsage } from '../agent/runner.js';

/** Monthly token usage per tenant, used for budgets. Months are UTC calendar months ("2026-10"). */
export interface UsageStore {
  monthlyTokens(tenantId: string, now?: Date): Promise<number>;
  record(tenantId: string, usage: TokenUsage, now?: Date): Promise<void>;
}

export const monthKey = (now: Date) => now.toISOString().slice(0, 7);

export class InMemoryUsageStore implements UsageStore {
  private readonly totals = new Map<string, number>();

  async monthlyTokens(tenantId: string, now = new Date()): Promise<number> {
    return this.totals.get(`${tenantId}|${monthKey(now)}`) ?? 0;
  }

  async record(tenantId: string, usage: TokenUsage, now = new Date()): Promise<void> {
    const key = `${tenantId}|${monthKey(now)}`;
    this.totals.set(key, (this.totals.get(key) ?? 0) + usage.input + usage.output);
  }
}

export class PgUsageStore implements UsageStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly schema: string,
  ) {}

  async monthlyTokens(tenantId: string, now = new Date()): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>(
      `SELECT input_tokens + output_tokens AS total FROM "${this.schema}".tenant_usage
        WHERE tenant_id = $1 AND month = $2`,
      [tenantId, monthKey(now)],
    );
    return rows[0] ? Number(rows[0].total) : 0;
  }

  async record(tenantId: string, usage: TokenUsage, now = new Date()): Promise<void> {
    await this.pool.query(
      `INSERT INTO "${this.schema}".tenant_usage (tenant_id, month, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, month) DO UPDATE SET
         input_tokens = tenant_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = tenant_usage.output_tokens + EXCLUDED.output_tokens,
         cost_usd = tenant_usage.cost_usd + EXCLUDED.cost_usd`,
      [tenantId, monthKey(now), usage.input, usage.output, usage.costUsd ?? 0],
    );
  }
}
