import { CheckCircle2, CircleDashed, CircleHelp, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    help: 'Live cookies are stored for this site.',
  },
  unknown: {
    label: 'Saved',
    Icon: CircleHelp,
    color: 'var(--state-unknown)',
    // Honest on purpose: a token in page storage carries no expiry we can read, so
    // claiming "signed in" would be a guess.
    help: 'Stored, but its token carries no expiry we can read.',
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
    help: 'Its cookies have aged out. Open it and sign in again.',
  },
};

/** A state pill: dot + word, sized to sit inside a dense row. */
export function StateBadge({
  state,
  className,
}: {
  readonly state: SessionState;
  readonly className?: string;
}) {
  const { label, color, help } = SESSION_STATE[state];
  return (
    <span
      title={help}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-medium',
        className,
      )}
      style={{ color, borderColor: `color-mix(in oklch, ${color} 35%, transparent)`, background: `color-mix(in oklch, ${color} 10%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
