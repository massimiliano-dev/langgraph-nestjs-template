import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Command, type Interrupt, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { context, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { estimateCostUsd, type PricingTable } from '../config/pricing.js';
import { ATTR, tracer, truncateForSpan } from '../observability/tracing.js';
import type { AgentGraph, ApprovalDecision, ApprovalRequest } from './graph.js';

export interface TokenUsage {
  input: number;
  output: number;
  costUsd?: number;
}

/** Events streamed to clients. They carry no system prompt, raw tool output or internal identifiers. */
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_result'; toolCallId: string; tool: string; status: 'success' | 'error' }
  | { type: 'approval_required'; request: ApprovalRequest }
  | { type: 'done'; status: 'completed' | 'interrupted'; usage: TokenUsage };

export type RunInput = { message: string } | { resume: ApprovalDecision };

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallId?: string;
  name?: string;
  status?: 'success' | 'error';
}

export interface AgentRunnerOptions {
  maxSteps: number;
  modelName: string;
  pricing: PricingTable;
  captureContent?: boolean;
  /** Called after every model call, so aborted runs are still accounted for. */
  onUsage?: (tenantId: string, usage: TokenUsage) => Promise<void>;
}

/**
 * Runs the graph for one tenant's thread. The checkpoint key is namespaced by tenant, so even a bug that skipped
 * the ownership check could not load another tenant's state.
 */
export class AgentRunner {
  constructor(
    private readonly graph: AgentGraph,
    private readonly options: AgentRunnerOptions,
  ) {}

  private config(tenantId: string, threadId: string): LangGraphRunnableConfig {
    return {
      configurable: { thread_id: `${tenantId}:${threadId}`, tenant_id: tenantId, app_thread_id: threadId },
      recursionLimit: this.options.maxSteps,
    };
  }

  async *run(params: {
    tenantId: string;
    threadId: string;
    input: RunInput;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentEvent> {
    const { tenantId, threadId, input, signal } = params;
    const span = tracer.startSpan('agent.run', {
      attributes: {
        [ATTR.tenant]: tenantId,
        [ATTR.thread]: threadId,
        [ATTR.model]: this.options.modelName,
        'agent.run.kind': 'resume' in input ? 'resume' : 'message',
      },
    });
    if (this.options.captureContent && 'message' in input)
      span.setAttribute('agent.input', truncateForSpan(input.message));
    const spanContext = trace.setSpan(context.active(), span);
    const total: TokenUsage = { input: 0, output: 0 };
    let interrupted = false;

    try {
      const options = {
        ...this.config(tenantId, threadId),
        streamMode: ['messages', 'updates'] as ('messages' | 'updates')[],
        ...(signal ? { signal } : {}),
      };
      const stream = await context.with(spanContext, () =>
        'resume' in input
          ? this.graph.stream(new Command({ resume: input.resume }), options)
          : this.graph.stream({ messages: [new HumanMessage(input.message)] }, options),
      );
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await context.with(spanContext, () => iterator.next());
        if (next.done) break;
        const [mode, chunk] = next.value as [string, unknown];
        if (mode === 'messages') {
          const [message, metadata] = chunk as [BaseMessage, Record<string, unknown>];
          if (metadata.langgraph_node !== 'agent') continue;
          if (!AIMessageChunk.isInstance(message) && !AIMessage.isInstance(message)) continue;
          const text = message.text;
          if (text) yield { type: 'token', text };
          continue;
        }
        for (const event of await this.handleUpdate(
          chunk as Record<string, unknown>,
          tenantId,
          total,
          span,
        )) {
          if (event.type === 'approval_required') interrupted = true;
          yield event;
        }
      }
      span.setAttributes({ [ATTR.tokensIn]: total.input, [ATTR.tokensOut]: total.output });
      if (total.costUsd !== undefined) span.setAttribute(ATTR.cost, total.costUsd);
      span.setAttribute('agent.run.status', interrupted ? 'interrupted' : 'completed');
      yield { type: 'done', status: interrupted ? 'interrupted' : 'completed', usage: total };
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : 'error' });
      throw error;
    } finally {
      span.end();
    }
  }

  private async handleUpdate(
    update: Record<string, unknown>,
    tenantId: string,
    total: TokenUsage,
    span: Span,
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for (const [node, value] of Object.entries(update)) {
      if (node === '__interrupt__') {
        for (const item of value as Interrupt<ApprovalRequest>[]) {
          if (item.value?.kind === 'tool_approval')
            events.push({ type: 'approval_required', request: item.value });
        }
        continue;
      }
      const messages = ((value as { messages?: BaseMessage[] } | null)?.messages ?? []) as BaseMessage[];
      for (const message of messages) {
        if (node === 'agent' && AIMessage.isInstance(message) && message.usage_metadata) {
          const usage: TokenUsage = {
            input: message.usage_metadata.input_tokens,
            output: message.usage_metadata.output_tokens,
          };
          const cost = estimateCostUsd(this.options.pricing, this.options.modelName, usage);
          if (cost !== undefined) {
            usage.costUsd = cost;
            total.costUsd = (total.costUsd ?? 0) + cost;
          }
          total.input += usage.input;
          total.output += usage.output;
          await this.options.onUsage?.(tenantId, usage);
        }
        if (node === 'tools' && ToolMessage.isInstance(message)) {
          events.push({
            type: 'tool_result',
            toolCallId: message.tool_call_id,
            tool: message.name ?? 'unknown',
            status: message.status ?? 'success',
          });
          span.addEvent('tool_result', {
            'tool.name': message.name ?? 'unknown',
            'tool.status': message.status ?? '',
          });
        }
      }
    }
    return events;
  }

  /** The approval the thread is waiting for, if any. Read from the latest checkpoint. */
  async pendingApproval(tenantId: string, threadId: string): Promise<ApprovalRequest | undefined> {
    const snapshot = await this.graph.getState(this.config(tenantId, threadId));
    for (const task of snapshot.tasks) {
      for (const item of task.interrupts as Interrupt<ApprovalRequest>[]) {
        if (item.value?.kind === 'tool_approval') return item.value;
      }
    }
    return undefined;
  }

  /** Conversation rebuilt from the latest checkpoint. */
  async history(
    tenantId: string,
    threadId: string,
  ): Promise<{ messages: HistoryMessage[]; pendingApproval?: ApprovalRequest }> {
    const snapshot = await this.graph.getState(this.config(tenantId, threadId));
    const messages = ((snapshot.values as { messages?: BaseMessage[] }).messages ?? []).flatMap(
      (m): HistoryMessage[] => {
        if (HumanMessage.isInstance(m)) return [{ role: 'user', content: m.text }];
        if (AIMessage.isInstance(m))
          return [
            {
              role: 'assistant',
              content: m.text,
              ...(m.tool_calls?.length
                ? { toolCalls: m.tool_calls.map((c) => ({ id: c.id ?? '', name: c.name, args: c.args })) }
                : {}),
            },
          ];
        if (ToolMessage.isInstance(m))
          // Raw tool output stays server-side: it can be large and is untrusted.
          return [
            {
              role: 'tool',
              content: '',
              toolCallId: m.tool_call_id,
              ...(m.name ? { name: m.name } : {}),
              status: m.status ?? 'success',
            },
          ];
        return [];
      },
    );
    const pendingApproval = await this.pendingApproval(tenantId, threadId);
    return { messages, ...(pendingApproval ? { pendingApproval } : {}) };
  }
}
