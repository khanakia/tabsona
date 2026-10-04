import type { ReactElement, ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipPositioner, TooltipTrigger } from '@/ui/volt/tooltip';
import { DropdownMenuItem } from '@/ui/volt/dropdown-menu';
import { cn } from '@/lib/utils';
import { HELP_CARD_DELAY_MS, type ActionHelp } from './help';

/**
 * The body of a help card: what happens, what it does to everything else, and the one
 * consequence people would not guess. Exported on its own so a test can assert the
 * wording without driving a hover.
 */
export function HelpCardBody({ help, titled = false }: {
  readonly help: ActionHelp;
  /** Lead with the label: for icon-only controls, where the card is the only place the
   *  control's name is written down. */
  readonly titled?: boolean;
}) {
  return (
    <div className="space-y-1 text-left">
      {titled && <p className="font-semibold text-popover-foreground">{help.label}</p>}
      <p className={titled ? 'text-popover-foreground' : 'font-medium text-popover-foreground'}>{help.what}</p>
      <p className="text-muted-foreground">{help.touches}</p>
      {help.gotcha && <Gotcha text={help.gotcha} />}
    </div>
  );
}

/** A consequence worth a second look. Amber, never red: it is a heads-up, not an error. */
function Gotcha({ text }: { readonly text: string }) {
  return (
    <p className="flex items-start gap-1 text-(--caution)">
      <TriangleAlert className="mt-px size-3 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/**
 * Wrap any control so resting on it, or tabbing to it, explains what it does.
 *
 * `trigger` is the control itself, rendered as-is (Base UI's `render` prop), so wrapping
 * never changes the button's look, size or click handler. Opens after
 * HELP_CARD_DELAY_MS on hover and immediately on keyboard focus.
 */
export function WithHelp(props: {
  readonly help: ActionHelp;
  readonly trigger: ReactElement;
  readonly children?: ReactNode;
  readonly titled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger delay={HELP_CARD_DELAY_MS} render={props.trigger}>
        {props.children}
      </TooltipTrigger>
      <TooltipPositioner>
        <TooltipContent className="max-w-64 border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-popover-foreground shadow-md [&>[data-slot=tooltip-arrow]]:hidden">
          <HelpCardBody help={props.help} titled={props.titled ?? false} />
        </TooltipContent>
      </TooltipPositioner>
    </Tooltip>
  );
}

/**
 * A menu entry that explains itself in place: the label, then one muted line saying what
 * happens, then the gotcha if there is one.
 *
 * Inline rather than a hover card because a menu is exactly where people decide, and a
 * card that appears only after hovering each entry would hide the difference between
 * "move" and "copy" until after someone had already picked one.
 */
export function ActionMenuItem(props: {
  readonly help: ActionHelp;
  readonly icon?: ReactNode;
  /** Overrides `help.label`, e.g. to name the persona the action targets. */
  readonly label?: ReactNode;
  readonly onClick: () => void;
  readonly destructive?: boolean;
  /** Drop the explanation line: for a run of entries that share one explanation shown
   *  once above them (one row per persona under “Another account”). */
  readonly compact?: boolean;
}) {
  return (
    <DropdownMenuItem
      {...(props.destructive ? { variant: 'destructive' as const } : {})}
      onClick={props.onClick}
      className={cn('items-start', !props.compact && 'py-1.5')}
    >
      {props.icon && <span className="mt-0.5 flex shrink-0 [&_svg]:size-3.5">{props.icon}</span>}
      <span className="min-w-0 space-y-0.5">
        <span className="block font-medium">{props.label ?? props.help.label}</span>
        {!props.compact && (
          <span className="block text-[11px] leading-snug text-muted-foreground">{props.help.what}</span>
        )}
        {!props.compact && props.help.gotcha && (
          <span className="block text-[11px] leading-snug text-(--caution)">{props.help.gotcha}</span>
        )}
      </span>
    </DropdownMenuItem>
  );
}
