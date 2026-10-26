import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { buildAgentGraph } from './agent/graph.js';
import { AgentRunner } from './agent/runner.js';
import { createDefaultTools } from './agent/tools/index.js';
import type { AgentTool } from './agent/tools/types.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import {
  AGENT_RUNNER,
  APP_CONFIG,
  HEALTH_CHECK,
  RATE_LIMITER,
  RUN_LOCK,
  THREADS_REPOSITORY,
  TOOLS,
  USAGE_STORE,
} from './common/tokens.js';
import type { AppConfig } from './config/config.js';
import { HealthController } from './health/health.controller.js';
import { BudgetService } from './tenancy/budget.service.js';
import { RateLimitGuard } from './tenancy/rate-limit.guard.js';
import type { RateLimiter } from './tenancy/rate-limiter.js';
import type { RunLock } from './tenancy/run-lock.js';
import { TenantContextInterceptor } from './tenancy/tenant-context.interceptor.js';
import { TenantGuard } from './tenancy/tenant.guard.js';
import type { UsageStore } from './tenancy/usage-store.js';
import { ThreadsController } from './threads/threads.controller.js';
import type { ThreadsRepository } from './threads/threads.repository.js';
import { ThreadsService } from './threads/threads.service.js';

/** Infrastructure the app needs. `main.ts` wires PostgreSQL and OpenAI; tests pass in-memory fakes. */
export interface AppDependencies {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  threads: ThreadsRepository;
  usage: UsageStore;
  rateLimiter: RateLimiter;
  runLock: RunLock;
  tools?: AgentTool[];
  healthCheck?: () => Promise<void>;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, deps: AppDependencies): DynamicModule {
    const tools =
      deps.tools ?? createDefaultTools({ email: { allowedDomains: config.agent.emailAllowedDomains } });
    return {
      module: AppModule,
      controllers: [HealthController, ThreadsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: THREADS_REPOSITORY, useValue: deps.threads },
        { provide: USAGE_STORE, useValue: deps.usage },
        { provide: RATE_LIMITER, useValue: deps.rateLimiter },
        { provide: RUN_LOCK, useValue: deps.runLock },
        { provide: TOOLS, useValue: tools },
        { provide: HEALTH_CHECK, useValue: deps.healthCheck ?? (async () => {}) },
        {
          provide: AGENT_RUNNER,
          useFactory: () =>
            new AgentRunner(
              buildAgentGraph({
                model: deps.model,
                tools,
                checkpointer: deps.checkpointer,
                modelName: config.llm.model,
                pricing: config.llm.pricing,
                captureContent: config.otel.captureContent,
              }),
              {
                maxSteps: config.agent.maxSteps,
                modelName: config.llm.model,
                pricing: config.llm.pricing,
                captureContent: config.otel.captureContent,
                onUsage: (tenantId, usage) => deps.usage.record(tenantId, usage),
              },
            ),
        },
        BudgetService,
        ThreadsService,
        RateLimitGuard,
        // Order matters: authenticate first, then resolve the tenant.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
