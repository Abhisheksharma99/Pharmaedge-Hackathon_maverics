import { describe, expect, it, vi } from 'vitest';
import { LlmService } from './llm.service.js';

const make = (create: ReturnType<typeof vi.fn>) => {
  const svc = new LlmService({ get: (k: string) => (k === 'OPENAI_API_KEY' ? 'k' : 'm') } as never);
  (svc as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return svc;
};
const reply = (content: string | null, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content } }] });

describe('LlmService.json', () => {
  it('parses the strict JSON answer and sends the schema', async () => {
    const create = vi.fn().mockResolvedValue(reply('{"a":1}'));
    expect(await make(create).json('sys', 'user', 'n', { type: 'object' })).toEqual({ a: 1 });
    expect(create.mock.calls[0]![0].response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'n', strict: true } });
  });
  it('rejects a truncated or unparseable answer', async () => {
    await expect(make(vi.fn().mockResolvedValue(reply('{"a":', 'length'))).json('s', 'u', 'n', {})).rejects.toThrow(/cut off/);
    await expect(make(vi.fn().mockResolvedValue(reply('not json'))).json('s', 'u', 'n', {})).rejects.toThrow();
    await expect(make(vi.fn().mockResolvedValue(reply(null))).json('s', 'u', 'n', {})).rejects.toThrow();
  });
});
