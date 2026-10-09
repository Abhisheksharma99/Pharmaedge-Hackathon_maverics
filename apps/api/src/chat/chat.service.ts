import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { APIUserAbortError } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AssetDoc } from '../assets/assets.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { MONGO_DB } from '../database/database.module.js';
import { LlmService } from '../llm/llm.service.js';
import { ChatTools, TOOL_DEFINITIONS, toolLabel, type ToolOutput } from './chat-tools.js';
import { addMessage, ensureChatIndexes, findSession, messages, sessions } from './chat.store.js';
import { toMessage, toSession, type Card, type ChatSessionDoc, type StreamEvent } from './chat.types.js';
import { CitationRegistry } from './citations.js';

const NEW_TITLE = 'New chat';
const HISTORY_MESSAGES = 12;
/** Spec §6: at most 6 tool calls per turn. */
const MAX_TOOL_CALLS = 6;
const TURNS_PER_MINUTE = 20;

const SYSTEM = `You are Asset AI, the copilot in PharmaEdge's asset journey platform, used by pharma competitive-intelligence analysts.
You answer questions about tracked drug assets: their regulatory and clinical journey, trials, publications, milestones, patents and competitors.

Rules:
- Facts come only from your tools. Call them before answering; never answer from memory about tracked assets. If the tools return nothing relevant, say so plainly and suggest what data would help.
- Gather enough to answer fully: call several tools in parallel when a question spans topics (e.g. trials and regulatory history, or evidence search plus the timeline).
- Cite every factual statement with the ref numbers from tool results, like [3] or [2][5]. Use only refs returned in this conversation turn. Never invent refs.
- Be concise. Lead with the answer, then short bullets or a compact markdown table. Write dates as "12 Mar 2024".
- End when the answer is complete. Never close with an offer such as "If you want, I can…": the app shows suggested follow-up questions itself.
- compare_assets shows the user a comparison table card: do not repeat the table; summarise the key differences in two or three sentences.
- Adding (tracking) a new asset: call resolve_asset with the drug name. The user sees an identity card and starts the crawl by clicking "Confirm & start crawl". You never start crawls. After resolve_asset, say briefly what was found and ask the user to check the card and confirm. If it is already tracked, say so.
- Crawl progress questions: use get_job_status.
- Asset ids are lowercase slugs ("treprostinil"); call search_assets when unsure which asset the user means.`;

const stripRefs = (text: string) => text.replace(/\s?\[\d+(?:\s*,\s*\d+)*\]/g, '');

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

