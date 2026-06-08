/**
 * ChatService — owns the DB write-side of a chat turn and proxies the
 * model run to the Python AI service.
 *
 * Flow for `POST /chat/stream`:
 *   1. Create a session if one isn't provided.
 *   2. Write the user message to DB.
 *   3. Fetch the last N messages for the session — passed to Python so the
 *      agent has conversation history without LangGraph checkpointing.
 *   4. POST to Python /chat with userId/cvId/messages + the internal bearer.
 *   5. Stream SSE events through to the caller, accumulating the assistant
 *      tokens and any tool calls.
 *   6. On the `done` event from Python, write the assistant message with
 *      observability fields (model, tokens, latency, costUsd, citedJobIds).
 *
 * History length is bounded to keep prompt costs sane — most chats don't
 * benefit from more than a dozen prior turns of context.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Env } from '../common/config/env.schema';
import { computeCostUsd, deriveSessionTitle } from './chat.constants';

interface StartTurnArgs {
  userId: string;
  /** Existing session id, or undefined to create a fresh one. */
  sessionId?: string;
  /** The user's free-text input. */
  content: string;
  /** Optional CV id override. Default behavior: Python tools look up the latest CV. */
  cvId?: string;
}

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

const HISTORY_LIMIT = 30;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly aiBaseUrl: string;
  private readonly internalToken: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.aiBaseUrl = config.get('AI_SERVICE_URL', { infer: true });
    this.internalToken = config.get('INTERNAL_SERVICE_TOKEN', { infer: true });
  }

  // ─── Read-side (sidebar history) ─────────────────────────────────────────

  listSessions(userId: string) {
    return this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            toolCalls: true,
            toolName: true,
            citedJobIds: true,
            createdAt: true,
          },
        },
      },
    });
    return session;
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.chatSession.deleteMany({ where: { id: sessionId, userId } });
  }

  // ─── Stream a turn ──────────────────────────────────────────────────────

  async *startTurn(args: StartTurnArgs): AsyncIterable<StreamEvent> {
    const startedAt = Date.now();

    // 1. Resolve or create the session.
    let session = args.sessionId
      ? await this.prisma.chatSession.findFirst({
          where: { id: args.sessionId, userId: args.userId },
        })
      : null;
    if (!session) {
      session = await this.prisma.chatSession.create({
        data: { userId: args.userId, title: deriveSessionTitle(args.content) },
      });
    }

    // Emit a `session` event so the client can update its URL / sidebar.
    yield { type: 'session', sessionId: session.id, title: session.title ?? '' };

    // 2. Write the user message.
    await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'user', content: args.content },
    });

    // 3. Pull recent history (newest at end). Bounded to HISTORY_LIMIT.
    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    });

    // 4. Forward to Python.
    const pythonRes = await fetch(`${this.aiBaseUrl}/chat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: args.userId,
        cv_id: args.cvId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!pythonRes.ok || !pythonRes.body) {
      const text = await pythonRes.text().catch(() => '');
      this.logger.warn({ status: pythonRes.status, text }, 'Python /chat failed');
      yield { type: 'error', message: `AI service failed: ${pythonRes.status}` };
      return;
    }

    // 5. Stream through the SSE events, accumulating final state.
    let assistantText = '';
    let model: string | null = null;
    let tokensIn = 0;
    let tokensOut = 0;
    const citedJobIds = new Set<string>();
    const toolCallsCollected: Array<{ name: string; args: unknown; id: string }> = [];

    for await (const event of parseSseStream(pythonRes.body)) {
      if (event.type === 'token' && typeof event.content === 'string') {
        assistantText += event.content;
      } else if (event.type === 'tool_call') {
        toolCallsCollected.push({
          name: String(event.name ?? ''),
          args: event.args ?? null,
          id: String(event.id ?? ''),
        });
      } else if (event.type === 'tool_result') {
        // Tool result preview events also forwarded — useful for UI hints.
      } else if (event.type === 'done') {
        model = (event.model as string | undefined) ?? null;
        tokensIn = Number(event.tokens_in ?? 0) || 0;
        tokensOut = Number(event.tokens_out ?? 0) || 0;
        const ids = Array.isArray(event.cited_job_ids) ? (event.cited_job_ids as string[]) : [];
        for (const id of ids) citedJobIds.add(id);
      }
      yield event;
    }

    // 6. Write the assistant message with observability fields.
    const latencyMs = Date.now() - startedAt;
    const costUsd = computeCostUsd(model, tokensIn, tokensOut);
    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: assistantText,
        toolCalls: toolCallsCollected.length
          ? (toolCallsCollected as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        citedJobIds: Array.from(citedJobIds),
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        costUsd,
      },
    });

    // Bump the session's updatedAt so the sidebar re-sorts.
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    yield {
      type: 'persisted',
      messageId: assistantMessage.id,
      sessionId: session.id,
      latencyMs,
      costUsd,
    };
  }

  // ─── Cover-letter passthrough ───────────────────────────────────────────

  async *streamCoverLetter(userId: string, jobId: string): AsyncIterable<StreamEvent> {
    const res = await fetch(`${this.aiBaseUrl}/chat/cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, job_id: jobId }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', message: `AI service failed: ${res.status} ${text.slice(0, 200)}` };
      return;
    }
    for await (const event of parseSseStream(res.body)) {
      yield event;
    }
  }

  /** Header used by Python service callbacks (exposed for the internal-auth flow). */
  get internalAuthHeader(): string {
    return `Bearer ${this.internalToken}`;
  }
}

/**
 * Parse an SSE response body into typed events. Handles partial chunks +
 * UTF-8 boundary splits via a TextDecoder + line buffer.
 */
async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          yield JSON.parse(payload) as StreamEvent;
        } catch {
          // Malformed JSON — skip rather than blow up the stream.
        }
      }
    }
  }
}
