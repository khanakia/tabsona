import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipPositioner, TooltipTrigger } from '@/ui/volt/tooltip';
import { HELP_CARD_DELAY_MS } from './help';

/**
 * A line that is cut off with "…" in a narrow row, plus a hover card with the whole text.
 *
 * Why: the popup is 420px wide, so persona descriptions and page titles are truncated, and
 * there was no way to read the rest ("there is no popover to view the full description").
 * The card opens only when the line is ACTUALLY cut off — measured whenever the line
 * resizes, so it is known before the pointer arrives — and short lines do not pop a card
 * that repeats what is already visible. Opens on keyboard focus
 * too, because the trigger is focusable.
 *
 * `line` is the truncating element, rendered as-is (it must carry `truncate` or an
 * equivalent overflow rule); `full` is what the card shows.
 */
export function FullText(props: { readonly line: ReactElement; readonly full: ReactNode; readonly children: ReactNode }) {
  const [clipped, setClipped] = useState(false);
  // A callback ref into state: the trigger is typed as a button, but `line` renders a <p>
  // or <span>; storing it as the wider HTMLElement needs no cast.
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth);
    measure();
    // Absent in some test environments; then the first measurement is all there is.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, props.children]);
  return (
    <Tooltip disabled={!clipped}>
      <TooltipTrigger ref={setEl} delay={HELP_CARD_DELAY_MS} render={props.line} tabIndex={clipped ? 0 : -1}>
        {props.children}
      </TooltipTrigger>
      <TooltipPositioner>
        <TooltipContent className="max-w-[min(20rem,calc(100vw-1rem))] whitespace-normal break-words border border-border bg-popover px-3 py-2.5 text-[13px] leading-normal text-popover-foreground shadow-md [&>[data-slot=tooltip-arrow]]:hidden">
          {props.full}
        </TooltipContent>
      </TooltipPositioner>
    </Tooltip>
  );
}
