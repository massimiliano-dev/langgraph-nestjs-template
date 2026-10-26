import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { defineTool, type AgentTool, type ToolContext } from './types.js';

export interface SendEmailOptions {
  /** Recipients outside these domains are refused even after approval. Defense in depth. */
  allowedDomains: string[];
  /** Replace with your mail provider. Receives the tool-call id to use as idempotency key. */
  deliver?: (email: { to: string; subject: string; body: string }, ctx: ToolContext) => Promise<string>;
}

export const sendEmailSchema = z.object({
  to: z.email().max(254),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

const logger = new Logger('send_email');
const domainOf = (address: unknown) =>
  typeof address === 'string' ? (address.split('@')[1] ?? '').toLowerCase() : '';

/** Fake side-effect tool: it only logs. Guarded by human approval in the graph (`sideEffects: true`). */
export function createSendEmailTool(options: SendEmailOptions): AgentTool {
  const allowed = new Set(options.allowedDomains.map((d) => d.toLowerCase()));
  return defineTool({
    name: 'send_email',
    description:
      'Send an email on behalf of the user. Has side effects: a human must approve every call. ' +
      'Only use it when the user explicitly asks to send an email.',
    sideEffects: true,
    // Zod runs refinements even when a field already failed, so read the domain defensively.
    schema: sendEmailSchema.refine((v) => allowed.has(domainOf(v.to)), {
      message: 'recipient domain is not allowed',
      path: ['to'],
    }),
    async execute(email, ctx) {
      if (options.deliver) return options.deliver(email, ctx);
      // Log identifiers only. The body and the full address are PII.
      logger.log(
        `Simulated email for tenant=${ctx.tenantId} thread=${ctx.threadId} call=${ctx.toolCallId} ` +
          `domain=${domainOf(email.to)}`,
      );
      return `Email queued (simulated). Idempotency key: ${ctx.toolCallId}`;
    },
  });
}
