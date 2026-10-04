import { useState } from 'react';
import { Check, ChevronRight, Copy, MoreHorizontal, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/ui/volt/dropdown-menu';
import { IconAction, REVEAL_ON_ROW_HOVER } from '@/ui/IconAction';
import { ActionMenuItem, WithHelp } from '@/ui/HelpCard';
import { ACTION_HELP } from '@/ui/help';
import { SessionRow } from '@/features/sessions/SessionRow';
import type { PersonaId, PersonaView, SessionId } from '@/domain/types';

/**
 * One persona and the sites it holds. Presentational: props in, events out.
 *
 * Composes SessionRow directly because the two always travel together; splitting them
 * further would be the inflation this project's own rules warn against.
 */
export interface PersonaRowProps {
  readonly persona: PersonaView;
  readonly expanded: boolean;
  readonly selectedId?: string | null;
  readonly onToggle: (id: PersonaId) => void;
  readonly onOpenAll: (id: PersonaId) => void;
  /** One patch callback rather than a rename callback plus a describe callback, so a
   *  third editable field later does not add a third prop. */
  readonly onUpdate: (id: PersonaId, patch: { name?: string; description?: string }) => void;
  readonly onDuplicate: (id: PersonaId) => void;
  readonly onDelete: (id: PersonaId) => void;
  /** Build a session from scratch: a URL you type, opened signed out inside the
   *  persona. The browser's own login — and any plain tab using it — is untouched. */
  readonly onAddSite: (id: PersonaId, url: string) => void;
  /** Prefill for the Add-site field: whatever the user is looking at. */
  readonly currentSite?: string | null;
  readonly onOpenSession: (id: SessionId, where: 'new-tab' | 'this-tab') => void;
  readonly onRenameSession: (id: SessionId, label: string) => void;
  readonly onDeleteSession: (id: SessionId) => void;
  readonly onAnotherLogin?: (site: string) => void;
}

export function PersonaRow(props: PersonaRowProps) {
  const p = props.persona;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);

  const [addingSite, setAddingSite] = useState(false);
  const [newUrl, setNewUrl] = useState('');

  const beginAddSite = () => {
    setNewUrl(props.currentSite ?? '');
    setAddingSite(true);
  };
  const commitAddSite = () => {
    const url = newUrl.trim();
    if (!url) { setAddingSite(false); return; }
    setAddingSite(false);
    // Accept "example.com" as well as a full URL: nobody types a scheme.
    props.onAddSite(p.id, /^https?:\/\//.test(url) ? url : `https://${url}`);
  };

  const beginEdit = () => {
    // Re-seed from props: the row may have been edited elsewhere since it mounted.
    setName(p.name);
    setDescription(p.description);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const patch: { name?: string; description?: string } = {};
    if (name.trim() && name !== p.name) patch.name = name;
    if (description !== p.description) patch.description = description;
    if (Object.keys(patch).length > 0) props.onUpdate(p.id, patch);
  };
  const cancel = () => {
    setEditing(false);
    setName(p.name);
    setDescription(p.description);
  };

  return (
    <li className="border-b border-border last:border-b-0">
      <div
        className={cn(
          'group relative flex items-center gap-2 px-1.5 py-(--row-padding-y) transition-colors',
          'hover:bg-muted/50 has-[:focus-visible]:bg-muted/50',
          props.selectedId === p.id && 'bg-accent hover:bg-accent',
        )}
      >
        {props.selectedId === p.id && (
          <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
        )}
        <button
          type="button"
          aria-label={props.expanded ? `Collapse ${p.name}` : `Expand ${p.name}`}
          aria-expanded={props.expanded}
          onClick={() => props.onToggle(p.id)}
          className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('size-3.5 transition-transform duration-150', props.expanded && 'rotate-90')} />
        </button>

        <span
          aria-hidden
          title={p.name}
          className="size-2.5 shrink-0 rounded-[3px] ring-1 ring-black/10 transition-shadow group-hover:ring-2 dark:ring-white/15"
          style={{ background: p.color }}
        />

        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-label={`Edit ${p.name}`}
            onClick={beginEdit}
            className="block min-w-0 max-w-full truncate rounded px-0.5 text-left font-semibold tracking-tight decoration-dotted underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {p.name}
          </button>
          {p.description && (
            <p className="truncate px-0.5 text-xs text-muted-foreground">{p.description}</p>
          )}
        </div>

        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {p.sessions.length} website{p.sessions.length === 1 ? '' : 's'}
          {p.openTabCount > 0 && ` · ${p.openTabCount} tab${p.openTabCount === 1 ? '' : 's'} open`}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* The one action a persona exists for gets the only solid button in the row. */}
          <WithHelp
            help={p.sessions.length === 0
              ? { ...ACTION_HELP.openAll, what: 'This persona has no websites yet. Add one first.' }
              : ACTION_HELP.openAll}
            trigger={<Button size="xs" disabled={p.sessions.length === 0} onClick={() => props.onOpenAll(p.id)} />}
          >
            <Play />
            {ACTION_HELP.openAll.label}
          </WithHelp>
          <div className={cn('flex items-center gap-0.5', REVEAL_ON_ROW_HOVER)}>
            <IconAction label={ACTION_HELP.addSite.label} help={ACTION_HELP.addSite} onClick={beginAddSite}>
              <Plus />
            </IconAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="More actions" onClick={() => undefined} />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <ActionMenuItem help={ACTION_HELP.renamePersona} icon={<Pencil />} onClick={beginEdit} />
                <ActionMenuItem help={ACTION_HELP.duplicatePersona} icon={<Copy />} onClick={() => props.onDuplicate(p.id)} />
                <DropdownMenuSeparator />
                <ActionMenuItem
                  destructive
                  help={ACTION_HELP.deletePersona}
                  icon={<Trash2 />}
                  onClick={() => props.onDelete(p.id)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {addingSite && (
        <div className="flex items-center gap-2 border-t border-border/50 bg-muted/30 px-2 py-2 pl-9">
          <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Add website
          </span>
          <Input
            autoFocus
            aria-label={`Add a site to ${p.name}`}
            value={newUrl}
            placeholder="example.com"
            onChange={(e) => setNewUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAddSite();
              if (e.key === 'Escape') setAddingSite(false);
            }}
            className="max-w-xs"
          />
          <Button size="xs" onClick={commitAddSite}><Check />Add</Button>
          <Button size="xs" variant="ghost" onClick={() => setAddingSite(false)}><X />Cancel</Button>
        </div>
      )}

      {editing && (
        <div className="space-y-2 border-t border-border/50 bg-muted/30 px-2 py-2 pl-9">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Name
            </span>
            <Input
              autoFocus
              aria-label={`Rename ${p.name}`}
              value={name}
              placeholder="Acme admin"
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') cancel();
              }}
              className="max-w-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Description
            </span>
            <Input
              aria-label={`Describe ${p.name}`}
              value={description}
              placeholder="What is this persona for?"
              onChange={(e) => setDescription(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') cancel();
              }}
              className="max-w-xs"
            />
          </div>
          <div className="flex items-center gap-1.5 pl-[5.5rem]">
            <Button size="xs" onClick={commit}><Check />Save</Button>
            <Button size="xs" variant="ghost" onClick={cancel}><X />Cancel</Button>
            <span className="text-[10px] text-muted-foreground">Enter to save · Esc to cancel</span>
          </div>
        </div>
      )}

      {props.expanded && (
        p.sessions.length === 0
          ? (
            <p className="py-2 pl-9 pr-2 text-xs text-muted-foreground">
              No websites yet. Press <span className="font-medium text-foreground">+</span> to add one, or go to
              a website and choose <span className="font-medium text-foreground">{ACTION_HELP.addToPersona.label}</span> at
              the bottom of this window.
            </p>
          )
          : (
            <ul>
              {p.sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={props.selectedId === s.id}
                  onOpen={props.onOpenSession}
                  onRename={props.onRenameSession}
                  onDelete={props.onDeleteSession}
                  {...(props.onAnotherLogin ? { onAnotherLogin: props.onAnotherLogin } : {})}
                />
              ))}
            </ul>
          )
      )}
    </li>
  );
}
