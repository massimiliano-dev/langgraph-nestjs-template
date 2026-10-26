import { trace } from '@opentelemetry/api';

/** Shared tracer. Without a registered SDK (OTEL_ENABLED=false, tests) every span is a cheap no-op. */
export const tracer = trace.getTracer('langgraph-agent-api');

/**
 * Span attribute names. Only identifiers and numbers by default: prompt/response text and tool arguments are
 * added only with OTEL_CAPTURE_CONTENT=true, because they may contain personal data.
 */
export const ATTR = {
  tenant: 'tenant.id',
  thread: 'thread.id',
  model: 'llm.model',
  tokensIn: 'llm.tokens.input',
  tokensOut: 'llm.tokens.output',
  cost: 'llm.cost.usd',
} as const;

const MAX_CONTENT_ATTRIBUTE = 2_000;

export function truncateForSpan(value: string): string {
  return value.length > MAX_CONTENT_ATTRIBUTE ? `${value.slice(0, MAX_CONTENT_ATTRIBUTE)}…` : value;
}
