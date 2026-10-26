import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatResult } from '@langchain/core/outputs';

/**
 * A deterministic chat model for tests and eval replay: it returns the given AI messages in order, one per
 * call, and records the prompts it received. It ignores bound tools (the script already contains the calls).
 *
 * LangChain's own fakes (`FakeListChatModel`, `FakeStreamingChatModel`) cannot return a sequence of messages
 * with different tool calls, which a ReAct loop needs.
 */
export class ScriptedChatModel extends BaseChatModel {
  readonly prompts: BaseMessage[][] = [];
  private readonly queue: AIMessage[];

  constructor(script: AIMessage[]) {
    super({});
    this.queue = [...script];
  }

  get remaining(): number {
    return this.queue.length;
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const next = this.queue.shift();
    if (!next)
      throw new Error('ScriptedChatModel: script exhausted (the graph made more model calls than expected)');
    this.prompts.push(messages);
    const message = new AIMessage({
      content: next.content,
      tool_calls: next.tool_calls ?? [],
      ...(next.usage_metadata ? { usage_metadata: next.usage_metadata } : {}),
    });
    return { generations: [{ text: message.text, message }] };
  }
}
