import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { Env } from '../config/env.js';

/**
 * OpenAI access for Asset AI (spec §6): streamed chat with tools, query
 * embeddings for evidence search (same model as the crawler's index), and
 * follow-up suggestions. Without OPENAI_API_KEY every call fails with
 * LLM_UNAVAILABLE and the rest of the API keeps working.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const apiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.client = apiKey
      ? new OpenAI({ apiKey, baseURL: config.get('OPENAI_BASE_URL', { infer: true }) || undefined, maxRetries: 2, timeout: 90_000 })
      : null;
  }

  private require(): OpenAI {
    if (!this.client) {
      throw new ServiceUnavailableException({ code: 'LLM_UNAVAILABLE', message: 'Asset AI is not configured on this server.' });
    }
    return this.client;
  }

  /** One streamed model call; tool calls arrive as deltas the caller assembles. `noTools` forces a text answer. */
  streamChat(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    signal: AbortSignal,
    noTools = false,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    return this.require().chat.completions.create(
      {
        model: this.config.get('LLM_CHAT_MODEL', { infer: true }),
        messages,
        tools,
        tool_choice: noTools ? 'none' : 'auto',
        stream: true,
        stream_options: { include_usage: true },
        reasoning_effort: this.config.get('LLM_CHAT_REASONING_EFFORT', { infer: true }),
        max_completion_tokens: 4000,
      },
      { signal },
    );
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.require().embeddings.create({
      model: this.config.get('LLM_EMBEDDING_MODEL', { infer: true }),
      input: text,
      dimensions: this.config.get('EMBEDDING_DIMENSIONS', { infer: true }),
    });
    return res.data[0]!.embedding;
  }

  /** One non-streamed call that must answer with JSON matching `schema` (strict structured output). */
  async json<T>(system: string, user: string, name: string, schema: Record<string, unknown>): Promise<T> {
    const res = await this.require().chat.completions.create({
      model: this.config.get('LLM_CHAT_MODEL', { infer: true }),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      reasoning_effort: this.config.get('LLM_CHAT_REASONING_EFFORT', { infer: true }),
      max_completion_tokens: 16000,
    });
    const choice = res.choices[0];
    if (!choice || choice.finish_reason === 'length') throw new Error('LLM answer was cut off');
    return JSON.parse(choice.message.content ?? '') as T;
  }

  /** Three short next questions for the "Ask next" list. Best effort: [] on any failure. */
  async followUps(question: string, answer: string, assetName: string | null): Promise<string[]> {
    if (!this.client) return [];
    try {
      const res = await this.client.chat.completions.create({
        model: this.config.get('LLM_FOLLOWUP_MODEL', { infer: true }),
        messages: [
          {
            role: 'system',
            content:
              'Suggest the 3 most useful next questions a pharma competitive-intelligence analyst would ask after this exchange. ' +
              'Each under 70 characters, specific to the drugs discussed, answerable from journey, trial, regulatory, publication or competitor data.',
          },
          { role: 'user', content: `Asset in view: ${assetName ?? 'none'}\nQuestion: ${question}\nAnswer: ${answer.slice(0, 2500)}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'follow_ups',
            strict: true,
            schema: {
              type: 'object',
              properties: { questions: { type: 'array', items: { type: 'string' } } },
              required: ['questions'],
              additionalProperties: false,
            },
          },
        },
      });
      const parsed = JSON.parse(res.choices[0]?.message.content ?? '{}') as { questions?: string[] };
      return (parsed.questions ?? []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 3);
    } catch (err) {
      this.logger.warn(`follow-up suggestions failed: ${(err as Error).message}`);
      return [];
    }
  }
}
