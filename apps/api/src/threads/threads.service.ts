import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { AgentEvent, AgentRunner, HistoryMessage } from '../agent/runner.js';
import type { ApprovalRequest } from '../agent/graph.js';
import { type AgentTool, validateToolArgs } from '../agent/tools/types.js';
import type { AppConfig } from '../config/config.js';
import { AGENT_RUNNER, APP_CONFIG, RUN_LOCK, THREADS_REPOSITORY, TOOLS } from '../common/tokens.js';
import { parseBody } from '../common/validation.js';
import { BudgetService } from '../tenancy/budget.service.js';
import type { RunLock } from '../tenancy/run-lock.js';
import type { ThreadRecord, ThreadsRepository } from './threads.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ResumeBodySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    /** Required: the tool call the human actually saw. A mismatch is refused with 409. */
    toolCallId: z.string().min(1).max(200),
    editedArgs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'approve' || v.editedArgs === undefined, {
    message: 'editedArgs is only allowed with decision "approve"',
    path: ['editedArgs'],
  });

@Injectable()
export class ThreadsService {
  private readonly runBodySchema;
  private readonly tools: Map<string, AgentTool>;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(THREADS_REPOSITORY) private readonly threads: ThreadsRepository,
    @Inject(AGENT_RUNNER) private readonly runner: AgentRunner,
    @Inject(RUN_LOCK) private readonly lock: RunLock,
    @Inject(BudgetService) private readonly budget: BudgetService,
    @Inject(TOOLS) tools: AgentTool[],
  ) {
    this.runBodySchema = z
      .object({ message: z.string().trim().min(1).max(config.http.maxMessageChars) })
      .strict();
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  create(tenantId: string): Promise<ThreadRecord> {
    return this.threads.create(tenantId);
  }

  /**
   * The only way to reach a thread. Unknown ids, malformed ids and other tenants' threads all produce the
   * same 404, so responses do not reveal whether a thread exists.
   */
  async requireThread(tenantId: string, id: string): Promise<ThreadRecord> {
    const thread = UUID.test(id) ? await this.threads.findForTenant(id, tenantId) : null;
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  async history(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; messages: HistoryMessage[]; pendingApproval?: ApprovalRequest }> {
    const thread = await this.requireThread(tenantId, id);
    return { id: thread.id, ...(await this.runner.history(tenantId, thread.id)) };
  }

  /** Validates everything up front (so errors are plain HTTP errors), then returns the event stream. */
  async startRun(tenantId: string, id: string, body: unknown): Promise<AsyncIterable<AgentEvent>> {
    const thread = await this.requireThread(tenantId, id);
    const { message } = parseBody(this.runBodySchema, body);
    return this.locked(tenantId, thread.id, async () => {
      if (await this.runner.pendingApproval(tenantId, thread.id))
        throw new ConflictException('This thread is waiting for an approval decision');
      await this.budget.assertWithinBudget(tenantId);
      return (signal) => this.runner.run({ tenantId, threadId: thread.id, input: { message }, signal });
    });
  }

  async resume(tenantId: string, id: string, body: unknown): Promise<AsyncIterable<AgentEvent>> {
    const thread = await this.requireThread(tenantId, id);
    const decision = parseBody(ResumeBodySchema, body);
    // State checks run while holding the lock, so a racing second "approve" sees the updated checkpoint.
    return this.locked(tenantId, thread.id, async () => {
      const pending = await this.runner.pendingApproval(tenantId, thread.id);
      if (!pending) throw new ConflictException('Nothing to approve on this thread');
      if (decision.toolCallId !== pending.toolCallId)
        throw new ConflictException('The pending tool call has changed. Reload and review it again.');
      if (decision.editedArgs !== undefined) {
        // Fail fast with a clear 400. The graph validates again before executing.
        const tool = this.tools.get(pending.tool);
        const parsed = tool
          ? validateToolArgs(tool, decision.editedArgs)
          : { ok: false as const, reason: 'unknown tool' };
        if (!parsed.ok) throw new BadRequestException(`editedArgs: ${parsed.reason}`);
      }
      await this.budget.assertWithinBudget(tenantId);
      const resume = {
        decision: decision.decision,
        ...(decision.editedArgs ? { editedArgs: decision.editedArgs } : {}),
      };
      return (signal) => this.runner.run({ tenantId, threadId: thread.id, input: { resume }, signal });
    });
  }

  /** One run per thread at a time: concurrent approvals must not resume the same checkpoint twice. */
  private async locked(
    tenantId: string,
    threadId: string,
    prepare: () => Promise<(signal: AbortSignal) => AsyncGenerator<AgentEvent>>,
  ): Promise<AsyncIterable<AgentEvent>> {
    const release = await this.lock.tryAcquire(`thread:${tenantId}:${threadId}`);
    if (!release) throw new ConflictException('A run is already in progress on this thread');
    let run: (signal: AbortSignal) => AsyncGenerator<AgentEvent>;
    try {
      run = await prepare();
    } catch (error) {
      await release();
      throw error;
    }
    return {
      [Symbol.asyncIterator]: () => {
        const controller = new AbortController();
        const inner = run(controller.signal);
        let released = false;
        const done = async () => {
          if (!released) {
            released = true;
            await release();
          }
        };
        return {
          async next() {
            try {
              const result = await inner.next();
              if (result.done) await done();
              return result;
            } catch (error) {
              await done();
              throw error;
            }
          },
          async return() {
            controller.abort();
            await inner.return(undefined);
            await done();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
}
