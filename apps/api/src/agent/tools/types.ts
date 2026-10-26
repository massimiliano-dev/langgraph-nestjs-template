import type { z } from 'zod';

/** What a tool receives besides its arguments. Never trust the model for any of these values. */
export interface ToolContext {
  tenantId: string;
  threadId: string;
  /**
   * Unique per tool call. Side-effect tools must pass it as an idempotency key to the downstream system, so a
   * retry after a crash cannot perform the action twice.
   */
  toolCallId: string;
  signal?: AbortSignal;
}

/**
 * A tool the agent may call. Arguments are validated with `schema` before `execute` runs.
 *
 * `sideEffects: true` means the tool changes something outside this process (sends, writes, pays, deletes).
 * Such tools never run without an explicit human approval: the graph pauses with `interrupt()` first and,
 * after approval, validates the (possibly edited) arguments again.
 */
export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  sideEffects: boolean;
  execute(args: z.output<S>, ctx: ToolContext): Promise<string>;
}

/** Erases the schema type so heterogeneous tools fit in one registry. */
export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool {
  return tool as unknown as AgentTool;
}

export class ToolRegistry {
  private readonly byName = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[]) {
    for (const tool of tools) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`Invalid tool name "${tool.name}"`);
      if (this.byName.has(tool.name)) throw new Error(`Duplicate tool "${tool.name}"`);
      this.byName.set(tool.name, tool);
    }
  }

  get(name: string): AgentTool | undefined {
    return this.byName.get(name);
  }

  all(): AgentTool[] {
    return [...this.byName.values()];
  }
}

export type ValidationResult = { ok: true; data: unknown } | { ok: false; reason: string };

/**
 * Validates tool arguments. Fails closed: a schema that throws (a bug in a refinement, for example) counts as
 * invalid. The reason lists paths and rules only, never the submitted values.
 */
export function validateToolArgs(tool: AgentTool, args: unknown): ValidationResult {
  try {
    const result = tool.schema.safeParse(args);
    if (result.success) return { ok: true, data: result.data };
    return {
      ok: false,
      reason: result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    };
  } catch {
    return { ok: false, reason: 'arguments could not be validated' };
  }
}
