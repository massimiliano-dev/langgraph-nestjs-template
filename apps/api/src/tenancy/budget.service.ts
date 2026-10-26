import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/config.js';
import { APP_CONFIG, USAGE_STORE } from '../common/tokens.js';
import type { UsageStore } from './usage-store.js';

/**
 * Monthly token budget per tenant, checked before every run and resume. A run that starts under budget may
 * finish slightly over it: `LLM_MAX_OUTPUT_TOKENS` and `AGENT_MAX_STEPS` bound the overshoot.
 */
@Injectable()
export class BudgetService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(USAGE_STORE) private readonly usage: UsageStore,
  ) {}

  /** Override to read per-tenant plans from your billing system. */
  limitFor(_tenantId: string): number {
    return this.config.limits.monthlyTokenBudget;
  }

  async assertWithinBudget(tenantId: string): Promise<void> {
    const used = await this.usage.monthlyTokens(tenantId);
    if (used >= this.limitFor(tenantId))
      throw new HttpException('Monthly token budget exhausted', HttpStatus.TOO_MANY_REQUESTS);
  }
}
