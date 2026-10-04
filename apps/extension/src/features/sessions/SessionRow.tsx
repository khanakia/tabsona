import { useState } from 'react';
import {
  ChevronRight, ExternalLink, MoreHorizontal, Pencil, SquareArrowDownRight, Trash2, UserPlus,
} from 'lucide-react';
import { describeState } from '@/core/sessionState';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/ui/volt/dropdown-menu';
import { StateBadge } from '@/ui/session-state';
import { IconAction, REVEAL_ON_ROW_HOVER } from '@/ui/IconAction';
import { ActionMenuItem, WithHelp } from '@/ui/HelpCard';
import { ACTION_HELP } from '@/ui/help';
import { shortAgo, shortSite } from '@/ui/format';
import type { SessionId, SessionView } from '@/domain/types';

/**
 * One saved login. Presentational: props in, events out.
 *
 * Names no data layer, no chrome API and no router, so its test renders it with plain
 * objects and needs no `vi.mock` at all. That absence is the proof it is portable —
 * both the popup and the options library render this same row.
 */
export interface SessionRowProps {
  readonly session: SessionView;
  readonly selected?: boolean;
  readonly onOpen: (id: SessionId, where: 'new-tab' | 'this-tab') => void;
  readonly onRename: (id: SessionId, label: string) => void;
  readonly onDelete: (id: SessionId) => void;
  /** "I need a SECOND account on this site." Optional because the options library shows
   *  the same row and routes it the same way; a surface that cannot offer it omits it. */
  readonly onAnotherLogin?: (site: string) => void;
}

export function SessionRow(props: SessionRowProps) {
  const s = props.session;
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState(s.label);

  // The details answer the complaint this row exists to fix — "no way to know which
  // session really had any cookies stored". Names and keys only, never values.
  interface DetailRow { readonly key: string; readonly value: string }
  const details: readonly DetailRow[] = [
    s.cookieNames.length > 0 ? { key: 'Cookies', value: s.cookieNames.join(', ') } : null,
    s.storageKeys.length > 0 ? { key: 'Storage keys', value: s.storageKeys.join(', ') } : null,
    s.domains.length > 0 ? { key: 'Domains', value: s.domains.join(', ') } : null,
    s.expiresAt !== null ? { key: 'Earliest expiry', value: new Date(s.expiresAt).toLocaleString() } : null,
  ].filter((row): row is DetailRow => row !== null);

  return (
    <li
      className={cn(
        'group relative border-t border-border/50 transition-colors',
        'hover:bg-muted/40 has-[:focus-visible]:bg-muted/40',
        props.selected && 'bg-accent hover:bg-accent',
      )}
    >
      {/* A left rule marks the keyboard cursor without moving anything, so the row does
          not jump as the selection travels down the list. */}
      {props.selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}

      <div className="flex items-center gap-2 py-(--row-padding-y) pl-7 pr-1.5">
        <button
          type="button"
          aria-label={expanded ? 'Hide details' : 'Show details'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')} />
        </button>

        {/* Two lines, not one.
            At the popup's 420px the single-line version collided: the site name, the
            state badge and the meta text all refused to shrink and overlapped. Stacking
            the meta underneath keeps the row dense AND readable at both widths. */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{shortSite(s.site)}</span>
            <StateBadge state={s.state} />
            {s.label !== shortSite(s.site) && (
              <span className="truncate text-xs text-muted-foreground">{s.label}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate tabular-nums">
              {describeState(s)}
              {s.state !== 'empty' && ` · ${shortAgo(s.savedAt)}`}
            </span>
            {s.openTabCount > 0 && (
              <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                {s.openTabCount} tab{s.openTabCount === 1 ? '' : 's'} open
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* Open stays visible: it is why the row exists, and a list whose main action
              only appears on hover is awkward on a trackpad. Everything else fades in. */}
          <WithHelp
            help={ACTION_HELP.openSession}
            trigger={<Button size="xs" variant="ghost" onClick={() => props.onOpen(s.id, 'new-tab')} />}
          >
            <ExternalLink />
            {ACTION_HELP.openSession.label}
          </WithHelp>
          <div className={cn('flex items-center gap-0.5', REVEAL_ON_ROW_HOVER)}>
            <IconAction
              label={ACTION_HELP.openSessionHere.label}
              help={ACTION_HELP.openSessionHere}
              keys="⌘↵"
              onClick={() => props.onOpen(s.id, 'this-tab')}
            >
              <SquareArrowDownRight />
            </IconAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="More actions" onClick={() => undefined} />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {props.onAnotherLogin && (
                  <ActionMenuItem
                    help={ACTION_HELP.anotherAccountForSite}
                    icon={<UserPlus />}
                    onClick={() => props.onAnotherLogin?.(s.site)}
                  />
                )}
                <ActionMenuItem help={ACTION_HELP.renameSession} icon={<Pencil />} onClick={() => setExpanded(true)} />
                <DropdownMenuSeparator />
                <ActionMenuItem
                  destructive
                  help={ACTION_HELP.deleteSession}
                  icon={<Trash2 />}
                  onClick={() => props.onDelete(s.id)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-border/50 bg-muted/30 px-2 py-2 pl-9">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Label
            </span>
            <Input
              aria-label={`Rename ${s.label}`}
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              onBlur={() => { if (label.trim() && label !== s.label) props.onRename(s.id, label); }}
              className="max-w-xs"
            />
          </div>
          {details.length === 0
            ? <p className="text-xs text-muted-foreground">Nothing stored yet.</p>
            : details.map((row) => (
              <div key={row.key} className="flex gap-2">
                <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {row.key}
                </span>
                <span className="min-w-0 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {row.value}
                </span>
              </div>
            ))}
        </div>
      )}
    </li>
  );
}
