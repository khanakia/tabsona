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

/**
 * A state DOT, nothing else: the pill's word was costing a third of the row's width, and
 * the site name is what the row is for. The colour keeps its meaning, and the state is
 * still announced: the dot is a focusable element named "<label>. <explanation>", and
 * resting on it or tabbing to it opens a card with the same text.
 *
 * Invariant: never rely on colour alone for the state — the aria-label and the card carry it.
 */
export function StateDot({
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
            // Focusable so the explanation is reachable without a mouse. The 16px box is
            // the hit area; the 8px dot inside it is what is drawn.
            tabIndex={0}
            role="img"
            aria-label={label}
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          />
        )}
      >
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ background: color, boxShadow: `0 0 0 2px color-mix(in oklch, ${color} 25%, transparent)` }}
        />
      </TooltipTrigger>
      <TooltipPositioner>
        <TooltipContent className="max-w-72 border border-border bg-popover px-3 py-2.5 text-[13px] leading-normal text-popover-foreground shadow-md [&>[data-slot=tooltip-arrow]]:hidden">
          <span className="block font-semibold" style={{ color }}>{label}</span>
          {help}
        </TooltipContent>
      </TooltipPositioner>
    </Tooltip>
  );
}
