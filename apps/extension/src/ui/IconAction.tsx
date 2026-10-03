import type { ReactNode } from 'react';
import { Button } from '@/ui/volt/button';
import { Tooltip, TooltipContent, TooltipPositioner, TooltipTrigger } from '@/ui/volt/tooltip';
import { cn } from '@/lib/utils';

/**
 * An icon button with a REAL tooltip, not a native `title`.
 *
 * Native titles appear after ~1s, cannot be styled, and never show for keyboard focus —
 * so an icon-only control is effectively unlabelled until you hover it for a second.
 * Base UI's tooltip opens immediately, follows focus, and is announced.
 */
export function IconAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly variant?: 'ghost' | 'outline' | 'destructive-outline';
  readonly size?: 'icon-sm' | 'icon';
  readonly disabled?: boolean;
  readonly className?: string;
  /** Keyboard shortcut hint, shown muted beside the label. */
  readonly keys?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            variant={props.variant ?? 'ghost'}
            size={props.size ?? 'icon-sm'}
            disabled={props.disabled ?? false}
            aria-label={props.label}
            onClick={props.onClick}
            className={cn('focus-visible:opacity-100', props.className)}
          />
        )}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPositioner>
        <TooltipContent className="flex items-center gap-2 px-2 py-1">
          {props.label}
          {props.keys && (
            <kbd className="rounded border border-primary-foreground/25 px-1 font-mono text-[10px] opacity-70">
              {props.keys}
            </kbd>
          )}
        </TooltipContent>
      </TooltipPositioner>
    </Tooltip>
  );
}

/**
 * Secondary row actions: present in the layout but faded until the row is hovered or
 * something inside it takes keyboard focus.
 *
 * `opacity` rather than `hidden`, so the row never reflows as the pointer crosses it —
 * a list that shifts under the cursor is worse than one that is always busy.
 * `focus-within` matters as much as `hover`: without it, a keyboard user tabbing through
 * the list would aim at controls they cannot see.
 */
export const REVEAL_ON_ROW_HOVER =
  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
