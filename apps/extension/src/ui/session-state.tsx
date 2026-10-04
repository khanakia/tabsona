import { CheckCircle2, CircleDashed, CircleHelp, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipPositioner, TooltipTrigger } from '@/ui/volt/tooltip';
import { HELP_CARD_DELAY_MS } from './help';
import type { SessionState } from '@/domain/types';

/**
 * How a session's state looks, declared once.
 *
 * Three surfaces render this — the popup, the options library and the in-page badge —
 * and if each decided its own wording and colour they would drift. The state itself is
 * computed in `core/sessionState.ts`; this is only its appearance.
 */
interface StatePresentation {
  readonly label: string;
  readonly Icon: LucideIcon;
  /** Reads a CSS custom property, so a state's colour is defined in one stylesheet. */
  readonly color: string;
  readonly help: string;
}

export const SESSION_STATE: Record<SessionState, StatePresentation> = {
  'signed-in': {
    label: 'Signed in',
    Icon: CheckCircle2,
    color: 'var(--state-signed-in)',
    help: 'You are signed in. Opening this website uses this login.',
  },
  unknown: {
    label: 'Saved',
    Icon: CircleHelp,
    color: 'var(--state-unknown)',
    // Honest on purpose: a token in page storage carries no expiry we can read, so
    // claiming "signed in" would be a guess.
    help: 'A login is saved, but Tabsona cannot tell when it ends. Open it to check.',
  },
  empty: {
    label: 'Empty',
    Icon: CircleDashed,
    color: 'var(--state-empty)',
    help: 'Nothing saved yet. Open it and sign in once.',
  },
  expired: {
    label: 'Expired',
    Icon: TriangleAlert,
    color: 'var(--state-expired)',
    help: 'This login has ended. Open it and sign in again.',
  },
};

/** A state pill: dot + word, sized to sit inside a dense row. Resting on it, or tabbing
 *  to it, explains the state in a sentence — a native `title` took a second to appear and
 *  never showed for keyboard users. */
export function StateBadge({
  state,
  className,
}: {
  readonly state: SessionState;
  readonly className?: string;
}) {
  const { label, color, help } = SESSION_STATE[state];
  return (
    <Tooltip>
      <TooltipTrigger
        delay={HELP_CARD_DELAY_MS}
        render={(
          <span
            // Focusable so the explanation is reachable without a mouse.
            tabIndex={0}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
            style={{ color, borderColor: `color-mix(in oklch, ${color} 35%, transparent)`, background: `color-mix(in oklch, ${color} 10%, transparent)` }}
          />
        )}
      >
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </TooltipTrigger>
      <TooltipPositioner>
        <TooltipContent className="max-w-56 border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-md [&>[data-slot=tooltip-arrow]]:hidden">
          {help}
        </TooltipContent>
      </TooltipPositioner>
    </Tooltip>
  );
}
