import 'reflect-metadata';
import { AIMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import type { INestApplication } from '@nestjs/common';
import { Test as NestTest } from '@nestjs/testing';
import type { Test } from 'supertest';
import { vi } from 'vitest';
import { ScriptedChatModel } from '../src/agent/testing/scripted-chat-model.js';
import { searchDocsTool } from '../src/agent/tools/search-docs.js';
import { createSendEmailTool, type SendEmailOptions } from '../src/agent/tools/send-email.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { type AppConfig, loadConfig } from '../src/config/config.js';
import { InMemoryTokenBucket } from '../src/tenancy/rate-limiter.js';
import { InMemoryRunLock } from '../src/tenancy/run-lock.js';
import { InMemoryUsageStore } from '../src/tenancy/usage-store.js';
import { InMemoryThreadsRepository } from '../src/threads/threads.repository.js';

export const API_KEY = 'test-api-key-0123456789abcdef0123456789abcdef';

/** Fake values only. They exist to satisfy validation; nothing here reaches a network. */
export const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  AUTH_MODE: 'api-key',
  API_KEYS: API_KEY,
  LLM_PROVIDER: 'openai',
  OPENAI_API_KEY: 'sk-test-not-a-real-key-000000',
  OPENAI_MODEL: 'gpt-4.1-mini',
};

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ ...BASE_ENV, ...overrides });
}

const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };

export function aiText(text: string): AIMessage {
  return new AIMessage({ content: text, usage_metadata: usage });
}

export function aiToolCall(name: string, args: Record<string, unknown>, id = `call_${name}`): AIMessage {
  return new AIMessage({
    content: '',
    tool_calls: [{ id, name, args, type: 'tool_call' }],
    usage_metadata: usage,
  });
}

export const EMAIL_ARGS = { to: 'ops@example.com', subject: 'Hello', body: 'Status update' };

/** send_email wired to a spy, so tests can count real executions. */
export function emailTools() {
  const deliver = vi.fn<NonNullable<SendEmailOptions['deliver']>>(async () => 'sent');
  return {
    deliver,
    tools: [searchDocsTool, createSendEmailTool({ allowedDomains: ['example.com'], deliver })],
  };
}

export interface TestApp {
  app: INestApplication;
  model: ScriptedChatModel;
  deliver: ReturnType<typeof emailTools>['deliver'];
  usage: InMemoryUsageStore;
}

export async function createTestApp(
  script: AIMessage[],
  options: { env?: Record<string, string>; usage?: InMemoryUsageStore } = {},
): Promise<TestApp> {
  const config = testConfig(options.env);
  const model = new ScriptedChatModel(script);
  const { deliver, tools } = emailTools();
  const usageStore = options.usage ?? new InMemoryUsageStore();
  const moduleRef = await NestTest.createTestingModule({
    imports: [
      AppModule.forRoot(config, {
        model,
        checkpointer: new MemorySaver(),
        threads: new InMemoryThreadsRepository(),
        usage: usageStore,
        rateLimiter: new InMemoryTokenBucket({
          perMinute: config.limits.ratePerMinute,
          burst: config.limits.burst,
        }),
        runLock: new InMemoryRunLock(),
        tools,
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app, config);
  await app.init();
  return { app, model, deliver, usage: usageStore };
}

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith(':'))
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

type BodyParser = Extract<Parameters<Test['parse']>[0], (res: never, callback: never) => void>;

/** supertest parser that buffers a text/event-stream body into a string. */
export const sseParser: BodyParser = (res, callback) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  let body = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => (body += chunk));
  stream.on('end', () => callback(null, body));
};
