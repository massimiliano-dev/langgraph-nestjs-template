import { Logger } from '@nestjs/common';
import { GraphRecursionError } from '@langchain/langgraph';
import type { Response } from 'express';
import type { AgentEvent } from '../agent/runner.js';

const logger = new Logger('SSE');
const HEARTBEAT_MS = 15_000;

/**
 * Writes agent events as Server-Sent Events. Each `data:` line is JSON, which cannot contain raw newlines, so
 * model output cannot inject extra SSE fields. Errors after the stream started become a generic `error` event.
 */
export async function pipeSse(res: Response, events: AsyncIterable<AgentEvent>): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), HEARTBEAT_MS);
  const iterator = events[Symbol.asyncIterator]();
  // Client went away: stop the graph (and the LLM call) instead of paying for tokens nobody reads.
  const onClose = () => void iterator.return?.();
  res.on('close', onClose);

  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      write(next.value.type, next.value);
    }
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      write('error', { type: 'error', message: 'The agent reached its step limit.' });
    } else if (!(error instanceof Error && error.name === 'AbortError')) {
      logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      write('error', { type: 'error', message: 'The run failed.' });
    }
  } finally {
    clearInterval(heartbeat);
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}
