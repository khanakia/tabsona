import { useState } from 'react';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { WithHelp } from '@/ui/HelpCard';
import { ACTION_HELP } from '@/ui/help';
import { GOOGLE_SIGN_IN_HOSTS } from '@/core/constants';
import { missingGoogleHosts, normalizeHostEntry, urlIsPassThrough } from '@/core/passthrough';

/**
 * "Use my normal login on": the websites a persona tab reaches with the browser's own
 * login. Presentational: props in, events out.
 *
 * WHY it exists: Google's sign-in cannot run from a separate login (it sets its flow
 * cookie on a redirect, which an extension cannot carry onto the redirect's next request),
 * so the way to sign in with Google from a persona is to let Google use the browser's own
 * login while the app's own login stays separate. The list is EMPTY on a fresh install:
 * nothing is silently active. The defaults are always shown and one click away
 * ("Restore default sites"), which re-adds only the ones that are missing.
 *
 * The input is validated here only to enable the button and show a message; the worker
 * normalises again, because it is the one that stores.
 */
export interface NormalLoginProps {
  /** The stored entries, sorted (`host`, `*.host` or `host:port`). */
  readonly hosts: readonly string[];
  /** Add websites, in whatever shape the user typed. */
  readonly onAdd: (hosts: readonly string[]) => void;
  readonly onRemove: (host: string) => void;
}

/** The preset as the `readonly string[]` the props take (the constant is a tuple of literals). */
const DEFAULT_HOSTS: readonly string[] = GOOGLE_SIGN_IN_HOSTS;

export function NormalLogin(props: NormalLoginProps) {
  const [draft, setDraft] = useState('');
  const entry = normalizeHostEntry(draft);
  const invalid = draft.trim() !== '' && entry === null;
  const missing = missingGoogleHosts(props.hosts);

  const add = () => {
    if (entry === null) return;
    props.onAdd([entry]);
    setDraft('');
  };

  return (
    <div className="space-y-3">
      <ul aria-label="Websites that use your normal login" className="divide-y divide-border/60 rounded-md border border-border/60">
        {props.hosts.length === 0 && (
          <li className="px-3 py-1.5 text-xs text-muted-foreground">None yet.</li>
        )}
        {props.hosts.map((host) => (
          <li key={host} className="flex items-center gap-2 px-3 py-1">
            <span className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{host}</span>
            <WithHelp
              help={ACTION_HELP.removeNormalLogin}
              trigger={<Button size="xs" variant="outline" aria-label={`Remove ${host}`} onClick={() => props.onRemove(host)} />}
            >
              <X />
              {ACTION_HELP.removeNormalLogin.label}
            </WithHelp>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Website to use your normal login on"
          aria-invalid={invalid}
          placeholder="accounts.google.co.in"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          className="max-w-xs"
        />
        <WithHelp help={ACTION_HELP.addNormalLogin} trigger={<Button size="xs" disabled={entry === null} onClick={add} />}>
          <Plus />
          {ACTION_HELP.addNormalLogin.label}
        </WithHelp>
      </div>
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          That is not a website address. Try something like accounts.google.co.in.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/40 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Default sites</p>
          <ul aria-label="Default sites" className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {DEFAULT_HOSTS.map((h) => {
              const on = urlIsPassThrough(props.hosts, `https://${h}`);
              return (
                <li key={h} className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  {on ? <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-label="on the list" /> : <span className="size-3" aria-hidden />}
                  {h}
                  {!on && <span className="font-sans">(not on the list)</span>}
                </li>
              );
            })}
          </ul>
        </div>
        <WithHelp
          help={ACTION_HELP.addGoogleSignInSites}
          trigger={<Button size="xs" variant="outline" disabled={missing.length === 0} onClick={() => props.onAdd(missing)} />}
        >
          <RotateCcw />
          {ACTION_HELP.addGoogleSignInSites.label}
        </WithHelp>
        {missing.length === 0 && <p className="w-full text-xs text-muted-foreground">All default sites are already on your list.</p>}
      </div>
    </div>
  );
}