/**
 * Asset AI conversations (spec §6): sessions and messages per user, and the
 * streamed turn — the model calls tools over our data (up to 6 per turn),
 * then answers with citations; the answer, its cards and its citations are
 * stored with the session.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);
  private readonly recentTurns = new Map<string, number[]>();

  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly llm: LlmService,
    private readonly tools: ChatTools,
  ) {}

  async onModuleInit() {
    await ensureChatIndexes(this.db).catch((err: Error) => this.logger.warn(`chat indexes: ${err.message}`));
  }

  async listSessions(user: AuthUser, assetId?: string) {
    const match = { user_id: user.id, ...(assetId ? { asset_id: assetId } : {}) };
    return (await sessions(this.db).find(match).sort({ updated_at: -1 }).limit(100).toArray()).map(toSession);
  }

  async createSession(user: AuthUser, assetId?: string) {
    if (assetId && !(await this.db.collection<AssetDoc>('assets').countDocuments({ _id: assetId }, { limit: 1 }))) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `No asset "${assetId}"` });
    }
    const now = new Date();
    const doc: ChatSessionDoc = { _id: randomUUID(), user_id: user.id, asset_id: assetId ?? null, title: NEW_TITLE, created_at: now, updated_at: now };
    await sessions(this.db).insertOne(doc);
    return toSession(doc);
  }

  private async session(user: AuthUser, id: string): Promise<ChatSessionDoc> {
    const session = await findSession(this.db, id, user.id);
    if (!session) throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Chat not found' });
    return session;
  }

  async messages(user: AuthUser, id: string) {
    const session = await this.session(user, id);
    return (await messages(this.db).find({ session_id: session._id }).sort({ created_at: 1 }).toArray()).map(toMessage);
  }

  async deleteSession(user: AuthUser, id: string) {
    const session = await this.session(user, id);
    await Promise.all([sessions(this.db).deleteOne({ _id: session._id }), messages(this.db).deleteMany({ session_id: session._id })]);
  }

  /** Checks that run before the response starts streaming (so they can still answer with a normal error). */
  async prepareTurn(user: AuthUser, id: string): Promise<ChatSessionDoc> {
    const session = await this.session(user, id);
    const now = Date.now();
    const recent = (this.recentTurns.get(user.id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= TURNS_PER_MINUTE) {
      throw new HttpException({ code: 'TOO_MANY_REQUESTS', message: 'Too many questions in a minute. Please wait a moment.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.recentTurns.set(user.id, [...recent, now]);
    return session;
  }

  async runTurn(session: ChatSessionDoc, text: string, emit: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
    await addMessage(this.db, session, { role: 'user', content: text });
    if (session.title === NEW_TITLE) await sessions(this.db).updateOne({ _id: session._id }, { $set: { title: titleFrom(text) } });

    const history = (await messages(this.db).find({ session_id: session._id }).sort({ created_at: -1 }).limit(HISTORY_MESSAGES).toArray())
      .reverse()
      .filter((m) => m.content)
      .map((m): ChatCompletionMessageParam => ({ role: m.role, content: stripRefs(m.content) }));
    const conversation: ChatCompletionMessageParam[] = [{ role: 'system', content: `${SYSTEM}\n\n${await this.context(session)}` }, ...history];

    const registry = new CitationRegistry();
    const cards: Card[] = [];
    const toolLog: { name: string; args: unknown; summary: string }[] = [];
    const usage = { prompt_tokens: 0, completion_tokens: 0, model: '' };
    let answer = '';
    let calls = 0;
    let failure: { code: string; message: string } | null = null;

    try {
      for (;;) {
        const stream = await this.llm.streamChat(conversation, TOOL_DEFINITIONS, signal, calls >= MAX_TOOL_CALLS);
        let roundText = '';
        const requested: { id: string; name: string; args: string }[] = [];
        for await (const chunk of stream) {
          if (chunk.usage) {
            usage.prompt_tokens += chunk.usage.prompt_tokens;
            usage.completion_tokens += chunk.usage.completion_tokens;
            usage.model = chunk.model;
          }
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            if (!roundText && answer) emit({ type: 'token', text: '\n\n' });
            roundText += delta.content;
            emit({ type: 'token', text: delta.content });
          }
          for (const tc of delta?.tool_calls ?? []) {
            const slot = (requested[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        }
        answer += (answer && roundText ? '\n\n' : '') + roundText;
        if (!requested.length) break;

        conversation.push({
          role: 'assistant',
          content: roundText || null,
          tool_calls: requested.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
        });
        const parsed = requested.map((c) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.args || '{}');
          } catch {
            // malformed arguments: the tool reports what's missing
          }
          emit({ type: 'tool_call', id: c.id, name: c.name, label: toolLabel(c.name, args) });
          return { ...c, args, allowed: calls++ < MAX_TOOL_CALLS };
        });
        const outputs = await Promise.all(
          parsed.map((c) =>
            c.allowed
              ? this.tools.run(c.name, c.args, { registry, assetId: session.asset_id })
              : Promise.resolve<ToolOutput>({ result: { error: 'Tool budget for this question is used up; answer with what you have.' }, summary: 'skipped' }),
          ),
        );
        parsed.forEach((c, i) => {
          const out = outputs[i]!;
          emit({ type: 'tool_result', id: c.id, name: c.name, summary: out.summary });
          for (const card of out.cards ?? []) {
            cards.push(card);
            emit({ type: 'card', card });
          }
          toolLog.push({ name: c.name, args: c.args, summary: out.summary });
          conversation.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out.result) });
        });
      }
    } catch (err) {
      if (signal.aborted || err instanceof APIUserAbortError) {
        failure = { code: 'CANCELLED', message: 'Stopped.' };
      } else {
        this.logger.error(`chat turn failed: ${(err as Error).stack ?? err}`);
        const code = err instanceof HttpException ? ((err.getResponse() as { code?: string }).code ?? 'LLM_UNAVAILABLE') : 'LLM_UNAVAILABLE';
        failure = { code, message: 'Asset AI could not finish this answer. Try again in a moment.' };
      }
    }

    if (!answer && !cards.length) {
      if (failure && !signal.aborted) emit({ type: 'error', ...failure });
      return;
    }
    // Partial answers are kept (spec §8).
    const followUps = failure ? [] : await this.llm.followUps(text, answer, await this.assetName(session.asset_id));
    const { text: content, citations } = registry.finalize(answer);
    const message = await addMessage(this.db, session, {
      role: 'assistant',
      content,
      cards,
      citations,
      follow_ups: followUps,
      tool_calls: toolLog,
      usage,
    });
    if (signal.aborted) return;
    emit({ type: 'answer', message: toMessage(message) });
    if (failure) emit({ type: 'error', ...failure });
  }

  private async assetName(id: string | null): Promise<string | null> {
    if (!id) return null;
    return (await this.db.collection<AssetDoc>('assets').findOne({ _id: id }, { projection: { name: 1 } }))?.name ?? null;
  }

  /** What the model needs to know about the page and the portfolio before calling tools. */
  private async context(session: ChatSessionDoc): Promise<string> {
    const all = await this.db
      .collection<AssetDoc>('assets')
      .find({}, { projection: { name: 1, kind: 1, status: 1, competitors: 1, competitor_of: 1, company: 1 } })
      .sort({ kind: -1, name: 1 })
      .limit(60)
      .toArray();
    const lines = [`Today is ${new Date().toISOString().slice(0, 10)}.`];
    const current = all.find((a) => a._id === session.asset_id);
    if (current) {
      lines.push(`The user is on the asset page of ${current.name} (asset_id "${current._id}", ${current.kind} asset, ${current.company?.name ?? 'company unknown'}).`);
      if (current.competitors?.length) {
        lines.push(`Its tracked competitors: ${current.competitors.map((c) => `${c.name} ("${c.id}")`).join(', ')}.`);
      }
      lines.push('Questions without an explicit asset are about this asset.');
    } else {
      lines.push('No asset page is open; the user is in the full-page Asset AI.');
    }
    lines.push(
      'Tracked assets:',
      ...all.map((a) => `- "${a._id}": ${a.name} (${a.kind}${a.status === 'ready' ? '' : `, ${a.status}`}${a.competitor_of?.length ? `, competitor of ${a.competitor_of.join(', ')}` : ''})`),
    );
    return lines.join('\n');
  }
}
