/**
 * CoverLetterButton — opens a small dialog that streams a tailored draft for
 * a single job. Lives in each Jobs-row's action column.
 *
 * The drafting endpoint is server-side; this component is purely a streaming
 * consumer + copy-to-clipboard affordance.
 */
import { useRef, useState } from 'react';
import { Copy, FileText, Sparkles } from 'lucide-react';
import { streamCoverLetter } from '@/lib/api';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface CoverLetterButtonProps {
  jobId: string;
  jobTitle: string;
  company: string;
}

export function CoverLetterButton({ jobId, jobTitle, company }: CoverLetterButtonProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function start() {
    setText('');
    setError(null);
    setStreaming(true);
    abortRef.current = new AbortController();
    try {
      for await (const ev of streamCoverLetter({ jobId }, abortRef.current.signal)) {
        if (ev.type === 'token') {
          setText((t) => t + ev.content);
        } else if (ev.type === 'error') {
          setError(ev.message);
          break;
        }
      }
    } catch {
      // aborted
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
          void start();
        }}
        title="Draft a tailored cover letter"
      >
        <FileText className="h-3.5 w-3.5" />
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && abortRef.current) abortRef.current.abort();
        }}
      >
        <SheetContent side="right" className="w-[640px] max-w-full">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" /> Cover letter
            </SheetTitle>
            <SheetDescription>
              Tailored draft for <span className="font-medium text-foreground">{jobTitle}</span> at{' '}
              <span className="font-medium text-foreground">{company}</span>
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {text}
                {streaming && <span className="opacity-60">▍</span>}
              </pre>
              {!streaming && !text && !error && (
                <p className="text-sm text-muted-foreground">Generating…</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(text)}
                disabled={!text || streaming}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText('');
                  void start();
                }}
                disabled={streaming}
              >
                Regenerate
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
