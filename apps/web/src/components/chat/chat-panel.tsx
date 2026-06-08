/**
 * ChatPanel — the slide-in sidebar for the AI assistant.
 *
 * Two views inside the panel:
 *   - Sessions list (left rail, narrow)
 *   - Active conversation (right side, message list + composer)
 *
 * Streaming uses the AsyncGenerator from `streamChatTurn`. We accumulate
 * token events into an in-memory `streamingText` so React renders
 * incrementally without committing to the server-persisted message until
 * the `persisted` event arrives.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import {
  deleteChatSession,
  getChatSession,
  listChatSessions,
  streamChatTurn,
  type ChatMessage,
  type ChatSessionSummary,
} from '@/lib/api';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime } from '@/lib/utils';

interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChatPanel({ open, onOpenChange }: ChatPanelProps) {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // List of sessions (sidebar rail). Refetch every time the panel opens so
  // we pick up sessions created by other tabs / the just-finished stream.
  const sessionsQuery = useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: listChatSessions,
    enabled: open,
    staleTime: 30_000,
  });

  // Full message history for the active session.
  const sessionQuery = useQuery({
    queryKey: ['chat', 'session', activeSessionId],
    queryFn: () => getChatSession(activeSessionId!),
    enabled: !!activeSessionId && open,
    staleTime: 10_000,
  });

  // Auto-scroll on new content.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [streamingText, sessionQuery.data?.messages.length, optimisticUserMsg]);

  // Abort any in-flight stream when the panel closes.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [open]);

  async function send() {
    const content = draft.trim();
    if (!content || isStreaming) return;
    setDraft('');
    setOptimisticUserMsg(content);
    setStreamingText('');
    setIsStreaming(true);
    abortRef.current = new AbortController();

    let resolvedSessionId = activeSessionId;
    try {
      for await (const ev of streamChatTurn(
        { content, sessionId: activeSessionId ?? undefined },
        abortRef.current.signal,
      )) {
        if (ev.type === 'session') {
          resolvedSessionId = ev.sessionId;
          setActiveSessionId(ev.sessionId);
        } else if (ev.type === 'token') {
          setStreamingText((t) => t + ev.content);
        } else if (ev.type === 'error') {
          setStreamingText((t) => t + `\n\n_(error: ${ev.message})_`);
        }
      }
    } catch {
      // Stream aborted — silent.
    } finally {
      setIsStreaming(false);
      setOptimisticUserMsg(null);
      setStreamingText('');
      abortRef.current = null;
      // Re-fetch the session so the persisted assistant message replaces the
      // optimistic streaming text.
      if (resolvedSessionId) {
        await queryClient.invalidateQueries({ queryKey: ['chat', 'session', resolvedSessionId] });
      }
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    }
  }

  function newConversation() {
    setActiveSessionId(null);
    setDraft('');
    setStreamingText('');
    setOptimisticUserMsg(null);
  }

  async function removeSession(id: string) {
    await deleteChatSession(id);
    if (activeSessionId === id) setActiveSessionId(null);
    queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
  }

  const messages: ChatMessage[] = sessionQuery.data?.messages ?? [];
  const sessions: ChatSessionSummary[] = sessionsQuery.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[640px] max-w-full">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" /> Ask Dhruva
          </SheetTitle>
          <SheetDescription>
            Ask about jobs in your pipeline, get tailored advice, draft cover letters.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1">
          {/* Sessions rail */}
          <aside className="hidden w-44 flex-col gap-1 border-r p-2 text-xs sm:flex">
            <Button
              variant="outline"
              size="sm"
              className="mb-2 w-full justify-start gap-1.5"
              onClick={newConversation}
            >
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 && (
                <div className="px-2 py-1 text-muted-foreground">No conversations yet.</div>
              )}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSessionId(s.id)}
                  className={cn(
                    'group relative flex w-full items-center justify-between gap-1 truncate rounded-md px-2 py-1.5 text-left transition-colors',
                    activeSessionId === s.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  <span className="flex-1 truncate">
                    <span className="block truncate">{s.title ?? 'Untitled'}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {formatRelativeTime(s.updatedAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label="Delete session"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(s.id);
                    }}
                    className="invisible rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:visible"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </button>
              ))}
            </div>
          </aside>

          {/* Conversation */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-4">
              {messages.length === 0 && !optimisticUserMsg && !streamingText && (
                <EmptyState />
              )}
              {messages.map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} citedJobIds={m.citedJobIds} />
              ))}
              {optimisticUserMsg && (
                <MessageBubble role="user" content={optimisticUserMsg} citedJobIds={[]} />
              )}
              {streamingText && (
                <MessageBubble role="assistant" content={streamingText + '▍'} citedJobIds={[]} />
              )}
            </div>

            {/* Composer */}
            <form
              className="flex items-end gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about your job pipeline…"
                disabled={isStreaming}
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || isStreaming}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState() {
  const samples = [
    'Find me senior Python roles posted this week',
    'Show me remote backend jobs paying over 150k',
    'What jobs match my CV best right now?',
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <Sparkles className="h-6 w-6 text-brand" />
      <p>Start a conversation about your job pipeline.</p>
      <div className="mt-2 space-y-1.5">
        {samples.map((s) => (
          <div key={s} className="rounded-md border border-dashed px-3 py-1.5 text-xs">
            “{s}”
          </div>
        ))}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  role: ChatMessage['role'];
  content: string;
  citedJobIds: string[];
}

function MessageBubble({ role, content, citedJobIds }: MessageBubbleProps) {
  // Tool messages aren't shown in the bubble UI — they're trace data,
  // useful for debugging but noisy for end users.
  if (role === 'tool') return null;
  return (
    <div className={cn('mb-4 flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary/60 text-foreground',
        )}
      >
        <div className="whitespace-pre-wrap">{content}</div>
        {role === 'assistant' && citedJobIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
            <span>Cited:</span>
            {citedJobIds.slice(0, 6).map((id) => (
              <span key={id} className="rounded bg-background px-1 py-0.5 font-mono">
                {id.slice(0, 8)}
              </span>
            ))}
            {citedJobIds.length > 6 && <span>+{citedJobIds.length - 6}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
