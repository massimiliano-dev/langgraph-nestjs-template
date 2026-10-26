import { searchDocsTool } from './search-docs.js';
import { createSendEmailTool, type SendEmailOptions } from './send-email.js';
import type { AgentTool } from './types.js';

/** The tools bound to the model. Adding one? Follow the checklist in the README ("Adding a tool safely"). */
export function createDefaultTools(options: { email: SendEmailOptions }): AgentTool[] {
  return [searchDocsTool, createSendEmailTool(options.email)];
}
