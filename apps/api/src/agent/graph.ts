import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  Annotation,
  type BaseCheckpointSaver,
  END,
  interrupt,
  type LangGraphRunnableConfig,
  MessagesAnnotation,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import { SpanStatusCode } from '@opentelemetry/api';
import { z } from 'zod';
import { estimateCostUsd, type PricingTable } from '../config/pricing.js';
import { ATTR, tracer, truncateForSpan } from '../observability/tracing.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { type AgentTool, ToolRegistry, validateToolArgs } from './tools/types.js';

/** What the client sends to resume a paused run. Anything that does not parse is treated as a rejection. */
export const ApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    editedArgs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** The payload of an `interrupt()`: what the human is asked to approve. */
export interface ApprovalRequest {
  kind: 'tool_approval';
  toolCallId: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
}

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  /** Human decisions keyed by tool-call id. Written only by the `review` node. */
  reviews: Annotation<Record<string, ApprovalDecision>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});
export type AgentStateType = typeof AgentState.State;

export interface AgentGraphDeps {
  model: BaseChatModel;
  tools: readonly AgentTool[];
  checkpointer: BaseCheckpointSaver;
  /** Model name for span attributes and the price table. */
  modelName: string;
  pricing: PricingTable;
  /** Put prompts, completions and tool arguments in spans. Off by default (PII). */
  captureContent?: boolean;
  systemPrompt?: string;
}

const logger = new Logger('AgentGraph');

/** Hard caps that bound the blast radius of a confused or injected model. */
export const MAX_TOOL_CALLS_PER_TURN = 5;
export const MAX_TOOL_OUTPUT_CHARS = 8_000;

/** Values the runner puts in `configurable`. The graph fails closed when they are missing. */
export interface RunScope {
  tenantId: string;
  threadId: string;
}

export function scopeOf(config: LangGraphRunnableConfig): RunScope {
  const tenantId = config.configurable?.tenant_id;
  const threadId = config.configurable?.app_thread_id;
  if (typeof tenantId !== 'string' || typeof threadId !== 'string')
    throw new Error('Run started without tenant scope');
  return { tenantId, threadId };
}

function lastAiMessage(messages: BaseMessage[]): AIMessage | undefined {
  const last = messages.at(-1);
  return last && (AIMessage.isInstance(last) || AIMessageChunk.isInstance(last))
    ? (last as AIMessage)
    : undefined;
}

/** Tool output is data, not instructions: wrap it and neutralise attempts to close the wrapper early. */
export function wrapUntrusted(tool: string, output: string): string {
  const clipped =
    output.length > MAX_TOOL_OUTPUT_CHARS ? `${output.slice(0, MAX_TOOL_OUTPUT_CHARS)} [truncated]` : output;
  const safe = clipped.replace(/<\/?\s*tool_output/gi, (m) => m.replace('<', '&lt;'));
  return `<tool_output tool="${tool}">\n${safe}\n</tool_output>`;
}

function toolMessage(toolCallId: string, name: string, content: string, status: 'success' | 'error') {
  return new ToolMessage({ tool_call_id: toolCallId, name, content, status });
}

/**
 * A ReAct-style graph with a human-approval gate:
 *
 *   START -> agent -> (no tool calls) -> END
 *                  -> (read-only calls only) -> tools -> agent
 *                  -> (any side-effect call) -> review -> tools -> agent
 *
 * `review` only asks questions (`interrupt()`), so re-running it on resume is safe. `tools` never interrupts,
 * so a side effect can never be executed twice by the resume mechanism.
 */
