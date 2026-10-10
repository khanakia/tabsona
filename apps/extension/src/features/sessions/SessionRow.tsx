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
import { StateDot } from '@/ui/session-state';
import { HostText } from '@/ui/HostText';
import { IconAction, REVEAL_ON_ROW_HOVER } from '@/ui/IconAction';
import { ActionMenuItem } from '@/ui/HelpCard';
import { ACTION_HELP } from '@/ui/help';
import { FullText } from '@/ui/FullText';
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

  const meta = describeState(s) + (s.state !== 'empty' ? ` · ${shortAgo(s.savedAt)}` : '');

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

        {/* Two lines, and the ADDRESS owns the first, edge to edge.
            The address is what tells two sessions apart (localhost:2165 vs :3000). The
            state is a dot before it (its word cost a third of the line), the Open action is
            an icon after it, and a host too long for the rest is cut in the MIDDLE so the
            registrable domain stays readable; the whole URL is in the hover card on line 2.
            The page title moved to line 2, where it is the first thing to be cut. */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <StateDot state={s.state} />
            <HostText text={shortSite(s.site)} className="font-medium" />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <FullText
              line={<span className="min-w-0 truncate tabular-nums" />}
              full={(
                <>
                  <span className="block break-all font-semibold">{s.site}</span>
                  {s.label !== shortSite(s.site) && <span className="block">{s.label}</span>}
                  <span className="block text-muted-foreground">{meta}</span>
                </>
              )}
            >
              {s.label !== shortSite(s.site) && `${s.label} · `}
              {meta}
            </FullText>
            {s.openTabCount > 0 && (
              <span className="shrink-0 whitespace-nowrap rounded bg-primary/10 px-1 text-[10px] font-semibold tabular-nums text-primary">
                {s.openTabCount} tab{s.openTabCount === 1 ? '' : 's'} open
              </span>
            )}
          </div>
        </div>

        {/* Open stays visible: it is why the row exists, and a list whose main action
            only appears on hover is awkward on a trackpad. It is an icon, named for its
            site, because the word "Open" repeated on every row bought nothing. */}
        <IconAction
          label={`Open ${shortSite(s.site)}`}
          help={ACTION_HELP.openSession}
          onClick={() => props.onOpen(s.id, 'new-tab')}
        >
          <ExternalLink />
        </IconAction>
        {/* The secondary actions overlay the row's second line while it is hovered or
            focused instead of reserving ~50px beside the address all the time. */}
        <div
          className={cn(
            'absolute bottom-0.5 right-8 flex items-center gap-0.5 rounded-md bg-muted shadow-sm ring-1 ring-border',
            REVEAL_ON_ROW_HOVER,
          )}
        >
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
