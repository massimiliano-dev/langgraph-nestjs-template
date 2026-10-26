import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai';
import type { LlmConfig } from '../config/config.js';

/**
 * Builds the chat model from validated config. Keys are passed explicitly, so the SDK never falls back to
 * other environment variables you did not intend to use.
 */
export function createChatModel(config: LlmConfig): BaseChatModel {
  const common = {
    temperature: config.temperature,
    maxTokens: config.maxOutputTokens,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
    // Token usage on streamed responses, needed for budgets and cost attributes.
    streamUsage: true,
  };
  if (config.provider === 'azure-openai') {
    return new AzureChatOpenAI({
      ...common,
      azureOpenAIApiKey: config.apiKey,
      azureOpenAIEndpoint: config.endpoint,
      azureOpenAIApiDeploymentName: config.deployment,
      azureOpenAIApiVersion: config.apiVersion,
    });
  }
  return new ChatOpenAI({
    ...common,
    model: config.model,
    apiKey: config.apiKey,
    ...(config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}),
  });
}
