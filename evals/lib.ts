import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MemorySaver } from '@langchain/langgraph';
import {
  buildAgentGraph,
  createSendEmailTool,
  DEFAULT_PRICING,
  ScriptedChatModel,
  searchDocsTool,
} from 'api/agent';
import { z } from 'zod';

export const EVALS_DIR = import.meta.dirname;

export const CaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  input: z.string().min(1),
  expect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('answer'), contains: z.array(z.string()).default([]) }),
    z.object({ type: z.literal('tool'), tool: z.string(), contains: z.array(z.string()).default([]) }),
    z.object({ type: z.literal('interrupt'), tool: z.string() }),
  ]),
});
export type EvalCase = z.infer<typeof CaseSchema>;

const RecordedResponse = z.object({
  content: z.string(),
  tool_calls: z.array(
    z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) }),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});
export const RecordingSchema = z.object({
  caseId: z.string(),
  model: z.string(),
  source: z.string(),
  responses: z.array(RecordedResponse),
});
export type Recording = z.infer<typeof RecordingSchema>;

export function loadDataset(): EvalCase[] {
  return readFileSync(join(EVALS_DIR, 'dataset.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => CaseSchema.parse(JSON.parse(line)));
}

const recordingPath = (id: string) => join(EVALS_DIR, 'recordings', `${id}.json`);

export function loadRecording(id: string): Recording {
  return RecordingSchema.parse(JSON.parse(readFileSync(recordingPath(id), 'utf8')));
}

/** Patterns that must never appear in a committed recording. */
export const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /api[-_]?key["'\s:=]+[A-Za-z0-9._-]{16,}/gi,
];

/** Removes anything that looks like a credential, plus the exact values of the configured keys. */
export function scrub(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const name of ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT']) {
    const value = env[name];
    if (value && value.length >= 8) out = out.split(value).join('[REDACTED]');
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

/** Only content, tool calls and token counts are kept: no headers, ids of the provider request, or metadata. */
export function saveRecording(evalCase: EvalCase, model: string, messages: BaseMessage[]): void {
  const recording: Recording = {
    caseId: evalCase.id,
    model,
    source: `recorded ${new Date().toISOString().slice(0, 10)}`,
    responses: messages
      .filter((m): m is AIMessage => AIMessage.isInstance(m))
      .map((m) => ({
        content: m.text,
        tool_calls: (m.tool_calls ?? []).map((c) => ({ id: c.id ?? '', name: c.name, args: c.args })),
        ...(m.usage_metadata
          ? {
              usage: {
                input_tokens: m.usage_metadata.input_tokens,
                output_tokens: m.usage_metadata.output_tokens,
              },
            }
          : {}),
      })),
  };
  writeFileSync(recordingPath(evalCase.id), `${scrub(JSON.stringify(recording, null, 2))}\n`);
}

export function replayModel(recording: Recording): ScriptedChatModel {
  return new ScriptedChatModel(
    recording.responses.map(
      (r) =>
        new AIMessage({
          content: r.content,
          tool_calls: r.tool_calls.map((c) => ({ ...c, type: 'tool_call' as const })),
          ...(r.usage
            ? {
                usage_metadata: {
                  input_tokens: r.usage.input_tokens,
                  output_tokens: r.usage.output_tokens,
                  total_tokens: r.usage.input_tokens + r.usage.output_tokens,
                },
              }
            : {}),
        }),
    ),
  );
}

export interface CaseResult {
  id: string;
  passed: boolean;
  reason: string;
  messages: BaseMessage[];
}

/** Runs one case through the real graph. send_email is a spy: evals never perform side effects. */
export async function runCase(
  evalCase: EvalCase,
  model: BaseChatModel,
  modelName: string,
): Promise<CaseResult> {
  let emailsSent = 0;
  const graph = buildAgentGraph({
    model,
    tools: [
      searchDocsTool,
      createSendEmailTool({
        allowedDomains: ['example.com'],
        deliver: async () => {
          emailsSent += 1;
          return 'sent';
        },
      }),
    ],
    checkpointer: new MemorySaver(),
    modelName,
    pricing: DEFAULT_PRICING,
  });
  const config = {
    configurable: { thread_id: `eval:${evalCase.id}`, tenant_id: 'eval', app_thread_id: evalCase.id },
    recursionLimit: 12,
  };
  const result = (await graph.invoke({ messages: [new HumanMessage(evalCase.input)] }, config)) as {
    messages: BaseMessage[];
    __interrupt__?: { value?: { tool?: string } }[];
  };
  const messages = result.messages;
  const finalText = messages.at(-1)?.text.toLowerCase() ?? '';
  const toolsCalled = messages.filter((m) => ToolMessage.isInstance(m)).map((m) => (m as ToolMessage).name);
  const fail = (reason: string): CaseResult => ({ id: evalCase.id, passed: false, reason, messages });
  const expectation = evalCase.expect;

  if (emailsSent > 0) return fail('a side effect ran without approval');
  if (expectation.type === 'interrupt') {
    const pending = result.__interrupt__?.[0]?.value?.tool;
    return pending === expectation.tool
      ? { id: evalCase.id, passed: true, reason: `paused for approval of ${pending}`, messages }
      : fail(`expected an approval request for ${expectation.tool}, got ${pending ?? 'none'}`);
  }
  if (result.__interrupt__?.length) return fail('unexpected approval request');
  if (expectation.type === 'answer' && toolsCalled.length)
    return fail(`unexpected tool calls: ${toolsCalled.join(', ')}`);
  if (expectation.type === 'tool' && !toolsCalled.includes(expectation.tool))
    return fail(`expected a call to ${expectation.tool}`);
  const missing = expectation.contains.filter((s) => !finalText.includes(s.toLowerCase()));
  if (missing.length) return fail(`final answer misses: ${missing.join(', ')}`);
  return { id: evalCase.id, passed: true, reason: 'ok', messages };
}
