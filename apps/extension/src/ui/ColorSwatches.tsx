import { Check } from 'lucide-react';
import { PERSONA_PALETTE } from '@/core/constants';
import { cn } from '@/lib/utils';

/**
 * The nine persona colours as clickable swatches — one per Chrome tab-group colour, so
 * whatever is picked here is exactly what the tab group shows.
 *
 * Presentational: shows `value` as selected and reports a pick. A radiogroup, so it is
 * operable and announced as one choice among nine.
 */
export function ColorSwatches(props: {
  readonly value: string;
  readonly onPick: (hex: string) => void;
}) {
  const current = props.value.toLowerCase();
  return (
    <div role="radiogroup" aria-label="Persona colour" className="flex flex-wrap gap-1">
      {PERSONA_PALETTE.map((c) => {
        const selected = c.hex === current;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.label}
            title={c.label}
            onClick={() => props.onPick(c.hex)}
            className={cn(
              'flex size-5 items-center justify-center rounded-[5px] ring-offset-1 ring-offset-background transition-shadow',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'ring-2 ring-foreground',
            )}
            style={{ background: c.hex }}
          >
            {selected && <Check className="size-3 text-white" />}
          </button>
        );
      })}
    </div>
  );
}