export function buildAgentGraph(deps: AgentGraphDeps) {
  const registry = new ToolRegistry(deps.tools);
  if (!deps.model.bindTools) throw new Error('The chat model does not support tool calling');
  const toolDefinitions = registry.all().map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }),
    },
  }));
  const model = deps.model.bindTools(toolDefinitions);
  const systemPrompt = deps.systemPrompt ?? SYSTEM_PROMPT;

  async function agent(state: AgentStateType, config: LangGraphRunnableConfig) {
    const { tenantId, threadId } = scopeOf(config);
    return tracer.startActiveSpan('llm.call', async (span) => {
      span.setAttributes({ [ATTR.tenant]: tenantId, [ATTR.thread]: threadId, [ATTR.model]: deps.modelName });
      try {
        const response = await model.invoke([new SystemMessage(systemPrompt), ...state.messages], config);
        const usage = response.usage_metadata;
        if (usage) {
          span.setAttributes({ [ATTR.tokensIn]: usage.input_tokens, [ATTR.tokensOut]: usage.output_tokens });
          const cost = estimateCostUsd(deps.pricing, deps.modelName, {
            input: usage.input_tokens,
            output: usage.output_tokens,
          });
          if (cost !== undefined) span.setAttribute(ATTR.cost, cost);
        }
        span.setAttribute('llm.tool_calls', response.tool_calls?.length ?? 0);
        if (deps.captureContent) span.setAttribute('llm.output', truncateForSpan(response.text));
        return { messages: [response] };
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'llm call failed' });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  function route(state: AgentStateType): 'review' | 'tools' | typeof END {
    const calls = lastAiMessage(state.messages)?.tool_calls ?? [];
    if (!calls.length) return END;
    return calls.some((c) => registry.get(c.name)?.sideEffects) ? 'review' : 'tools';
  }

  /** Asks a human about every valid side-effect call. Must stay free of side effects: it re-runs on resume. */
  function review(state: AgentStateType) {
    const calls = (lastAiMessage(state.messages)?.tool_calls ?? []).slice(0, MAX_TOOL_CALLS_PER_TURN);
    const reviews: Record<string, ApprovalDecision> = {};
    for (const call of calls) {
      const tool = registry.get(call.name);
      if (!tool?.sideEffects || !call.id || state.reviews[call.id]) continue;
      const parsed = validateToolArgs(tool, call.args);
      // An invalid call cannot run anyway: the tools node reports the error without bothering a human.
      if (!parsed.ok) continue;
      const request: ApprovalRequest = {
        kind: 'tool_approval',
        toolCallId: call.id,
        tool: tool.name,
        description: tool.description,
        args: parsed.data as Record<string, unknown>,
      };
      const answer = ApprovalDecisionSchema.safeParse(interrupt<ApprovalRequest, unknown>(request));
      // Fail closed: a malformed resume value counts as a rejection.
      reviews[call.id] = answer.success ? answer.data : { decision: 'reject' };
    }
    return { reviews };
  }

  async function tools(state: AgentStateType, config: LangGraphRunnableConfig) {
    const scope = scopeOf(config);
    const calls = lastAiMessage(state.messages)?.tool_calls ?? [];
    const messages: ToolMessage[] = [];

    for (const [index, call] of calls.entries()) {
      const id = call.id ?? `call_${index}`;
      const tool = registry.get(call.name);
      if (index >= MAX_TOOL_CALLS_PER_TURN) {
        messages.push(toolMessage(id, call.name, 'Too many tool calls in one turn. Not executed.', 'error'));
        continue;
      }
      if (!tool) {
        messages.push(toolMessage(id, call.name, `Unknown tool "${call.name}". Not executed.`, 'error'));
        continue;
      }

      let args: unknown = call.args;
      let decision: ApprovalDecision['decision'] | undefined;
      if (tool.sideEffects) {
        const reviewed = state.reviews[id];
        if (!reviewed) {
          const invalid = validateToolArgs(tool, call.args);
          messages.push(
            toolMessage(
              id,
              tool.name,
              invalid.ok
                ? 'Not executed: no human approval was recorded.'
                : `Invalid arguments: ${invalid.reason}. Not executed.`,
              'error',
            ),
          );
          continue;
        }
        decision = reviewed.decision;
        if (reviewed.decision !== 'approve') {
          messages.push(
            toolMessage(
              id,
              tool.name,
              'The user rejected this action. It was not executed. Do not retry unless the user asks again.',
              'error',
            ),
          );
          continue;
        }
        // The human may have edited the arguments: validate again, exactly like the model's original call.
        args = reviewed.editedArgs ?? call.args;
      }

      const parsed = validateToolArgs(tool, args);
      if (!parsed.ok) {
        messages.push(
          toolMessage(id, tool.name, `Invalid arguments: ${parsed.reason}. Not executed.`, 'error'),
        );
        continue;
      }

      const result = await tracer.startActiveSpan(`tool.${tool.name}`, async (span) => {
        span.setAttributes({
          [ATTR.tenant]: scope.tenantId,
          [ATTR.thread]: scope.threadId,
          'tool.name': tool.name,
          'tool.side_effects': tool.sideEffects,
          ...(decision ? { 'tool.decision': decision } : {}),
        });
        if (deps.captureContent) span.setAttribute('tool.args', truncateForSpan(JSON.stringify(parsed.data)));
        try {
          const output = await tool.execute(parsed.data, { ...scope, toolCallId: id, signal: config.signal });
          return toolMessage(id, tool.name, wrapUntrusted(tool.name, output), 'success');
        } catch (error) {
          // Do not forward the error text to the model: it may contain internal details or secrets.
          logger.warn(
            `Tool ${tool.name} failed (tenant=${scope.tenantId} thread=${scope.threadId} call=${id}): ` +
              (error instanceof Error ? error.name : 'unknown error'),
          );
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'tool failed' });
          return toolMessage(id, tool.name, 'The tool failed. Not retried automatically.', 'error');
        } finally {
          span.end();
        }
      });
      messages.push(result);
    }
    return { messages };
  }

  return new StateGraph(AgentState)
    .addNode('agent', agent)
    .addNode('review', review)
    .addNode('tools', tools)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, ['review', 'tools', END])
    .addEdge('review', 'tools')
    .addEdge('tools', 'agent')
    .compile({ checkpointer: deps.checkpointer });
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;
