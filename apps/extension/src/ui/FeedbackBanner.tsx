import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A message's severity. Mirrors `Feedback['tone']` in app/useLibrary.ts; restated here
 *  because ui/ may not import app/, and a `Record` over it below makes a new tone without
 *  a style a type error. */
export type FeedbackTone = 'info' | 'success' | 'warn' | 'error';

const TONE: Record<FeedbackTone, { readonly Icon: LucideIcon; readonly className: string }> = {
  info: { Icon: Info, className: 'bg-muted/60 text-foreground' },
  success: { Icon: CheckCircle2, className: 'bg-(--state-signed-in)/10 text-(--state-signed-in)' },
  warn: { Icon: TriangleAlert, className: 'bg-(--caution)/10 text-(--caution)' },
  error: { Icon: XCircle, className: 'bg-destructive/10 text-destructive' },
};

/**
 * The one line that says what just happened, or what went wrong.
 *
 * Shared by the popup and the library so a success looks like a success everywhere: the
 * popup once rendered every message in the error style, so "Saved" would have read as a
 * failure. Presentational: props in, events out.
 */
export function FeedbackBanner(props: {
  readonly tone: FeedbackTone;
  readonly text: string;
  readonly onDismiss: () => void;
  readonly className?: string;
}) {
  const { Icon, className } = TONE[props.tone];
  return (
    <div role="status" className={cn('flex items-start gap-1.5 px-2 py-1.5 text-xs', className, props.className)}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="flex-1">{props.text}</span>
      <button type="button" aria-label="Dismiss" onClick={props.onDismiss}>
        <X className="size-3" />
      </button>
    </div>
  );
}
